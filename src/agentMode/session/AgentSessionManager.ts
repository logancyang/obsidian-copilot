import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentChatPersistenceManager } from "@/agentMode/session/AgentChatPersistenceManager";
import { getSettings, setSettings } from "@/settings/model";
import { err2String } from "@/utils";
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { App, FileSystemAdapter, Platform, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import { AgentSession } from "./AgentSession";
import type { AgentModelPreloader } from "./AgentModelPreloader";
import type { BackendDescriptor, BackendId } from "./types";

/** Trailing-edge debounce window for persisting message changes to disk. */
const SAVE_DEBOUNCE_MS = 500;

export type PermissionPrompter = (
  req: RequestPermissionRequest
) => Promise<RequestPermissionResponse>;

// Injected by the barrel so `session/` doesn't have to import
// `backends/registry` directly (would breach the layer boundary).
export type DescriptorResolver = (id: BackendId) => BackendDescriptor | undefined;

export interface AgentSessionManagerOptions {
  permissionPrompter: PermissionPrompter;
  resolveDescriptor: DescriptorResolver;
  /** Persistence sink for session message changes. Required so the history list reflects live sessions. */
  persistence: AgentChatPersistenceManager;
}

/**
 * Plugin-scoped coordinator for Agent Mode. Owns one `AcpBackendProcess` per
 * registered backend (lazy-spawned on first `createSession(backendId)`) and a
 * pool of `AgentSession`s, each tagged with the backend it was created on.
 * Tears every backend down on plugin unload via `shutdown()`.
 *
 * Backend pluggability is handled via `BackendDescriptor`: the manager
 * resolves descriptors from `backendRegistry` and calls
 * `descriptor.createBackend(plugin)` to construct each `AcpBackend` — it
 * never imports a specific backend class. The permission prompter is
 * injected so this file stays out of the UI layer.
 */
export class AgentSessionManager {
  private backends = new Map<BackendId, AcpBackendProcess>();
  private starting = new Map<BackendId, Promise<AcpBackendProcess>>();
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
  private preloader: AgentModelPreloader | null = null;
  /** File path each session is currently persisted to. Unset until first save lands. */
  private sessionFilePaths = new Map<string, string>();
  /** Pending debounced save handle per session. */
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per-session unsubscribe handles for the persistence listener. */
  private persistenceUnsubs = new Map<string, () => void>();

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
   * Spawn a fresh `AgentSession`. Lazily starts the requested backend on its
   * first call. The new session becomes the active one. `backendId` defaults
   * to `settings.agentMode.activeBackend` (the model-picker keeps that in
   * sync with the user's most recently selected default model).
   */
  async createSession(backendId?: BackendId): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    const vaultBasePath = adapter.getBasePath();

    const resolvedId = backendId ?? getSettings().agentMode?.activeBackend ?? "opencode";
    const descriptor = this.resolveDescriptor(resolvedId);

    this.pendingCreates++;
    this.isStarting = true;
    this.notify();

    try {
      const backend = await this.ensureBackend(resolvedId, descriptor);
      const preferredModelId = descriptor.getPreferredModelId?.(getSettings());
      const session = await AgentSession.create(
        backend,
        vaultBasePath,
        uuidv4(),
        resolvedId,
        preferredModelId
      );
      // Shutdown may have raced with us. If so, dispose the freshly-created
      // session instead of leaking it.
      if (this.disposed) {
        await session.dispose().catch(() => {});
        throw new Error("AgentSessionManager was shut down during session creation");
      }
      this.sessions.set(session.internalId, session);
      this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
      this.activeSessionId = session.internalId;
      this.attachPersistence(session);
      // Clear lastError on success — but not eagerly at the start of every
      // create. Eager clearing would let a second concurrent create wipe the
      // first's error before the user (or a retry handler) has seen it.
      this.lastError = null;
      logInfo(
        `[AgentMode] session created (internal=${session.internalId} acp=${session.acpSessionId} backend=${resolvedId}); pool size=${this.sessions.size}`
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

  private resolveDescriptor(backendId: BackendId): BackendDescriptor {
    const descriptor = this.opts.resolveDescriptor(backendId);
    if (!descriptor) {
      throw new Error(`Unknown backend "${backendId}". Did you forget to register it?`);
    }
    return descriptor;
  }

  setDefaultBackend(backendId: BackendId): void {
    if (getSettings().agentMode?.activeBackend === backendId) return;
    setSettings((cur) => ({
      agentMode: { ...cur.agentMode, activeBackend: backendId },
    }));
    this.notify();
  }

  /** Persist a sticky model preference for `backendId` without touching any session. */
  async persistModelSelectionFor(backendId: BackendId, modelId: string): Promise<void> {
    const descriptor = this.resolveDescriptor(backendId);
    if (!descriptor.persistModelSelection) return;
    await descriptor.persistModelSelection(modelId, this.plugin);
  }

  getBackendProcess(backendId: BackendId): AcpBackendProcess | null {
    return this.backends.get(backendId) ?? null;
  }

  attachModelPreloader(preloader: AgentModelPreloader): void {
    this.preloader = preloader;
  }

  getModelPreloader(): AgentModelPreloader | null {
    return this.preloader;
  }

  /** The persistence manager handed in at construction time. Exposed so the
   *  plugin host can call list/delete/rename without deep-importing the
   *  session layer. */
  getPersistenceManager(): AgentChatPersistenceManager {
    return this.opts.persistence;
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
    this.detachPersistence(id);
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
   * Persistence is routed through the *active session's* backend descriptor —
   * with multi-backend, the global `activeBackend` may not match the session
   * the user is interacting with. If persistence throws, the runtime change
   * still sticks for the current session.
   */
  async setActiveSessionModel(modelId: string): Promise<void> {
    const session = this.getActiveSession();
    if (!session) throw new Error("No active session");
    await session.setModel(modelId);
    try {
      const descriptor = this.resolveDescriptor(session.backendId);
      if (descriptor.getPreferredModelId?.(getSettings()) === modelId) return;
      await descriptor.persistModelSelection?.(modelId, this.plugin);
    } catch (e) {
      logWarn("[AgentMode] persistModelSelection failed", e);
    }
  }

  /**
   * Tear down every session and every spawned backend subprocess. Safe to
   * call when nothing was started; safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    logInfo(
      `[AgentMode] shutdown (pool size=${this.sessions.size}, backends=${this.backends.size})`
    );

    // Flush pending debounced saves first so the last turn isn't lost when the
    // user closes Obsidian within the debounce window. Done before dispose so
    // the sessions can still report messages.
    await Promise.allSettled(
      Array.from(this.sessions.keys()).map((id) => this.flushPersistence(id))
    );
    const allSessions = Array.from(this.sessions.values());
    for (const session of allSessions) {
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
      this.detachPersistence(session.internalId);
    }
    this.sessions.clear();
    this.chatUIStates.clear();
    this.activeSessionId = null;
    this.sessionFilePaths.clear();

    const allBackends = Array.from(this.backends.values());
    for (const proc of allBackends) {
      try {
        await proc.shutdown();
      } catch (e) {
        logError("[AgentMode] backend shutdown failed", e);
      }
    }
    this.backends.clear();
    this.starting.clear();
    this.listeners.clear();
    this.preloader?.shutdown();
    this.preloader = null;
  }

  private async ensureBackend(
    backendId: BackendId,
    descriptor: BackendDescriptor
  ): Promise<AcpBackendProcess> {
    const existing = this.backends.get(backendId);
    if (existing && existing.isRunning()) return existing;
    const inflight = this.starting.get(backendId);
    if (inflight) return inflight;

    const proc = new AcpBackendProcess(
      this.app,
      descriptor.createBackend(this.plugin),
      this.plugin.manifest.version
    );
    const startPromise = (async () => {
      await proc.start();
      proc.setPermissionPrompter(this.opts.permissionPrompter);
      proc.onExit(() => {
        // Backend died unexpectedly. Sessions belonging to *this* backend
        // are now unusable (their acp session ids are dead) — but other
        // backends keep running. Preserving message history across crashes
        // is M5.
        if (this.backends.get(backendId) === proc) this.backends.delete(backendId);
        const dead = Array.from(this.sessions.values()).filter((s) => s.backendId === backendId);
        if (dead.length === 0) return;
        for (const s of dead) {
          this.detachPersistence(s.internalId);
          this.sessions.delete(s.internalId);
          this.chatUIStates.delete(s.internalId);
          s.cancel().catch(() => {});
          s.dispose().catch(() => {});
        }
        if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) {
          const remaining = Array.from(this.sessions.keys());
          this.activeSessionId = remaining[0] ?? null;
        }
        // Surface the crash so the empty-state pill shows it and the
        // router's auto-spawn effect (which bails on lastError) doesn't
        // immediately respawn behind the user's back. The next explicit
        // create call clears it.
        this.lastError = `${descriptor.displayName} backend exited unexpectedly.`;
        this.notify();
      });
      this.backends.set(backendId, proc);
      return proc;
    })();
    this.starting.set(backendId, startPromise);
    try {
      return await startPromise;
    } finally {
      this.starting.delete(backendId);
    }
  }

  /**
   * Subscribe to a session's message and label changes and trigger debounced
   * persistence on each notification. Sessions with zero visible messages are
   * skipped at save time, so empty tabs never produce a file.
   */
  private attachPersistence(session: AgentSession): void {
    const id = session.internalId;
    const unsub = session.subscribe({
      onMessagesChanged: () => this.scheduleSave(id),
      onStatusChanged: () => {},
      onLabelChanged: () => this.scheduleSave(id),
    });
    this.persistenceUnsubs.set(id, unsub);
  }

  /**
   * Cancel any pending save and unsubscribe from the session's notifications.
   * Called when a session is closed, when its backend exits, and on shutdown.
   * Note: this does NOT delete the persisted file — that requires an explicit
   * delete via the history popover.
   */
  private detachPersistence(id: string): void {
    const timer = this.saveTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(id);
    }
    const unsub = this.persistenceUnsubs.get(id);
    if (unsub) {
      unsub();
      this.persistenceUnsubs.delete(id);
    }
  }

  private scheduleSave(id: string): void {
    const existing = this.saveTimers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.saveTimers.delete(id);
      void this.runSave(id);
    }, SAVE_DEBOUNCE_MS);
    this.saveTimers.set(id, timer);
  }

  /** Cancel the debounced timer (if any) and run the save synchronously. */
  private async flushPersistence(id: string): Promise<void> {
    const timer = this.saveTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(id);
    }
    await this.runSave(id);
  }

  private async runSave(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    const messages = session.store.getDisplayMessages();
    if (messages.length === 0) return;
    const existingPath = this.sessionFilePaths.get(id);
    try {
      const file = await this.opts.persistence.save(
        {
          messages,
          backendId: session.backendId,
          label: session.getLabel(),
          modelKey: session.getModelState()?.currentModelId ?? null,
        },
        existingPath
      );
      if (file) this.sessionFilePaths.set(id, file.path);
    } catch (e) {
      logWarn(`[AgentMode] persistence save failed for session ${id}`, e);
    }
  }

  /**
   * Load a saved agent chat into a session. If a live session is already bound
   * to this file (e.g. the user clicked an item that's already an open tab),
   * just activate that tab. Otherwise spawn a new session on the file's
   * backend, seed its message store from the file, and bind the new session
   * to the same path so subsequent saves update the same file.
   */
  async loadSessionFromHistory(file: TFile): Promise<AgentSession | null> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }

    // Switch if already open.
    for (const [id, path] of this.sessionFilePaths) {
      if (path === file.path) {
        this.setActiveSession(id);
        return this.sessions.get(id) ?? null;
      }
    }

    const loaded = await this.opts.persistence.loadFile(file);
    if (!loaded) {
      throw new Error(`File "${file.path}" is not a saved agent chat.`);
    }
    const backendId = loaded.backendId ?? getSettings().agentMode?.activeBackend ?? "opencode";
    const session = await this.createSession(backendId);
    // Bind the persistence path BEFORE seeding messages so the debounced save
    // triggered by `loadHistoryMessages` updates the existing file instead of
    // generating a fresh filename.
    this.sessionFilePaths.set(session.internalId, file.path);
    if (loaded.label) session.setLabel(loaded.label);
    session.loadHistoryMessages(loaded.messages);
    return session;
  }
}
