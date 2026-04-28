import { logError, logInfo, logWarn } from "@/logger";
import {
  CancelNotification,
  ClientSideConnection,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PROTOCOL_VERSION,
  PromptRequest,
  PromptResponse,
  RequestError,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionId,
  SessionNotification,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import { App, FileSystemAdapter } from "obsidian";
import { AcpProcessManager, AcpProcessManagerOptions } from "./AcpProcessManager";
import { VaultClient } from "./VaultClient";
import { wrapStreamsForDebug } from "./debugTap";
import { AcpBackend, JSONRPC_METHOD_NOT_FOUND, MethodUnsupportedError } from "./types";

/**
 * Capabilities the agent may or may not implement. Tracked in a single Set so
 * adding a new capability is one constant + one branch in the unsupported
 * handler instead of touching reset / probe / getter sites.
 */
export type AcpCapability =
  | "session/list"
  | "session/resume"
  | "session/load"
  | "session/set_model"
  | "session/set_config_option"
  | "mcp/http"
  | "mcp/sse";

/**
 * Detect a JSON-RPC -32601 (method not found) error from the ACP SDK. The SDK
 * surfaces these as `RequestError` instances; we also tolerate plain objects
 * shaped like `{ code: number }` defensively.
 */
function isMethodNotFoundError(err: unknown): boolean {
  if (err instanceof RequestError) return err.code === JSONRPC_METHOD_NOT_FOUND;
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as { code: unknown }).code === JSONRPC_METHOD_NOT_FOUND;
  }
  return false;
}

const COPILOT_CLIENT_NAME = "obsidian-copilot";

export type SessionUpdateHandler = (update: SessionNotification) => void;

/**
 * One-per-vault wrapper around an ACP-speaking subprocess. Owns the
 * `ClientSideConnection`, the `AcpProcessManager`, and the demultiplexer
 * that fans `session/update` notifications out to the right `AgentSession`.
 *
 * Lifecycle: `start()` exactly once, then any number of `newSession`/`prompt`
 * calls, finally `shutdown()`. All sessions on this backend share the
 * subprocess and die together if it exits.
 */
export class AcpBackendProcess {
  private process: AcpProcessManager | null = null;
  private connection: ClientSideConnection | null = null;
  private readonly sessionHandlers = new Map<SessionId, SessionUpdateHandler>();
  /**
   * Per-session FIFO of `session/update` notifications that arrived before a
   * handler was registered. Some agents (e.g. claude-agent-acp) emit
   * notifications for a freshly-created session *before* the `session/new`
   * response on the wire — by the time the caller learns the sessionId and
   * registers a handler, the notification has already been routed. Buffer it
   * here and replay on registration. Bounded to avoid leaking when no handler
   * ever registers (e.g. preloader probe).
   */
  private readonly pendingUpdates = new Map<SessionId, SessionNotification[]>();
  private static readonly PENDING_UPDATE_LIMIT = 32;
  private permissionPrompter:
    | ((req: RequestPermissionRequest) => Promise<RequestPermissionResponse>)
    | null = null;
  private exitListeners = new Set<() => void>();
  /**
   * Set of capabilities currently believed supported. Populated at
   * `initialize` time (from `agentCapabilities`) and on first probe for
   * unstable methods. A `MethodNotFound` reply removes the entry.
   *
   * `probedCapabilities` distinguishes "we haven't tried yet" from "we
   * tried and it's unsupported" for unstable RPCs (set_model,
   * set_config_option) that have no initialize-time capability flag.
   */
  private capabilities = new Set<AcpCapability>();
  private probedCapabilities = new Set<AcpCapability>();

  constructor(
    private readonly app: App,
    private readonly backend: AcpBackend,
    private readonly clientVersion: string
  ) {}

  /**
   * Spawn the subprocess and complete the ACP `initialize` handshake.
   * Idempotent: a second call while an existing connection is live is a
   * no-op.
   */
  async start(): Promise<void> {
    if (this.connection) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    const descriptor = await this.backend.buildSpawnDescriptor({
      vaultBasePath: adapter.getBasePath(),
    });

    const procOpts: AcpProcessManagerOptions = {
      command: descriptor.command,
      args: descriptor.args,
      env: descriptor.env,
      logTag: this.backend.id,
    };
    const proc = new AcpProcessManager(procOpts);
    this.process = proc;
    const raw = proc.start();
    const { stdin, stdout } = wrapStreamsForDebug(raw.stdin, raw.stdout, this.backend.id);

    proc.onExit(() => {
      logWarn(`[AgentMode] backend ${this.backend.id} exited`);
      // Tear down our view of the connection so any subsequent newSession /
      // prompt / cancel calls fail fast with a clear error instead of
      // throwing through a half-dead `ClientSideConnection`.
      this.connection = null;
      this.sessionHandlers.clear();
      this.pendingUpdates.clear();
      this.permissionPrompter = null;
      this.capabilities.clear();
      this.probedCapabilities.clear();
      for (const fn of this.exitListeners) {
        try {
          fn();
        } catch (e) {
          logWarn("[AgentMode] exit listener threw", e);
        }
      }
    });

    const stream = ndJsonStream(stdin, stdout);
    const client = new VaultClient(this.app, {
      onSessionUpdate: (sessionId, update) => this.routeSessionUpdate(sessionId, update),
      requestPermission: (req) => this.handlePermission(req),
    });
    this.connection = new ClientSideConnection(() => client, stream);

    try {
      const init = await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: {
          name: COPILOT_CLIENT_NAME,
          version: this.clientVersion,
        },
      });
      if (init.agentCapabilities?.sessionCapabilities?.list != null) {
        this.capabilities.add("session/list");
      }
      if (init.agentCapabilities?.sessionCapabilities?.resume != null) {
        this.capabilities.add("session/resume");
      }
      if (init.agentCapabilities?.loadSession === true) {
        this.capabilities.add("session/load");
      }
      // Stdio MCP transport is required by ACP (no flag); http/sse are opt-in.
      if (init.agentCapabilities?.mcpCapabilities?.http === true) {
        this.capabilities.add("mcp/http");
      }
      if (init.agentCapabilities?.mcpCapabilities?.sse === true) {
        this.capabilities.add("mcp/sse");
      }
      logInfo(
        `[AgentMode] initialized backend ${this.backend.id} (negotiated protocol v${init.protocolVersion}, listSessions=${this.hasCapability("session/list")}, resumeSession=${this.hasCapability("session/resume")}, loadSession=${this.hasCapability("session/load")}, mcp.http=${this.hasCapability("mcp/http")}, mcp.sse=${this.hasCapability("mcp/sse")})`
      );
    } catch (err) {
      // Initialize failed (bad binary, version mismatch, MCP boot error). The
      // child has been spawned and is still alive — without this we'd leak
      // the subprocess and AgentSessionManager would retry against a stale
      // PID on the next call.
      logError(
        `[AgentMode] initialize failed for ${this.backend.id}; tearing down subprocess`,
        err
      );
      this.connection = null;
      try {
        await proc.shutdown();
      } catch (e) {
        logError("[AgentMode] shutdown after failed initialize threw", e);
      }
      this.process = null;
      throw err;
    }
  }

  isRunning(): boolean {
    return this.process?.isRunning() ?? false;
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /**
   * Set the permission prompter. There can be only one — the modal is global.
   */
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
          logWarn(`[AgentMode] replay of buffered session/update threw for ${sessionId}`, e);
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
    return this.requireConnection().newSession(params);
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    return this.requireConnection().prompt(params);
  }

  async cancel(params: CancelNotification): Promise<void> {
    return this.requireConnection().cancel(params);
  }

  /** Whether the agent currently supports `cap`. */
  hasCapability(cap: AcpCapability): boolean {
    return this.capabilities.has(cap);
  }

  /**
   * Switch the active model for an ACP session via `unstable_setSessionModel`.
   * Capability is marked unstable in the spec — see `probedCall`.
   */
  async setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    return this.probedCall("session/set_model", (c) => c.unstable_setSessionModel(params));
  }

  isSetSessionModelSupported(): boolean | null {
    return this.probedCapabilitySupported("session/set_model");
  }

  /**
   * Set a session configuration option (e.g. claude-code's "effort" select).
   * Not all agents implement `session/set_config_option` — see `probedCall`.
   */
  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest
  ): Promise<SetSessionConfigOptionResponse> {
    return this.probedCall("session/set_config_option", (c) => c.setSessionConfigOption(params));
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return this.probedCapabilitySupported("session/set_config_option");
  }

  /**
   * Run an unstable RPC that has no initialize-time capability flag. On the
   * first JSON-RPC method-not-found (-32601), cache the negative result and
   * rethrow as `MethodUnsupportedError` so subsequent calls short-circuit
   * without hitting the wire.
   */
  private async probedCall<T>(
    capability: AcpCapability,
    run: (c: ClientSideConnection) => Promise<T>
  ): Promise<T> {
    if (this.probedCapabilities.has(capability) && !this.capabilities.has(capability)) {
      throw new MethodUnsupportedError(capability);
    }
    try {
      const resp = await run(this.requireConnection());
      this.capabilities.add(capability);
      this.probedCapabilities.add(capability);
      return resp;
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        this.capabilities.delete(capability);
        this.probedCapabilities.add(capability);
        throw new MethodUnsupportedError(capability);
      }
      throw err;
    }
  }

  /** Tri-state: `null` before first probe, `true`/`false` after. */
  private probedCapabilitySupported(capability: AcpCapability): boolean | null {
    if (!this.probedCapabilities.has(capability)) return null;
    return this.capabilities.has(capability);
  }

  /**
   * List sessions tracked by the agent (subset matching `cwd` /
   * `additionalDirectories` filters). Throws `MethodUnsupportedError` if the
   * agent did not advertise the `list` capability.
   */
  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    return this.callCapability("session/list", () => this.requireConnection().listSessions(params));
  }

  /**
   * Resume a previously-created session by id. Per ACP, resume restores the
   * session context *without* replaying message history; the response carries
   * the same `models` field as `session/new`. Throws `MethodUnsupportedError`
   * when the agent did not advertise `sessionCapabilities.resume`.
   */
  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    return this.callCapability("session/resume", () =>
      this.requireConnection().resumeSession(params)
    );
  }

  /**
   * Load a previously-created session by id. Per ACP, load restores context
   * *and* streams the entire conversation history back as `session/update`
   * notifications. Returns the same `models` field as `session/new`.
   */
  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    return this.callCapability("session/load", () => this.requireConnection().loadSession(params));
  }

  private async callCapability<T>(cap: AcpCapability, run: () => Promise<T>): Promise<T> {
    if (!this.capabilities.has(cap)) {
      throw new MethodUnsupportedError(cap);
    }
    try {
      return await run();
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        this.capabilities.delete(cap);
        throw new MethodUnsupportedError(cap);
      }
      throw err;
    }
  }

  /**
   * Tear down the subprocess. Cancels nothing on the agent side beyond
   * closing stdin (opencode self-exits when the parent goes away), so call
   * `cancel()` on each session first if you want graceful turn cancellation.
   */
  async shutdown(): Promise<void> {
    this.connection = null;
    this.sessionHandlers.clear();
    this.pendingUpdates.clear();
    this.permissionPrompter = null;
    this.capabilities.clear();
    this.probedCapabilities.clear();
    if (this.process) {
      try {
        await this.process.shutdown();
      } catch (e) {
        logError("[AgentMode] backend shutdown failed", e);
      }
      this.process = null;
    }
  }

  private requireConnection(): ClientSideConnection {
    if (!this.connection) {
      throw new Error(
        this.process
          ? "AcpBackendProcess subprocess has exited"
          : "AcpBackendProcess.start() not called"
      );
    }
    return this.connection;
  }

  private routeSessionUpdate(sessionId: SessionId, update: SessionNotification): void {
    const handler = this.sessionHandlers.get(sessionId);
    if (!handler) {
      let queue = this.pendingUpdates.get(sessionId);
      if (!queue) {
        queue = [];
        this.pendingUpdates.set(sessionId, queue);
      }
      if (queue.length >= AcpBackendProcess.PENDING_UPDATE_LIMIT) {
        // Include the update kind so a future investigator can tell *which*
        // notification got lost (e.g. session_info_update vs. message chunk).
        const kind =
          (update as { update?: { sessionUpdate?: string } }).update?.sessionUpdate ?? "unknown";
        logWarn(
          `[AgentMode] dropping session/update for ${sessionId}: pending buffer full (${queue.length}, kind=${kind})`
        );
        return;
      }
      queue.push(update);
      return;
    }
    handler(update);
  }

  private async handlePermission(
    req: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    if (!this.permissionPrompter) {
      logWarn(`[AgentMode] permission requested but no prompter is registered; auto-cancelling`);
      return { outcome: { outcome: "cancelled" } };
    }
    return this.permissionPrompter(req);
  }
}
