import { logError, logInfo, logWarn } from "@/logger";
import {
  CancelNotification,
  ClientSideConnection,
  ListSessionsRequest,
  ListSessionsResponse,
  NewSessionRequest,
  NewSessionResponse,
  PROTOCOL_VERSION,
  PromptRequest,
  PromptResponse,
  RequestError,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionId,
  SessionNotification,
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
  private permissionPrompter:
    | ((req: RequestPermissionRequest) => Promise<RequestPermissionResponse>)
    | null = null;
  private exitListeners = new Set<() => void>();
  /** Tri-state: null = not yet probed, true/false = result of first probe. */
  private setSessionModelSupported: boolean | null = null;
  /** Whether the agent advertised `sessionCapabilities.list` at initialize time. */
  private listSessionsSupported = false;

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
      this.permissionPrompter = null;
      this.setSessionModelSupported = null;
      this.listSessionsSupported = false;
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
      this.listSessionsSupported = init.agentCapabilities?.sessionCapabilities?.list != null;
      logInfo(
        `[AgentMode] initialized backend ${this.backend.id} (negotiated protocol v${init.protocolVersion}, listSessions=${this.listSessionsSupported})`
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

  /**
   * Switch the active model for an ACP session via `unstable_setSessionModel`.
   *
   * The capability is marked unstable in the spec — agents may not implement
   * it. On the first JSON-RPC method-not-found (-32601), we cache the negative
   * result and rethrow as a typed `MethodUnsupportedError` so callers can
   * gracefully degrade. Subsequent calls short-circuit without hitting the
   * wire.
   */
  async setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    if (this.setSessionModelSupported === false) {
      throw new MethodUnsupportedError("session/set_model");
    }
    try {
      const resp = await this.requireConnection().unstable_setSessionModel(params);
      this.setSessionModelSupported = true;
      return resp;
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        this.setSessionModelSupported = false;
        throw new MethodUnsupportedError("session/set_model");
      }
      throw err;
    }
  }

  /**
   * Whether `unstable_setSessionModel` is known to be supported. Returns
   * `null` if no probe has happened yet — callers should attempt a call and
   * catch `MethodUnsupportedError` to materialize the result.
   */
  isSetSessionModelSupported(): boolean | null {
    return this.setSessionModelSupported;
  }

  /**
   * List sessions tracked by the agent (subset matching `cwd` /
   * `additionalDirectories` filters). Throws `MethodUnsupportedError` if the
   * agent did not advertise the `list` capability at initialize, or if the
   * connection rejects with a JSON-RPC method-not-found.
   *
   * Used to pull agent-generated session titles for backends like opencode
   * that persist titles internally but don't push `session_info_update`
   * notifications.
   */
  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    if (!this.listSessionsSupported) {
      throw new MethodUnsupportedError("session/list");
    }
    try {
      return await this.requireConnection().listSessions(params);
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        this.listSessionsSupported = false;
        throw new MethodUnsupportedError("session/list");
      }
      throw err;
    }
  }

  /** Whether the agent advertised the `session/list` capability. */
  isListSessionsSupported(): boolean {
    return this.listSessionsSupported;
  }

  /**
   * Tear down the subprocess. Cancels nothing on the agent side beyond
   * closing stdin (opencode self-exits when the parent goes away), so call
   * `cancel()` on each session first if you want graceful turn cancellation.
   */
  async shutdown(): Promise<void> {
    this.connection = null;
    this.sessionHandlers.clear();
    this.permissionPrompter = null;
    this.setSessionModelSupported = null;
    this.listSessionsSupported = false;
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
      logWarn(`[AgentMode] dropping session/update for unknown session ${sessionId}`);
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
