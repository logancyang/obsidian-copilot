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
 * Plugin-scoped coordinator for Agent Mode. Owns a pool of `AgentSession`s
 * multiplexed on a single shared `AcpBackendProcess`. Lazily spawns the
 * backend on first `createSession()` and tears down on plugin unload via
 * `shutdown()`.
 *
 * Backend pluggability is handled via `BackendDescriptor`: the manager calls
 * `descriptor.createBackend(plugin)` and never imports a specific backend
 * class. The permission prompter is injected so this file stays out of the UI
 * layer.
 */
export class AgentSessionManager {
  private backend: AcpBackendProcess | null = null;
  private starting: Promise<AcpBackendProcess> | null = null;
  private sessions = new Map<string, AgentSession>();
  private chatUIStates = new Map<string, AgentChatUIState>();
  private activeSessionId: string | null = null;
  // Dedupe only the auto-spawn path. Direct `createSession()` calls (e.g. `+`
  // clicks) are independent — concurrent ones each spawn their own session.
  private firstSessionPromise: Promise<AgentSession> | null = null;
  private pendingCreates = 0;
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
   * Return the active `AgentSession` if one exists, otherwise create one.
   * Used by the router to lazily seed the first session on chain switch.
   * Subsequent `+` clicks should call `createSession()` directly.
   */
  async getOrCreateActiveSession(): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const active = this.getActiveSession();
    if (active && active.getStatus() !== "closed") return active;
    // Dedupe rapid auto-spawn callers (e.g. the router effect re-running
    // before the first create has populated the pool) so we don't seed two
    // sessions when one was asked for.
    if (this.firstSessionPromise) return this.firstSessionPromise;
    this.firstSessionPromise = this.createSession();
    try {
      return await this.firstSessionPromise;
    } finally {
      this.firstSessionPromise = null;
    }
  }

  /**
   * Spawn a fresh `AgentSession`. Lazily starts the shared backend on the
   * first call. The new session becomes the active one. Concurrent calls each
   * spawn their own session; the shared backend boot is serialized
   * internally via `ensureBackend()`.
   */
  async createSession(): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    const vaultBasePath = adapter.getBasePath();

    this.pendingCreates++;
    this.isStarting = true;
    this.notify();

    try {
      const backend = await this.ensureBackend();
      const preferredModelId = this.opts.descriptor.getPreferredModelId?.(getSettings());
      const session = await AgentSession.create(backend, vaultBasePath, uuidv4(), preferredModelId);
      // Shutdown may have raced with us. If so, dispose the freshly-created
      // session instead of leaking it.
      if (this.disposed) {
        await session.dispose().catch(() => {});
        throw new Error("AgentSessionManager was shut down during session creation");
      }
      this.sessions.set(session.internalId, session);
      this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
      this.activeSessionId = session.internalId;
      // Clear lastError on success — but not eagerly at the start of every
      // create. Eager clearing would let a second concurrent create wipe the
      // first's error before the user (or a retry handler) has seen it.
      this.lastError = null;
      logInfo(
        `[AgentMode] session created (internal=${session.internalId} acp=${session.acpSessionId}); pool size=${this.sessions.size}`
      );
      return session;
    } catch (err) {
      this.lastError = err2String(err);
      throw err;
    } finally {
      this.pendingCreates--;
      if (this.pendingCreates === 0) this.isStarting = false;
      this.notify();
    }
  }

  /**
   * Cancel any in-flight turn, dispose the session, and remove it from the
   * pool. If the closed session was active, picks the right neighbor (or the
   * last remaining session) as the new active — `null` when none remain.
   * Backend stays up.
   */
  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    // Capture the closed tab's index BEFORE delete so we can pick the
    // neighbor that currently sits to its right.
    const idsBefore = Array.from(this.sessions.keys());
    const closedIdx = idsBefore.indexOf(id);
    try {
      await session.cancel();
    } catch (e) {
      logWarn(`[AgentMode] cancel during closeSession failed`, e);
    }
    try {
      await session.dispose();
    } catch (e) {
      logWarn(`[AgentMode] dispose during closeSession failed`, e);
    }
    this.sessions.delete(id);
    this.chatUIStates.delete(id);
    if (this.activeSessionId === id) {
      const remaining = Array.from(this.sessions.keys());
      this.activeSessionId =
        remaining.length === 0 ? null : remaining[Math.min(closedIdx, remaining.length - 1)];
    }
    this.notify();
  }

  /** Move the active pointer to `id`. No-op if `id` is unknown. */
  setActiveSession(id: string): void {
    if (!this.sessions.has(id)) return;
    if (this.activeSessionId === id) return;
    this.activeSessionId = id;
    this.notify();
  }

  /** Update a session's user-visible label. No-op if `id` is unknown. */
  renameSession(id: string, label: string | null): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.setLabel(label);
    this.notify();
  }

  getIsStarting(): boolean {
    return this.isStarting;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getSession(id: string): AgentSession | null {
    return this.sessions.get(id) ?? null;
  }

  getChatUIState(id: string): AgentChatUIState | null {
    return this.chatUIStates.get(id) ?? null;
  }

  getActiveSession(): AgentSession | null {
    return this.activeSessionId ? (this.sessions.get(this.activeSessionId) ?? null) : null;
  }

  getActiveChatUIState(): AgentChatUIState | null {
    return this.activeSessionId ? (this.chatUIStates.get(this.activeSessionId) ?? null) : null;
  }

  /** All sessions in creation order (Map iteration order). */
  getSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Subscribe to lifecycle changes (session created/closed/active changed/
   * label changed, backend exit, isStarting/lastError flips). Returns an
   * unsubscribe function. Listeners must not throw.
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
    await this.getActiveSession()?.cancel();
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
    const session = this.getActiveSession();
    if (!session) throw new Error("No active session");
    await session.setModel(modelId);
    try {
      await this.opts.descriptor.persistModelSelection?.(modelId, this.plugin);
    } catch (e) {
      logWarn("[AgentMode] persistModelSelection failed", e);
    }
  }

  /**
   * Tear down every session and the shared backend subprocess. Safe to call
   * when nothing was started; safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    logInfo(`[AgentMode] shutdown (pool size=${this.sessions.size})`);

    const all = Array.from(this.sessions.values());
    for (const session of all) {
      try {
        await session.cancel();
      } catch (e) {
        logError("[AgentMode] cancel during shutdown failed", e);
      }
      try {
        await session.dispose();
      } catch (e) {
        logError("[AgentMode] dispose during shutdown failed", e);
      }
    }
    this.sessions.clear();
    this.chatUIStates.clear();
    this.activeSessionId = null;

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
        // Backend died unexpectedly. All sessions on this backend are now
        // unusable (their acp session ids are dead). Dispose them and clear
        // the pool — preserving message history across crashes is M5.
        if (this.backend === proc) this.backend = null;
        const dead = Array.from(this.sessions.values());
        if (dead.length === 0) return;
        this.sessions.clear();
        this.chatUIStates.clear();
        this.activeSessionId = null;
        // Surface the crash so the empty-state pill shows it and the
        // router's auto-spawn effect (which bails on lastError) doesn't
        // immediately respawn behind the user's back. The next explicit
        // create call clears it.
        this.lastError = "Agent Mode backend exited unexpectedly.";
        for (const s of dead) {
          s.cancel().catch(() => {});
          s.dispose().catch(() => {});
        }
        this.notify();
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
