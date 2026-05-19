/**
 * In-process driver for the Claude Agent SDK that implements `BackendProcess`,
 * the same interface `AgentSession` consumes for ACP backends. Every SDK
 * message is translated to a session-domain `SessionEvent` and dispatched to
 * the per-session handler. From `AgentSession`'s perspective there's no
 * difference between this adapter and `AcpBackendProcess`.
 *
 * Lifecycle differs from ACP: there's no long-lived subprocess. Each
 * `prompt()` call starts a fresh `query()` (with `resume: <sessionId>` after
 * the first turn so the SDK loads prior conversation state).
 */
import { logError, logInfo, logWarn } from "@/logger";
import { err2String } from "@/utils";
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
import { translateBackendState } from "@/agentMode/session/translateBackendState";
import type {
  BackendConfigOption,
  BackendDescriptor,
  BackendProcess,
  RawModelState,
  RawModeState,
  BackendState,
  CancelInput,
  ListSessionsInput,
  ListSessionsOutput,
  LoadSessionInput,
  LoadSessionOutput,
  McpServerSpec,
  OpenSessionInput,
  OpenSessionOutput,
  PermissionDecision,
  PermissionPrompt,
  PromptInput,
  PromptOutput,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionEvent,
  SessionId,
  SessionUpdateHandler,
  StopReason,
} from "@/agentMode/session/types";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { createTranslatorState, mapStopReason, translateSdkMessage } from "./sdkMessageTranslator";
import { PermissionBridge, type AskUserQuestionHandler } from "./permissionBridge";
import {
  getCachedSdkCatalog,
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
  /**
   * Snapshot of the skill-creation system-prompt directive captured at
   * `newSession()` time so the setting change takes effect on the next
   * session rather than mid-conversation. Empty string = no directive.
   * Appended to Claude's default `claude_code` preset via
   * `options.systemPrompt.append`.
   */
  systemPromptAppend: string;
}

export interface ClaudeSdkBackendProcessOptions {
  pathToClaudeCodeExecutable: string;
  app: App;
  clientVersion: string;
  descriptor: BackendDescriptor;
  askUserQuestion?: AskUserQuestionHandler;
  /**
   * Read at the start of every `prompt()` so a settings change live-applies on
   * the next turn.
   */
  getEnableThinking?: () => boolean;
  /**
   * Predicate identifying plan-mode plan files (e.g. `~/.claude/plans/*.md`).
   * When set, `Write` calls targeting these paths are auto-allowed via
   * `canUseTool`; every other `Write` is routed through the permission
   * prompter like any other tool.
   */
  isPlanModePlanFilePath?: (absolutePath: string) => boolean;
  /**
   * Returns the user's persisted model preference. Read at session start
   * to seed `session.model` from the live catalog (so the SDK uses what
   * the picker shows, instead of falling back to its own internal default).
   */
  getDefaultModelId?: () => string | undefined;
  /**
   * Returns the spawn-time skill-creation directive to append to Claude's
   * default `claude_code` system prompt. Read once per `newSession()` so
   * a settings change applies to the next session rather than mid-turn.
   * Empty string / undefined disables the append.
   */
  getSkillCreationDirective?: () => string | undefined;
}

/**
 * Static mode catalog for the Claude SDK. `acceptEdits` and `dontAsk`
 * are intentionally excluded from the picker.
 */
const STATIC_SDK_MODES: RawModeState = {
  currentModeId: "default",
  availableModes: [
    { id: "default", name: "Default" },
    { id: "plan", name: "Plan" },
    { id: "bypassPermissions", name: "Auto" },
  ],
};

export class ClaudeSdkBackendProcess implements BackendProcess {
  private readonly sessionHandlers = new Map<SessionId, SessionUpdateHandler>();
  private readonly pendingUpdates = new Map<SessionId, SessionEvent[]>();
  private static readonly PENDING_UPDATE_LIMIT = 32;
  private readonly sessions = new Map<SessionId, SessionState>();
  private permissionPrompter: ((req: PermissionPrompt) => Promise<PermissionDecision>) | null =
    null;
  private exitListeners = new Set<() => void>();
  private shuttingDown = false;
  private readonly bridge: PermissionBridge;
  /**
   * Process-scoped cache of the SDK's model catalog. Populated lazily by
   * `ensureModelCatalog()` so we only spawn one extra `claude` subprocess
   * per backend lifetime.
   */
  private cachedModels: ModelInfo[] | null = null;
  private cachedModelsProbe: Promise<ModelInfo[]> | null = null;

  constructor(private readonly opts: ClaudeSdkBackendProcessOptions) {
    this.bridge = new PermissionBridge({
      getPrompter: () => this.permissionPrompter,
      askUserQuestion: opts.askUserQuestion,
      isPlanModePlanFilePath: opts.isPlanModePlanFilePath,
    });
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

  setPermissionPrompter(fn: (req: PermissionPrompt) => Promise<PermissionDecision>): void {
    this.permissionPrompter = fn;
  }

  registerSessionHandler(sessionId: SessionId, handler: SessionUpdateHandler): () => void {
    this.sessionHandlers.set(sessionId, handler);
    const buffered = this.pendingUpdates.get(sessionId);
    if (buffered) {
      this.pendingUpdates.delete(sessionId);
      for (const event of buffered) {
        try {
          handler(event);
        } catch (e) {
          logWarn(`[AgentMode] replay of buffered SDK event threw for ${sessionId}`, e);
        }
      }
    }
    return () => {
      if (this.sessionHandlers.get(sessionId) === handler) {
        this.sessionHandlers.delete(sessionId);
      }
    };
  }

  async newSession(params: OpenSessionInput): Promise<OpenSessionOutput> {
    logSdkOutbound("newSession", { cwd: params.cwd, mcpServers: params.mcpServers });
    const sessionId = uuidv4();
    const cwd = params.cwd ?? null;
    const mcp: Record<string, McpServerConfig> = {};
    for (const server of params.mcpServers ?? []) {
      const cfg = mcpServerSpecToSdkConfig(server);
      if (cfg) mcp[server.name] = cfg;
    }
    // Resolve the catalog before returning so the picker never sees an
    // empty model list. On a probe miss, at most one subprocess is
    // spawned (deduped via cachedModelsProbe).
    const catalog = await this.ensureModelCatalog();
    const defaultId = this.opts.getDefaultModelId?.();
    const seedModelId = resolveSeedModelId(catalog, defaultId);

    this.sessions.set(sessionId, {
      cwd,
      firstPromptStarted: false,
      mcpServers: mcp,
      model: seedModelId,
      systemPromptAppend: this.opts.getSkillCreationDirective?.() ?? "",
    });

    const state = this.computeState(sessionId);
    logSdkOutboundResult(
      "newSession",
      { sessionId, currentModelId: seedModelId ?? null, hasEffort: state.model !== null },
      sessionId
    );
    return { sessionId, state };
  }

  async prompt(params: PromptInput): Promise<PromptOutput> {
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
      mcpServers: session.mcpServers,
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "LS"],
      canUseTool: this.bridge.canUseTool,
    };
    // Append the skill-creation directive (captured at newSession time) to
    // Claude's default `claude_code` preset. The SDK's preset+append form
    // preserves the full default system prompt; we only add the directive.
    if (session.systemPromptAppend) {
      options.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: session.systemPromptAppend,
      };
    }
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
        const events = translateSdkMessage(sdkMsg, params.sessionId, translatorState);
        for (const e of events) this.dispatchEvent(e);
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

  async cancel(params: CancelInput): Promise<void> {
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

  async setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState> {
    logSdkOutbound("setSessionModel", { modelId: params.modelId }, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    session.model = params.modelId;
    if (this.cachedModels && session.effort) {
      const info = this.cachedModels.find((m) => m.value === params.modelId);
      const levels = info?.supportedEffortLevels ?? [];
      if (!levels.includes(session.effort)) {
        session.effort = levels[0];
      }
    }
    if (session.active) {
      try {
        await session.active.setModel(params.modelId);
      } catch (e) {
        logWarn("[AgentMode] SDK query.setModel() threw (will apply on next turn)", e);
        logSdkError("→", "setModel", { error: err2String(e) }, params.sessionId);
      }
    }
    const state = this.computeState(params.sessionId);
    this.dispatchStateChanged(params.sessionId, state);
    return state;
  }

  isSetSessionModelSupported(): boolean | null {
    return true;
  }

  async setSessionMode(params: { sessionId: SessionId; modeId: string }): Promise<BackendState> {
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
    const state = this.computeState(params.sessionId);
    this.dispatchStateChanged(params.sessionId, state);
    return state;
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
  async setSessionConfigOption(params: {
    sessionId: SessionId;
    configId: string;
    value: string;
  }): Promise<BackendState> {
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
    const state = this.computeState(params.sessionId);
    this.dispatchStateChanged(params.sessionId, state);
    return state;
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return true;
  }

  async listSessions(_params: ListSessionsInput): Promise<ListSessionsOutput> {
    throw new MethodUnsupportedError("session/list");
  }

  async resumeSession(_params: ResumeSessionInput): Promise<ResumeSessionOutput> {
    throw new MethodUnsupportedError("session/resume");
  }

  async loadSession(_params: LoadSessionInput): Promise<LoadSessionOutput> {
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
   * Resolve the SDK's model catalog. Falls back to an on-demand probe
   * only when the shared cache is cold; at most one subprocess is
   * spawned per backend lifetime (deduped via `cachedModelsProbe`).
   * Failures resolve to `[]` so callers degrade gracefully.
   */
  private ensureModelCatalog(): Promise<ModelInfo[]> {
    if (this.cachedModels) return Promise.resolve(this.cachedModels);
    const fromCache = getCachedSdkCatalog();
    if (fromCache && fromCache.length > 0) {
      this.cachedModels = fromCache;
      return Promise.resolve(fromCache);
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

  private computeState(sessionId: SessionId): BackendState {
    const session = this.sessions.get(sessionId);
    const catalog = this.cachedModels ?? [];
    const seedModel = session?.model;
    const models: RawModelState | null =
      catalog.length > 0 && seedModel
        ? {
            currentModelId: seedModel,
            availableModels: catalog.map((m) => ({ modelId: m.value, name: m.displayName })),
          }
        : null;
    const modes: RawModeState = {
      ...STATIC_SDK_MODES,
      currentModeId: session?.permissionMode ?? STATIC_SDK_MODES.currentModeId,
      availableModes: [...STATIC_SDK_MODES.availableModes],
    };
    const modelInfo = seedModel ? catalog.find((m) => m.value === seedModel) : undefined;
    const effortOpt = synthesizeEffortConfigOption(modelInfo, session?.effort);
    const configOptions: BackendConfigOption[] | null = effortOpt ? [effortOpt] : null;
    return translateBackendState({ models, modes, configOptions }, this.opts.descriptor);
  }

  private dispatchStateChanged(sessionId: SessionId, state: BackendState): void {
    this.dispatchEvent({
      sessionId,
      update: { sessionUpdate: "state_changed", state },
    });
  }

  private dispatchEvent(event: SessionEvent): void {
    const handler = this.sessionHandlers.get(event.sessionId);
    if (!handler) {
      let queue = this.pendingUpdates.get(event.sessionId);
      if (!queue) {
        queue = [];
        this.pendingUpdates.set(event.sessionId, queue);
      }
      if (queue.length >= ClaudeSdkBackendProcess.PENDING_UPDATE_LIMIT) {
        const kind = event.update.sessionUpdate;
        logWarn(
          `[AgentMode] dropping SDK event for ${event.sessionId}: pending buffer full (${queue.length}, kind=${kind})`
        );
        return;
      }
      queue.push(event);
      return;
    }
    try {
      handler(event);
    } catch (e) {
      logError(`[AgentMode] SDK event handler threw for ${event.sessionId}`, e);
    }
  }
}

function extractPromptText(req: PromptInput): string {
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

function mcpServerSpecToSdkConfig(server: McpServerSpec): McpServerConfig | null {
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
