import { logError, logInfo, logWarn } from "@/logger";
import {
  CancelNotification,
  ClientSideConnection,
  NewSessionRequest,
  NewSessionResponse,
  PROTOCOL_VERSION,
  PromptRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionId,
  SessionNotification,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import { App, FileSystemAdapter } from "obsidian";
import { AcpProcessManager, AcpProcessManagerOptions } from "./AcpProcessManager";
import { VaultClient } from "./VaultClient";
import { AcpBackend } from "./types";

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
    const { stdin, stdout } = proc.start();

    proc.onExit(() => {
      logWarn(`[AgentMode] backend ${this.backend.id} exited`);
      // Tear down our view of the connection so any subsequent newSession /
      // prompt / cancel calls fail fast with a clear error instead of
      // throwing through a half-dead `ClientSideConnection`.
      this.connection = null;
      this.sessionHandlers.clear();
      this.permissionPrompter = null;
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
      logInfo(
        `[AgentMode] initialized backend ${this.backend.id} (negotiated protocol v${init.protocolVersion})`
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
   * Tear down the subprocess. Cancels nothing on the agent side beyond
   * closing stdin (opencode self-exits when the parent goes away), so call
   * `cancel()` on each session first if you want graceful turn cancellation.
   */
  async shutdown(): Promise<void> {
    this.connection = null;
    this.sessionHandlers.clear();
    this.permissionPrompter = null;
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
