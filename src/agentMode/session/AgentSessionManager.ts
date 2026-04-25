import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { getSettings } from "@/settings/model";
import { err2String } from "@/utils";
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { App, FileSystemAdapter, Platform } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import { AgentSession } from "./AgentSession";
import type { BackendDescriptor } from "./types";

export type PermissionPrompter = (
  req: RequestPermissionRequest
) => Promise<RequestPermissionResponse>;

export interface AgentSessionManagerOptions {
  descriptor: BackendDescriptor;
  permissionPrompter: PermissionPrompter;
}

/**
 * Plugin-scoped coordinator for Agent Mode. Owns at most one `AgentSession`
 * and one shared `AcpBackendProcess`. Lazily spawns the backend on first
 * `getOrCreateActiveSession()`. Tear down on plugin unload via `shutdown()`.
 *
 * Backend pluggability is handled via `BackendDescriptor`: the manager calls
 * `descriptor.createBackend(plugin)` and never imports a specific backend
 * class. The permission prompter is injected so this file stays out of the UI
 * layer.
 */
export class AgentSessionManager {
  private backend: AcpBackendProcess | null = null;
  private starting: Promise<AcpBackendProcess> | null = null;
  private activeSession: AgentSession | null = null;
  private activeChatUIState: AgentChatUIState | null = null;
  private prepareSession: Promise<AgentSession> | null = null;
  private listeners = new Set<() => void>();
  private disposed = false;
  private isStarting = false;
  private lastError: string | null = null;

  constructor(
    private readonly app: App,
    private readonly plugin: CopilotPlugin,
    private readonly opts: AgentSessionManagerOptions
  ) {
    if (Platform.isMobile) {
      throw new Error("AgentSessionManager is desktop only");
    }
  }

  /**
   * Return the current `AgentSession`, creating one (and spawning the
   * backend) on first call. Subsequent calls return the same instance until
   * `shutdown()`. Throws if the binary isn't installed or the backend fails
   * to start.
   */
  async getOrCreateActiveSession(): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    if (this.activeSession && this.activeSession.getStatus() !== "closed") {
      return this.activeSession;
    }
    if (this.prepareSession) return this.prepareSession;

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    const vaultBasePath = adapter.getBasePath();

    this.isStarting = true;
    this.lastError = null;
    this.notify();

    this.prepareSession = (async () => {
      const backend = await this.ensureBackend();
      const preferredModelId = this.opts.descriptor.getPreferredModelId?.(getSettings());
      const session = await AgentSession.create(backend, vaultBasePath, uuidv4(), preferredModelId);
      // Shutdown may have raced with us. If so, dispose the freshly-created
      // session instead of leaking it.
      if (this.disposed) {
        await session.dispose().catch(() => {});
        throw new Error("AgentSessionManager was shut down during session creation");
      }
      this.activeSession = session;
      this.activeChatUIState = new AgentChatUIState(session);
      logInfo(`[AgentMode] active session created (acpSessionId=${session.acpSessionId})`);
      return session;
    })();

    try {
      return await this.prepareSession;
    } catch (err) {
      this.lastError = err2String(err);
      throw err;
    } finally {
      this.prepareSession = null;
      this.isStarting = false;
      this.notify();
    }
  }

  getIsStarting(): boolean {
    return this.isStarting;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getActiveSession(): AgentSession | null {
    return this.activeSession;
  }

  getActiveChatUIState(): AgentChatUIState | null {
    return this.activeChatUIState;
  }

  /**
   * Subscribe to lifecycle changes (active session set/cleared, backend
   * exit). Returns an unsubscribe function. Listeners must not throw.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logError("[AgentMode] manager listener threw", e);
      }
    }
  }

  /** Cancel any in-flight turn on the active session. Backend stays up. */
  async cancel(): Promise<void> {
    await this.activeSession?.cancel();
  }

  /**
   * Switch the active session to `modelId` and persist it as the user's
   * sticky preference (so the next session boots with the same selection).
   *
   * `modelId` is the *agent-native* identifier (whatever the backend reports
   * in `availableModels`). Mapping from a Copilot `CustomModel` to that id is
   * the descriptor's responsibility.
   *
   * The persistence step is decoupled from the live switch — if persistence
   * throws, the runtime change still sticks for the current session.
   */
  async setActiveSessionModel(modelId: string): Promise<void> {
    if (!this.activeSession) throw new Error("No active session");
    await this.activeSession.setModel(modelId);
    try {
      await this.opts.descriptor.persistModelSelection?.(modelId, this.plugin);
    } catch (e) {
      logWarn("[AgentMode] persistModelSelection failed", e);
    }
  }

  /**
   * Tear down the active session and the shared backend subprocess. Safe to
   * call when nothing was started; safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    logInfo("[AgentMode] shutdown");
    try {
      await this.activeSession?.cancel();
    } catch (e) {
      logError("[AgentMode] cancel during shutdown failed", e);
    }
    try {
      await this.activeSession?.dispose();
    } catch (e) {
      logError("[AgentMode] dispose during shutdown failed", e);
    }
    this.activeSession = null;
    this.activeChatUIState = null;

    try {
      await this.backend?.shutdown();
    } catch (e) {
      logError("[AgentMode] backend shutdown failed", e);
    }
    this.backend = null;
    this.starting = null;
    this.listeners.clear();
  }

  private async ensureBackend(): Promise<AcpBackendProcess> {
    if (this.backend && this.backend.isRunning()) return this.backend;
    if (this.starting) return this.starting;

    const proc = new AcpBackendProcess(
      this.app,
      this.opts.descriptor.createBackend(this.plugin),
      this.plugin.manifest.version
    );
    this.starting = (async () => {
      await proc.start();
      proc.setPermissionPrompter(this.opts.permissionPrompter);
      proc.onExit(() => {
        // Backend died unexpectedly. Drop our refs so the next
        // getOrCreateActiveSession() will respawn. The active session is
        // unusable without its backend's ACP session id, so dispose it and
        // null both refs — otherwise the `status !== "closed"` guard in
        // getOrCreateActiveSession would happily hand it back.
        if (this.backend === proc) this.backend = null;
        const dead = this.activeSession;
        if (dead) {
          this.activeSession = null;
          this.activeChatUIState = null;
          dead.cancel().catch(() => {});
          dead.dispose().catch(() => {});
          this.notify();
        }
      });
      this.backend = proc;
      return proc;
    })();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }
}
