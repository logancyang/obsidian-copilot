import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { getSettings, setSettings } from "@/settings/model";
import { err2String } from "@/utils";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionModelState,
} from "@agentclientprotocol/sdk";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { fileToHistoryItem } from "@/utils/chatHistoryUtils";
import { App, FileSystemAdapter, Platform, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import { AgentSession } from "./AgentSession";
import type { AgentChatPersistenceManager } from "./AgentChatPersistenceManager";
import type { AgentModelPreloader } from "./AgentModelPreloader";
import type { EffortApplyContext } from "./effortAdapter";
import type { CopilotMode, ModeApplyContext } from "./modeAdapter";
import type { BackendDescriptor, BackendId } from "./types";

const AUTOSAVE_DEBOUNCE_MS = 500;

export type PermissionPrompter = (
  req: RequestPermissionRequest
) => Promise<RequestPermissionResponse>;

// Injected by the barrel so `session/` doesn't have to import
// `backends/registry` directly (would breach the layer boundary).
export type DescriptorResolver = (id: BackendId) => BackendDescriptor | undefined;

export interface AgentSessionManagerOptions {
  permissionPrompter: PermissionPrompter;
  resolveDescriptor: DescriptorResolver;
  modelPreloader: AgentModelPreloader;
  /**
   * Persistence layer for Agent Mode chats. Optional only so legacy callers
   * (tests) can omit it; production wiring always supplies one via the
   * barrel in `agentMode/index.ts`.
   */
  persistenceManager?: AgentChatPersistenceManager;
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
  private startingBackendId: BackendId | null = null;
  private lastError: string | null = null;
  private readonly preloader: AgentModelPreloader;
  // Per-session bookkeeping for auto-save: persisted file path (set after
  // first successful save), pending debounce timer, last serialized snapshot
  // signature for no-op skipping, and the unsubscribe returned by
  // `session.subscribe()` so we tear it down on close/shutdown.
  private readonly persistedPaths = new Map<string, string>();
  private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly persistenceUnsubs = new Map<string, () => void>();
  private readonly lastSavedSignatures = new Map<string, string>();
  private readonly modelCacheUnsubs = new Map<string, () => void>();

  constructor(
    private readonly app: App,
    private readonly plugin: CopilotPlugin,
    private readonly opts: AgentSessionManagerOptions
  ) {
    if (Platform.isMobile) {
      throw new Error("AgentSessionManager is desktop only");
    }
    this.preloader = opts.modelPreloader;
  }

  /**
   * List every persisted Agent Mode chat as a `ChatHistoryItem` ranked using
   * the plugin's shared in-memory `lastAccessedAt` tracker. Returns `[]` when
   * persistence isn't configured.
   */
  async getChatHistoryItems(): Promise<ChatHistoryItem[]> {
    const persistence = this.opts.persistenceManager;
    if (!persistence) return [];
    const files = await persistence.getAgentChatHistoryFiles();
    const tracker = this.plugin.getChatHistoryLastAccessedAtManager();
    return files.map((file) => fileToHistoryItem(file, tracker));
  }

  /** Update the user-visible title (frontmatter `topic`) of a saved chat. */
  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const persistence = this.opts.persistenceManager;
    if (!persistence) throw new Error("Agent chat persistence is not configured.");
    await persistence.updateTopic(fileId, newTitle);
  }

  /** Delete a saved chat by file path. */
  async deleteChatHistory(fileId: string): Promise<void> {
    const persistence = this.opts.persistenceManager;
    if (!persistence) throw new Error("Agent chat persistence is not configured.");
    await persistence.deleteFile(fileId);
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
    this.startingBackendId = resolvedId;
    this.notify();

    let backend: AcpBackendProcess;
    try {
      backend = await this.ensureBackend(resolvedId, descriptor);
    } catch (err) {
      this.lastError = err2String(err);
      this.finishPendingCreate();
      throw err;
    }

    if (this.disposed) {
      this.finishPendingCreate();
      throw new Error("AgentSessionManager was shut down during session creation");
    }

    const preferredModelId = descriptor.getPreferredModelId?.(getSettings());
    const session = AgentSession.start({
      backend,
      cwd: vaultBasePath,
      internalId: uuidv4(),
      backendId: resolvedId,
      preferredModelId,
      getDescriptor: () => this.opts.resolveDescriptor(resolvedId),
    });
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session, descriptor));
    this.activeSessionId = session.internalId;
    this.attachAutoSave(session);
    this.attachModelCacheSync(session);
    this.notify();

    // Once the ACP session is ready, apply backend-specific persisted state
    // (claude-code's effort, future config-option preferences) and clear the
    // "starting" pill. On failure, capture into `lastError` so the status
    // surface and retry handler can react. The session itself transitions to
    // status "error" inside its own `initialize`.
    void session.ready
      .then(async () => {
        if (descriptor.applyInitialSessionConfig) {
          try {
            await descriptor.applyInitialSessionConfig(session, getSettings());
          } catch (e) {
            logWarn(
              `[AgentMode] applyInitialSessionConfig failed for ${resolvedId}; continuing`,
              e
            );
          }
        }
        this.lastError = null;
        logInfo(
          `[AgentMode] session ready (internal=${session.internalId} acp=${session.getAcpSessionId()} backend=${resolvedId}); pool size=${this.sessions.size}`
        );
      })
      .catch((err) => {
        this.lastError = err2String(err);
      })
      .finally(() => this.finishPendingCreate());

    return session;
  }

  private finishPendingCreate(): void {
    this.pendingCreates--;
    if (this.pendingCreates === 0) this.startingBackendId = null;
    this.notify();
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

  /** Persist a sticky effort preference for `backendId`. No-op if the descriptor doesn't opt in. */
  async persistEffortFor(backendId: BackendId, value: string): Promise<void> {
    const descriptor = this.resolveDescriptor(backendId);
    if (!descriptor.persistEffortSelection) return;
    await descriptor.persistEffortSelection(value, this.plugin);
  }

  /** Persist a sticky mode preference for `backendId`. No-op if the descriptor doesn't opt in. */
  async persistModeFor(backendId: BackendId, value: CopilotMode): Promise<void> {
    const descriptor = this.resolveDescriptor(backendId);
    if (!descriptor.persistModeSelection) return;
    await descriptor.persistModeSelection(value, this.plugin);
  }

  /**
   * Build an `EffortApplyContext` for the active session. Returns `null`
   * when the active session isn't on `backendId` — callers must avoid
   * cross-backend effort apply. Closures over the manager + active session
   * so descriptors don't import session APIs directly.
   */
  buildEffortApplyContext(backendId: BackendId): EffortApplyContext | null {
    const session = this.getActiveSession();
    if (!session || session.backendId !== backendId) return null;
    return {
      setSessionModel: (modelId) => session.setModel(modelId),
      setSessionConfigOption: (configId, value) => session.setConfigOption(configId, value),
      persistModelSelection: (modelId) => this.persistModelSelectionFor(backendId, modelId),
      persistEffort: (value) => this.persistEffortFor(backendId, value),
    };
  }

  /**
   * Build a `ModeApplyContext` for the active session. Returns `null` when
   * the active session isn't on `backendId`.
   */
  buildModeApplyContext(backendId: BackendId): ModeApplyContext | null {
    const session = this.getActiveSession();
    if (!session || session.backendId !== backendId) return null;
    return {
      setSessionMode: (modeId) => session.setMode(modeId),
      setSessionConfigOption: (configId, value) => session.setConfigOption(configId, value),
      persistMode: (value) => this.persistModeFor(backendId, value),
    };
  }

  getBackendProcess(backendId: BackendId): AcpBackendProcess | null {
    return this.backends.get(backendId) ?? null;
  }

  /** Cached `availableModels` for `backendId`, populated by the model preloader. */
  getCachedModels(backendId: BackendId): SessionModelState | null {
    return this.preloader.getCachedModels(backendId);
  }

  /** Cached `SessionModeState` for `backendId`, populated by the model preloader. */
  getCachedModes(backendId: BackendId): SessionModeState | null {
    return this.preloader.getCachedModes(backendId);
  }

  /** Cached `SessionConfigOption[]` for `backendId`, populated by the model preloader. */
  getCachedConfigOptions(backendId: BackendId): SessionConfigOption[] | null {
    return this.preloader.getCachedConfigOptions(backendId);
  }

  /** Subscribe to preloader cache updates. Used by the picker hook. */
  subscribeModelCache(listener: () => void): () => void {
    return this.preloader.subscribe(listener);
  }

  /** Kick off a (best-effort) model probe for `backendId`. */
  preloadModels(backendId: BackendId): Promise<void> {
    return this.preloader.preload(backendId);
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
    // Drain any pending debounced auto-save before tearing the session
    // down — otherwise the last few tokens of a fast turn never reach disk.
    await this.drainAutoSave(session);
    try {
      await session.dispose();
    } catch (e) {
      logWarn(`[AgentMode] dispose during closeSession failed`, e);
    }
    this.detachAutoSave(id);
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
    return this.startingBackendId !== null;
  }

  /** Backend id currently being booted, or null when no create is in flight. */
  getStartingBackendId(): BackendId | null {
    return this.startingBackendId;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getSession(id: string): AgentSession | null {
    return this.sessions.get(id) ?? null;
  }

  /**
   * Find a session by its ACP `sessionId` (the agent-side identifier embedded
   * in `requestPermission` / `session/update` notifications). Distinct from
   * the internal id keying our own pool. Returns null while the session is
   * still starting (no ACP id yet) or when no session matches.
   */
  getSessionByAcpId(acpSessionId: string): AgentSession | null {
    for (const session of this.sessions.values()) {
      if (session.getAcpSessionId() === acpSessionId) return session;
    }
    return null;
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

    const allSessions = Array.from(this.sessions.values());
    // Drain pending auto-saves for every session before disposing — same
    // reasoning as `closeSession`. Done before the per-session unsubscribe so
    // the timers don't fire with a half-disposed session.
    for (const session of allSessions) {
      await this.drainAutoSave(session);
    }
    for (const id of Array.from(this.persistenceUnsubs.keys())) {
      this.detachAutoSave(id);
    }

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
    }
    this.sessions.clear();
    this.chatUIStates.clear();
    this.activeSessionId = null;

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
    this.startingBackendId = null;
    this.listeners.clear();
    this.preloader.shutdown();
  }

  /**
   * Open a previously-saved Agent Mode chat. If a live session is already
   * bound to that file (because the user opened it earlier this run), focus
   * its tab instead of spawning a duplicate. Otherwise, spin up a fresh
   * session on the saved backend, seed its store with the persisted display
   * messages, and pin the persisted-path map so subsequent turns update the
   * same file.
   */
  async loadSessionFromHistory(file: TFile): Promise<AgentSession> {
    if (!this.opts.persistenceManager) {
      throw new Error("Agent chat persistence is not configured.");
    }
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }

    for (const [internalId, path] of this.persistedPaths.entries()) {
      if (path !== file.path) continue;
      const existing = this.sessions.get(internalId);
      if (existing && existing.getStatus() !== "closed") {
        this.setActiveSession(internalId);
        return existing;
      }
      this.persistedPaths.delete(internalId);
    }

    const loaded = await this.opts.persistenceManager.loadFile(file);
    const session = await this.createSession(loaded.backendId);
    session.store.loadMessages(loaded.messages);
    if (loaded.label) session.setLabel(loaded.label);
    this.persistedPaths.set(session.internalId, file.path);
    this.notify();
    return session;
  }

  private attachAutoSave(session: AgentSession): void {
    const persistence = this.opts.persistenceManager;
    if (!persistence) return;

    const trigger = () => this.scheduleAutoSave(session);
    const unsubscribe = session.subscribe({
      onMessagesChanged: trigger,
      onStatusChanged: () => {},
      onLabelChanged: trigger,
    });
    this.persistenceUnsubs.set(session.internalId, unsubscribe);
  }

  private scheduleAutoSave(session: AgentSession): void {
    const existingTimer = this.saveTimers.get(session.internalId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.saveTimers.delete(session.internalId);
      this.flushAutoSave(session).catch((e) =>
        logWarn(`[AgentMode] auto-save failed for ${session.internalId}`, e)
      );
    }, AUTOSAVE_DEBOUNCE_MS);
    this.saveTimers.set(session.internalId, timer);
  }

  private async flushAutoSave(session: AgentSession): Promise<void> {
    const persistence = this.opts.persistenceManager;
    if (!persistence) return;
    if (!this.sessions.has(session.internalId)) return;

    const messages = session.store.getDisplayMessages();
    if (messages.length === 0) return;

    const label = session.getLabel();
    // Skip the write when nothing user-visible has changed since the last
    // save. Streaming token updates and idempotent label notifications
    // otherwise rewrite the entire file on every debounce tick.
    const signature = `${label ?? ""} ${messages.length} ${
      messages[messages.length - 1]?.message ?? ""
    }`;
    if (this.lastSavedSignatures.get(session.internalId) === signature) return;

    const result = await persistence.saveSession(messages, session.backendId, {
      label,
      existingPath: this.persistedPaths.get(session.internalId),
    });
    if (result) {
      this.persistedPaths.set(session.internalId, result.path);
      this.lastSavedSignatures.set(session.internalId, signature);
    }
  }

  /**
   * Cancel any pending debounced auto-save for `session` and run it
   * synchronously, so the on-disk file reflects the final state before the
   * session is disposed. Safe to call when no save is pending.
   */
  private async drainAutoSave(session: AgentSession): Promise<void> {
    const timer = this.saveTimers.get(session.internalId);
    if (!timer) return;
    clearTimeout(timer);
    this.saveTimers.delete(session.internalId);
    try {
      await this.flushAutoSave(session);
    } catch (e) {
      logWarn(`[AgentMode] drain auto-save failed for ${session.internalId}`, e);
    }
  }

  private detachAutoSave(internalId: string): void {
    const timer = this.saveTimers.get(internalId);
    if (timer) clearTimeout(timer);
    this.saveTimers.delete(internalId);
    const unsubscribe = this.persistenceUnsubs.get(internalId);
    if (unsubscribe) unsubscribe();
    this.persistenceUnsubs.delete(internalId);
    this.persistedPaths.delete(internalId);
    this.lastSavedSignatures.delete(internalId);
    const cacheUnsub = this.modelCacheUnsubs.get(internalId);
    if (cacheUnsub) cacheUnsub();
    this.modelCacheUnsubs.delete(internalId);
  }

  /**
   * Mirror this session's models/modes/configOptions into the preloader cache
   * so the picker reflects current state. Only writes non-null fields — during
   * a session's `"starting"` window every getter returns null, and a naive
   * sync would clobber the previous session's cached entries.
   */
  private attachModelCacheSync(session: AgentSession): void {
    const sync = (): void => {
      const models = session.getModelState();
      const modes = session.getModeState();
      const configOptions = session.getConfigOptions();
      if (!models && !modes && !configOptions) return;
      this.preloader.setCached(session.backendId, {
        ...(models && { models }),
        ...(modes && { modes }),
        ...(configOptions && { configOptions }),
      });
    };
    sync();
    const unsubscribe = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: () => {},
      onModelChanged: () => sync(),
    });
    this.modelCacheUnsubs.set(session.internalId, unsubscribe);
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
          this.detachAutoSave(s.internalId);
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
}
