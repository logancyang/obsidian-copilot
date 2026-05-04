/**
 * In-process driver for the Claude Agent SDK that implements `BackendProcess`,
 * the same interface `AgentSession` consumes for ACP backends. Every SDK
 * message is translated to an ACP `SessionNotification` and dispatched to the
 * per-session handler. From `AgentSession`'s perspective there's no difference
 * between this adapter and `AcpBackendProcess`.
 *
 * Lifecycle differs from ACP: there's no long-lived subprocess. Each
 * `prompt()` call starts a fresh `query()` (with `resume: <sessionId>` after
 * the first turn so the SDK loads prior conversation state).
 */
import { logError, logInfo, logWarn } from "@/logger";
import { err2String } from "@/utils";
import {
  type CancelNotification,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type McpServer as AcpMcpServer,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionId,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModelRequest,
  type SetSessionModelResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type StopReason,
} from "@agentclientprotocol/sdk";
import {
  query,
  type EffortLevel,
  type McpServerConfig,
  type ModelInfo,
  type Options,
  type PermissionMode,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import type { BackendProcess, SessionUpdateHandler } from "@/agentMode/session/types";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { createTranslatorState, mapStopReason, translateSdkMessage } from "./sdkMessageTranslator";
import { createVaultMcpServer, VAULT_MCP_SERVER_NAME } from "./vaultMcpServer";
import { PermissionBridge, type AskUserQuestionHandler } from "./permissionBridge";
import {
  probeClaudeSdkCatalog,
  resolveSeedModelId,
  synthesizeEffortConfigOption,
} from "./effortOption";
import {
  describeSdkMessage,
  logSdkError,
  logSdkInbound,
  logSdkOutbound,
  logSdkOutboundResult,
} from "./sdkDebugTap";

interface SessionState {
  cwd: string | null;
  /**
   * Drives whether the next `query()` passes `resume: <sessionId>` (continue
   * the persisted conversation) or `sessionId: <ourId>` (mint a new SDK-side
   * session with our pre-allocated id).
   */
  firstPromptStarted: boolean;
  model?: string;
  permissionMode?: PermissionMode;
  /**
   * Effort tier passed to `query()`'s `options.effort` on the next prompt.
   * The vocabulary is per-model — the runtime catalog
   * (`ModelInfo.supportedEffortLevels`) is the source of truth and is
   * pulled via `ensureModelCatalog()`.
   */
  effort?: EffortLevel;
  mcpServers: Record<string, McpServerConfig>;
  active?: Query;
}

export interface ClaudeSdkBackendProcessOptions {
  pathToClaudeCodeExecutable: string;
  app: App;
  clientVersion: string;
  askUserQuestion?: AskUserQuestionHandler;
  /**
   * Read at the start of every `prompt()` so a settings change live-applies on
   * the next turn.
   */
  getEnableThinking?: () => boolean;
  /**
   * Predicate identifying plan-mode plan files (e.g. `~/.claude/plans/*.md`).
   * When set, `Write` calls targeting these paths are auto-allowed via
   * `canUseTool`; all other `Write` calls are denied without prompting.
   * Vault writes always flow through the vault MCP, never `Write`.
   */
  isPlanModePlanFilePath?: (absolutePath: string) => boolean;
  /**
   * Returns the descriptor's preload-time catalog cache, if populated.
   * The descriptor probes the SDK once at preload (via `probeInitialState`)
   * and stashes the result; we read from there to avoid re-probing per
   * session. `null` means the preload hasn't run or failed — the backend
   * falls back to its own on-demand probe.
   */
  getCachedCatalog?: () => ModelInfo[] | null;
  /**
   * Returns the user's persisted model preference. Read at session start
   * to seed `session.model` from the live catalog (so the SDK uses what
   * the picker shows, instead of falling back to its own internal default).
   */
  getPreferredModelId?: () => string | undefined;
}

export class ClaudeSdkBackendProcess implements BackendProcess {
  private readonly sessionHandlers = new Map<SessionId, SessionUpdateHandler>();
  /** Per-session FIFO of notifications that arrived before the handler was registered. */
  private readonly pendingUpdates = new Map<SessionId, SessionNotification[]>();
  private static readonly PENDING_UPDATE_LIMIT = 32;
  private readonly sessions = new Map<SessionId, SessionState>();
  private permissionPrompter:
    | ((req: RequestPermissionRequest) => Promise<RequestPermissionResponse>)
    | null = null;
  private exitListeners = new Set<() => void>();
  private shuttingDown = false;
  private readonly vaultMcp: McpServerConfig;
  private readonly bridge: PermissionBridge;
  /**
   * Process-scoped cache of the SDK's model catalog. Populated lazily by
   * `ensureModelCatalog()` so we only spawn one extra `claude` subprocess
   * per backend lifetime. Each `ModelInfo` carries `supportsEffort` and
   * `supportedEffortLevels`, which drive the dynamic effort dropdown.
   */
  private cachedModels: ModelInfo[] | null = null;
  private cachedModelsProbe: Promise<ModelInfo[]> | null = null;

  constructor(private readonly opts: ClaudeSdkBackendProcessOptions) {
    this.bridge = new PermissionBridge({
      getPrompter: () => this.permissionPrompter,
      askUserQuestion: opts.askUserQuestion,
      isPlanModePlanFilePath: opts.isPlanModePlanFilePath,
    });
    this.vaultMcp = createVaultMcpServer(opts.app.vault) as unknown as McpServerConfig;
    logInfo(
      `[AgentMode] ClaudeSdkBackendProcess constructed (claude=${opts.pathToClaudeCodeExecutable})`
    );
  }

  isRunning(): boolean {
    return !this.shuttingDown;
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  setPermissionPrompter(
    fn: (req: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  ): void {
    this.permissionPrompter = fn;
  }

  registerSessionHandler(sessionId: SessionId, handler: SessionUpdateHandler): () => void {
    this.sessionHandlers.set(sessionId, handler);
    const buffered = this.pendingUpdates.get(sessionId);
    if (buffered) {
      this.pendingUpdates.delete(sessionId);
      for (const update of buffered) {
        try {
          handler(update);
        } catch (e) {
          logWarn(`[AgentMode] replay of buffered SDK notification threw for ${sessionId}`, e);
        }
      }
    }
    return () => {
      if (this.sessionHandlers.get(sessionId) === handler) {
        this.sessionHandlers.delete(sessionId);
      }
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    logSdkOutbound("newSession", { cwd: params.cwd, mcpServers: params.mcpServers });
    const sessionId = uuidv4();
    const cwd = (params.cwd as string | undefined) ?? null;
    const mcp: Record<string, McpServerConfig> = {};
    for (const server of params.mcpServers ?? []) {
      const cfg = acpMcpServerToSdkConfig(server);
      if (cfg) mcp[server.name] = cfg;
    }
    // Resolve the catalog before returning so the picker never sees an
    // empty model list. The preloader populates `getCachedCatalog` at
    // plugin load → first newSession is instant; on a probe miss this
    // still spawns at most one subprocess (deduped via cachedModelsProbe).
    const catalog = await this.ensureModelCatalog();
    const preferred = this.opts.getPreferredModelId?.();
    const seedModelId = resolveSeedModelId(catalog, preferred);

    this.sessions.set(sessionId, {
      cwd,
      firstPromptStarted: false,
      mcpServers: mcp,
      model: seedModelId,
    });

    const modelInfo = seedModelId ? catalog.find((m) => m.value === seedModelId) : undefined;
    const effortOpt = synthesizeEffortConfigOption(modelInfo, undefined);
    const models =
      catalog.length > 0 && seedModelId
        ? {
            currentModelId: seedModelId,
            availableModels: catalog.map((m) => ({ modelId: m.value, name: m.displayName })),
          }
        : null;

    const resp: NewSessionResponse = { sessionId };
    if (models) resp.models = models;
    if (effortOpt) resp.configOptions = [effortOpt];

    logSdkOutboundResult(
      "newSession",
      { sessionId, currentModelId: seedModelId ?? null, hasEffort: !!effortOpt },
      sessionId
    );
    return resp;
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown session ${params.sessionId}`);
    }

    // Streaming-input mode (AsyncIterable) is required to expose
    // interrupt/setModel/setPermissionMode on the returned Query — without it
    // those control calls reject with "only available in streaming input mode".
    const promptText = extractPromptText(params);
    const promptStream = makePromptStream(promptText, params.sessionId);

    this.bridge.setSessionContext(params.sessionId);

    const options: Options = {
      pathToClaudeCodeExecutable: this.opts.pathToClaudeCodeExecutable,
      cwd: session.cwd ?? undefined,
      includePartialMessages: true,
      mcpServers: { ...session.mcpServers, [VAULT_MCP_SERVER_NAME]: this.vaultMcp },
      // Disallow built-in filesystem read/edit tools so the agent only mutates
      // files through the vault MCP (which routes through Obsidian's
      // modify/create events for sync, frontmatter, and listener parity).
      // `Write` is intentionally NOT disallowed here: plan mode writes its
      // proposal to a path outside the vault (`~/.claude/plans/<slug>.md`),
      // and a hard SDK-level block would short-circuit the turn before our
      // permission bridge ever sees the call. Instead the bridge's
      // `canUseTool` auto-allows Writes whose `file_path` matches the
      // descriptor's `isPlanModePlanFilePath` predicate and denies every
      // other Write. Leaving `Write` out of `allowedTools` keeps that
      // gating in effect.
      disallowedTools: ["Read", "Edit"],
      allowedTools: [
        `mcp__${VAULT_MCP_SERVER_NAME}__vault_read`,
        `mcp__${VAULT_MCP_SERVER_NAME}__vault_list`,
        `mcp__${VAULT_MCP_SERVER_NAME}__vault_glob`,
        `mcp__${VAULT_MCP_SERVER_NAME}__vault_grep`,
        "Glob",
        "Grep",
      ],
      canUseTool: this.bridge.canUseTool,
    };
    if (session.firstPromptStarted) {
      options.resume = params.sessionId;
    } else {
      // First turn: tell the SDK to use *our* pre-allocated session id so
      // future `resume` calls match.
      options.sessionId = params.sessionId;
    }
    if (session.model) options.model = session.model;
    if (session.permissionMode) options.permissionMode = session.permissionMode;
    if (session.effort) options.effort = session.effort;
    if (this.opts.getEnableThinking?.()) {
      options.thinking = { type: "adaptive" };
    }

    logSdkOutbound(
      "prompt",
      {
        prompt: promptText,
        resume: options.resume ?? null,
        sessionIdSeed: options.sessionId ?? null,
        model: options.model ?? null,
        permissionMode: options.permissionMode ?? null,
        effort: options.effort ?? null,
        mcpServers: Object.keys(options.mcpServers ?? {}),
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
      },
      params.sessionId
    );

    const q = query({ prompt: promptStream, options });
    session.active = q;
    session.firstPromptStarted = true;

    const translatorState = createTranslatorState();
    let stopReason: StopReason = "end_turn";
    let resultErrorMessage: string | null = null;
    try {
      for await (const sdkMsg of q) {
        if (this.shuttingDown) break;
        logSdkInbound(describeSdkMessage(sdkMsg), sdkMsg, params.sessionId);
        const notifications = translateSdkMessage(sdkMsg, params.sessionId, translatorState);
        for (const n of notifications) this.dispatchNotification(n);
        if (sdkMsg.type === "result") {
          stopReason = mapStopReason(sdkMsg);
          if (stopReason !== "end_turn" && sdkMsg.subtype !== "success") {
            const errs = "errors" in sdkMsg ? sdkMsg.errors : undefined;
            if (errs && errs.length > 0) {
              resultErrorMessage = errs.join("; ");
            }
          }
          break;
        }
      }
    } finally {
      if (session.active === q) session.active = undefined;
      this.bridge.clearSessionContext();
    }

    if (resultErrorMessage) {
      logSdkError("→", "prompt", { error: resultErrorMessage }, params.sessionId);
      throw new Error(resultErrorMessage);
    }
    logSdkOutboundResult("prompt", { stopReason }, params.sessionId);
    return { stopReason };
  }

  async cancel(params: CancelNotification): Promise<void> {
    logSdkOutbound("cancel", {}, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    if (!session?.active) return;
    try {
      await session.active.interrupt();
    } catch (e) {
      logWarn("[AgentMode] SDK query.interrupt() threw", e);
      logSdkError("→", "interrupt", { error: err2String(e) }, params.sessionId);
    }
  }

  async setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    logSdkOutbound("setSessionModel", { modelId: params.modelId }, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    session.model = params.modelId;
    // `newSession` awaits `ensureModelCatalog()` before returning, so by the
    // time the UI can issue setSessionModel the catalog is cached. If a probe
    // failure left it empty, we skip the clamp and the next model change
    // after a successful probe will re-clamp.
    if (this.cachedModels && session.effort) {
      const info = this.cachedModels.find((m) => m.value === params.modelId);
      const levels = info?.supportedEffortLevels ?? [];
      if (!levels.includes(session.effort)) {
        session.effort = levels[0];
      }
    }
    this.emitEffortConfigOptionUpdate(params.sessionId);
    if (session.active) {
      try {
        await session.active.setModel(params.modelId);
      } catch (e) {
        logWarn("[AgentMode] SDK query.setModel() threw (will apply on next turn)", e);
        logSdkError("→", "setModel", { error: err2String(e) }, params.sessionId);
      }
    }
    return {};
  }

  isSetSessionModelSupported(): boolean | null {
    return true;
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    logSdkOutbound("setSessionMode", { modeId: params.modeId }, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    const mode = canonicalModeToSdk(params.modeId);
    if (!mode) {
      throw new Error(`Unsupported mode ${params.modeId}`);
    }
    session.permissionMode = mode;
    if (session.active) {
      try {
        await session.active.setPermissionMode(mode);
      } catch (e) {
        logWarn("[AgentMode] SDK query.setPermissionMode() threw (will apply on next turn)", e);
        logSdkError("→", "setPermissionMode", { error: err2String(e) }, params.sessionId);
      }
    }
    return {};
  }

  isSetSessionModeSupported(): boolean | null {
    return true;
  }

  /**
   * Only `effort` is exposed as a session config option for this backend.
   * We synthesize the option from the SDK's per-model
   * `ModelInfo.supportedEffortLevels`, store the pick on the session, and
   * apply it as `options.effort` on the next `query()` — the SDK has no
   * runtime RPC for changing effort mid-turn.
   */
  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest
  ): Promise<SetSessionConfigOptionResponse> {
    logSdkOutbound(
      "setSessionConfigOption",
      { configId: params.configId, value: params.value },
      params.sessionId
    );
    if (params.configId !== "effort") {
      throw new MethodUnsupportedError("session/set_config_option");
    }
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    const models = await this.ensureModelCatalog();
    const modelInfo = models.find((m) => m.value === session.model);
    const levels = modelInfo?.supportedEffortLevels ?? [];
    if (!levels.includes(params.value as EffortLevel)) {
      throw new Error(
        `Effort '${params.value}' not supported by ${session.model ?? "default model"}`
      );
    }
    session.effort = params.value as EffortLevel;
    const opt = synthesizeEffortConfigOption(modelInfo, session.effort);
    return { configOptions: opt ? [opt] : [] };
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return true;
  }

  async listSessions(_params: ListSessionsRequest): Promise<ListSessionsResponse> {
    throw new MethodUnsupportedError("session/list");
  }

  async resumeSession(_params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    throw new MethodUnsupportedError("session/resume");
  }

  async loadSession(_params: LoadSessionRequest): Promise<LoadSessionResponse> {
    throw new MethodUnsupportedError("session/load");
  }

  supportsMcpTransport(_transport: "http" | "sse"): boolean {
    return true;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const session of this.sessions.values()) {
      const q = session.active;
      if (!q) continue;
      try {
        await q.interrupt();
      } catch (e) {
        logWarn("[AgentMode] interrupt during shutdown threw", e);
      }
    }
    this.sessions.clear();
    this.sessionHandlers.clear();
    this.pendingUpdates.clear();
    for (const fn of this.exitListeners) {
      try {
        fn();
      } catch (e) {
        logWarn("[AgentMode] SDK exit listener threw", e);
      }
    }
    this.exitListeners.clear();
  }

  /**
   * Resolve the SDK's model catalog. Prefers the descriptor's preload
   * cache (populated once per plugin lifetime by `probeInitialState`)
   * over an on-demand probe — only the first session before preload
   * completes (or after a probe failure) actually spawns a subprocess.
   * Failures resolve to `[]` so callers degrade gracefully.
   */
  private ensureModelCatalog(): Promise<ModelInfo[]> {
    if (this.cachedModels) return Promise.resolve(this.cachedModels);
    const fromDescriptor = this.opts.getCachedCatalog?.();
    if (fromDescriptor && fromDescriptor.length > 0) {
      this.cachedModels = fromDescriptor;
      return Promise.resolve(fromDescriptor);
    }
    if (this.cachedModelsProbe) return this.cachedModelsProbe;
    const probePromise = probeClaudeSdkCatalog(this.opts.pathToClaudeCodeExecutable).then(
      (models) => {
        if (models.length > 0) this.cachedModels = models;
        else this.cachedModelsProbe = null;
        return models;
      }
    );
    this.cachedModelsProbe = probePromise;
    return probePromise;
  }

  /**
   * Push a `config_option_update` for the given session reflecting the
   * current model's effort vocabulary. No-op when the catalog hasn't
   * arrived yet or the active model doesn't support effort.
   */
  private emitEffortConfigOptionUpdate(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const models = this.cachedModels;
    if (!models) return;
    const modelInfo = models.find((m) => m.value === session.model);
    const opt = synthesizeEffortConfigOption(modelInfo, session.effort);
    this.dispatchNotification({
      sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: opt ? [opt] : [],
      },
    });
  }

  private dispatchNotification(notification: SessionNotification): void {
    const handler = this.sessionHandlers.get(notification.sessionId);
    if (!handler) {
      let queue = this.pendingUpdates.get(notification.sessionId);
      if (!queue) {
        queue = [];
        this.pendingUpdates.set(notification.sessionId, queue);
      }
      if (queue.length >= ClaudeSdkBackendProcess.PENDING_UPDATE_LIMIT) {
        const kind = notification.update.sessionUpdate;
        logWarn(
          `[AgentMode] dropping SDK notification for ${notification.sessionId}: pending buffer full (${queue.length}, kind=${kind})`
        );
        return;
      }
      queue.push(notification);
      return;
    }
    try {
      handler(notification);
    } catch (e) {
      logError(`[AgentMode] SDK notification handler threw for ${notification.sessionId}`, e);
    }
  }
}

function extractPromptText(req: PromptRequest): string {
  const parts: string[] = [];
  for (const block of req.prompt) {
    if (block.type === "text" && block.text.length > 0) parts.push(block.text);
  }
  return parts.join("\n");
}

async function* makePromptStream(
  text: string,
  sessionId: SessionId
): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

function acpMcpServerToSdkConfig(server: AcpMcpServer): McpServerConfig | null {
  if ("type" in server && server.type === "http") {
    return { type: "http", url: server.url, headers: kvListToRecord(server.headers) };
  }
  if ("type" in server && server.type === "sse") {
    return { type: "sse", url: server.url, headers: kvListToRecord(server.headers) };
  }
  if ("command" in server) {
    return {
      type: "stdio",
      command: server.command,
      args: server.args ?? [],
      env: kvListToRecord(server.env),
    };
  }
  return null;
}

function kvListToRecord(
  list: Array<{ name: string; value: string }> | undefined
): Record<string, string> | undefined {
  if (!list || list.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const { name, value } of list) out[name] = value;
  return out;
}

function canonicalModeToSdk(modeId: string): PermissionMode | null {
  switch (modeId) {
    case "default":
    case "acceptEdits":
    case "bypassPermissions":
    case "plan":
      return modeId;
    default:
      return null;
  }
}
