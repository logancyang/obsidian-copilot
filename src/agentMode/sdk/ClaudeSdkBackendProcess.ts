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
  type McpServerConfig,
  type Options,
  type PermissionMode,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import type { BackendProcess, SessionUpdateHandler } from "@/agentMode/session/types";
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import { createTranslatorState, mapStopReason, translateSdkMessage } from "./sdkMessageTranslator";
import { createVaultMcpServer, VAULT_MCP_SERVER_NAME } from "./vaultMcpServer";
import { PermissionBridge, type AskUserQuestionHandler } from "./permissionBridge";
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

  constructor(private readonly opts: ClaudeSdkBackendProcessOptions) {
    this.bridge = new PermissionBridge({
      getPrompter: () => this.permissionPrompter,
      askUserQuestion: opts.askUserQuestion,
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
    this.sessions.set(sessionId, {
      cwd,
      firstPromptStarted: false,
      mcpServers: mcp,
    });
    logSdkOutboundResult("newSession", { sessionId }, sessionId);
    return { sessionId };
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
      // Disallow built-in filesystem tools so the agent only mutates files
      // through the vault MCP (which routes through Obsidian's modify/create
      // events for sync, frontmatter, and listener parity).
      disallowedTools: ["Read", "Write", "Edit"],
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
      logSdkError("→", "interrupt", { error: String(e) }, params.sessionId);
    }
  }

  async setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    logSdkOutbound("setSessionModel", { modelId: params.modelId }, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    session.model = params.modelId;
    if (session.active) {
      try {
        await session.active.setModel(params.modelId);
      } catch (e) {
        logWarn("[AgentMode] SDK query.setModel() threw (will apply on next turn)", e);
        logSdkError("→", "setModel", { error: String(e) }, params.sessionId);
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
        logSdkError("→", "setPermissionMode", { error: String(e) }, params.sessionId);
      }
    }
    return {};
  }

  isSetSessionModeSupported(): boolean | null {
    return true;
  }

  async setSessionConfigOption(
    _params: SetSessionConfigOptionRequest
  ): Promise<SetSessionConfigOptionResponse> {
    // The SDK has no per-session config-option RPC; effort/thinking are
    // controlled at query construction time. Surface as MethodUnsupported so
    // the picker hides the effort dropdown.
    throw new MethodUnsupportedError("session/set_config_option");
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return false;
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
