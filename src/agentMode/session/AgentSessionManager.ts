import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { getSettings, setSettings } from "@/settings/model";
import { err2String } from "@/utils";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { fileToHistoryItem } from "@/utils/chatHistoryUtils";
import { App, FileSystemAdapter, Notice, Platform, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { AgentSession, ATTENTION_TRIGGER_STATUSES } from "./AgentSession";
import type { AgentChatPersistenceManager } from "./AgentChatPersistenceManager";
import type { AgentModelPreloader, WarmBackend } from "./AgentModelPreloader";
import { MethodUnsupportedError } from "./errors";
import { resolveMcpServers } from "./mcpResolver";
import { replayPersistedMode } from "./replayPersistedMode";
import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  CopilotMode,
  EffortOption,
  ModeApplySpec,
  ModelSelection,
  PermissionDecision,
  PermissionPrompt,
  SessionId,
} from "./types";

const AUTOSAVE_DEBOUNCE_MS = 500;

export type PermissionPrompter = (req: PermissionPrompt) => Promise<PermissionDecision>;

/**
 * Session-domain handler for inline multiple-choice questions, the sibling of
 * `PermissionPrompter`. Routes a backend's `AskUserQuestion` request to its
 * owning session, which surfaces an inline card and resolves with the answers
 * (or `{}` when the user cancels / no session owns the request).
 */
export type AskUserQuestionPrompter = (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;

// Injected by the barrel so `session/` doesn't have to import
// `backends/registry` directly (would breach the layer boundary).
export type DescriptorResolver = (id: BackendId) => BackendDescriptor | undefined;

export interface AgentSessionManagerOptions {
  permissionPrompter: PermissionPrompter;
  /**
   * Handler the Claude SDK backend calls for its inline `AskUserQuestion`
   * surface. Optional only so legacy callers (tests) can omit it; production
   * wiring always supplies one via the barrel in `agentMode/index.ts`. Wired
   * onto each backend that advertises `setAskUserQuestionPrompter`.
   */
  askUserQuestionPrompter?: AskUserQuestionPrompter;
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
  private backends = new Map<BackendId, BackendProcess>();
  private starting = new Map<BackendId, Promise<BackendProcess>>();
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
  private readonly pendingBackendRestarts = new Map<BackendId, string>();
  private readonly restartingBackends = new Set<BackendId>();
  private readonly preloader: AgentModelPreloader;
  /**
   * Per-backend preload status. The chat UI gates its first render on the
   * *active* backend's status; the model picker shows a "Loading…" or
   * "Failed to load" placeholder for any backend that hasn't reached
   * `"ready"` yet. A missing entry is treated as `"absent"` (backend not
   * installed / never queued) which is render-safe.
   */
  private readonly preloadStatus = new Map<BackendId, "pending" | "ready" | "error">();
  // Per-session bookkeeping, all keyed by `internalId`. Mixes persistence
  // bookkeeping with subscription teardowns — the unifying property is
  // "must be cleaned up when the session is detached":
  // - `path`: persisted file (set after first successful save)
  // - `timer`: pending debounce timer
  // - `unsub`: tear-down for the auto-save `session.subscribe()`
  // - `signature`: last serialized snapshot, for no-op skipping
  // - `modelCacheUnsub`: tear-down for the model-cache mirror subscription
  // - `attentionUnsub`: tear-down for the needs-attention status watcher
  private readonly sessionState = new Map<
    string,
    {
      path?: string;
      timer?: number;
      unsub?: () => void;
      signature?: string;
      modelCacheUnsub?: () => void;
      attentionUnsub?: () => void;
    }
  >();

  private getSessionState(internalId: string) {
    let entry = this.sessionState.get(internalId);
    if (!entry) {
      entry = {};
      this.sessionState.set(internalId, entry);
    }
    return entry;
  }

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
    return files.map((file) => fileToHistoryItem(this.app, file, tracker));
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
   *
   * The new session's initial (model, effort) is read from the persisted
   * default for `backendId` via `getDefaultSelection`. Picker call sites that
   * want a specific selection on a new backend should call
   * `persistDefaultSelection` first.
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

    let backend: BackendProcess;
    let warm: WarmBackend | null = null;
    try {
      // ensureBackend tries the preloader's warm probe before paying a
      // fresh spawn. When `warm` is non-null the probe session is
      // available for adoption below — skips a second `newSession`.
      ({ proc: backend, warm } = await this.ensureBackend(resolvedId, descriptor));
    } catch (err) {
      this.lastError = err2String(err);
      this.finishPendingCreate();
      throw err;
    }

    if (this.disposed) {
      this.finishPendingCreate();
      throw new Error("AgentSessionManager was shut down during session creation");
    }

    const seedSelection = this.getDefaultSelection(resolvedId) ?? undefined;

    // A new chat must always start from a brand-new backend session. When a
    // warm preload probe is available we reuse its already-spawned and
    // initialize-handshaken subprocess (the expensive part), but never its
    // *session*: opencode persists its probe session id and resumes it from
    // disk on the next preload, so adopting that session as the chat would
    // replay the previous conversation's transcript and auto-title into a
    // supposedly fresh chat. `AgentSession.start` runs `newSession` on the
    // (warm or cold) proc; the probe's state still seeds the picker so it
    // doesn't blink while that round-trip is in flight.
    const session = AgentSession.start({
      backend,
      cwd: vaultBasePath,
      internalId: uuidv4(),
      backendId: resolvedId,
      defaultModelSelection: seedSelection,
      initialCachedState: warm?.state ?? this.preloader.getCachedBackendState(resolvedId),
      getDescriptor: () => this.opts.resolveDescriptor(resolvedId),
    });
    if (warm) {
      logInfo(
        `[AgentMode] session reused warm proc with a fresh session (internal=${session.internalId} backend=${resolvedId})`
      );
    }
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
    this.activeSessionId = session.internalId;
    this.attachAutoSave(session);
    this.attachModelCacheSync(session);
    this.attachAttentionTracking(session);
    this.notify();

    // Once the ACP session is ready, apply backend-specific persisted state
    // (claude's effort, future config-option preferences) and clear the
    // "starting" pill. On failure, capture into `lastError` so the status
    // surface and retry handler can react. The session itself transitions to
    // status "error" inside its own `initialize`. For warm-adopted sessions
    // `ready` is already resolved, so the chain runs on the next microtask.
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
          `[AgentMode] session ready (internal=${session.internalId} backend-id=${session.getBackendSessionId()} backend=${resolvedId}); pool size=${this.sessions.size}`
        );
        // Seed the user's sticky mode preference so a new conversation reopens
        // in the mode they last chose (e.g. `auto`). Generic across backends;
        // `replayPersistedMode` swallows its own errors so it never blocks ready.
        // Runs last so it can't perturb the lastError/ready ordering above.
        await replayPersistedMode(session, this.getDefaultMode(resolvedId));
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

  /** Read the user's sticky model preference for `backendId`, or `null` if none. */
  getDefaultSelection(backendId: BackendId): ModelSelection | null {
    const backends = getSettings().agentMode?.backends as
      | Record<string, { defaultModel?: ModelSelection | null } | undefined>
      | undefined;
    return backends?.[backendId]?.defaultModel ?? null;
  }

  /** Persist a sticky model preference for `backendId`. Pass `null` to clear. */
  async persistDefaultSelection(
    backendId: BackendId,
    selection: ModelSelection | null
  ): Promise<void> {
    setSettings((cur) => {
      const existing = (cur.agentMode.backends as Record<string, unknown> | undefined)?.[
        backendId
      ] as Record<string, unknown> | undefined;
      return {
        agentMode: {
          ...cur.agentMode,
          backends: {
            ...cur.agentMode.backends,
            [backendId]: { ...(existing ?? {}), defaultModel: selection },
          },
        },
      };
    });
  }

  /**
   * Apply a (baseModelId, effort) selection to the active session. Both
   * fields are optional patches against the current selection:
   *   - `baseModelId` omitted → keep current
   *   - `effort` omitted → keep current
   *   - `effort: null` → explicit "default" (no-op for descriptor-style
   *     backends, encoded as the bare model id for suffix-style backends)
   *
   * `opts.expectBackendId`, when provided, makes this a silent no-op if
   * the active session is on a different backend. Used by the effort
   * sibling, which captures the backend id at picker-build time and
   * might fire after a session swap.
   *
   * After a successful descriptor apply, the resolved selection is also
   * written to the persisted default for the active backend — symmetric
   * with `applyMode`. If the descriptor throws, no persistence occurs.
   */
  async applySelection(
    patch: { baseModelId?: string; effort?: string | null },
    opts?: { expectBackendId?: BackendId }
  ): Promise<void> {
    const session = this.getActiveSession();
    if (!session) return;
    if (opts?.expectBackendId && session.backendId !== opts.expectBackendId) return;
    const current = session.getState()?.model?.current;
    if (!current) return;
    const descriptor = this.resolveDescriptor(session.backendId);
    const resolved: ModelSelection = {
      baseModelId: patch.baseModelId ?? current.baseModelId,
      effort: patch.effort !== undefined ? patch.effort : current.effort,
    };
    await descriptor.applySelection(session, resolved);
    await this.persistDefaultSelection(session.backendId, resolved);
  }

  /**
   * Apply a canonical mode change against the active session. `spec` carries
   * the native dispatch info (which ACP RPC + payload); `mode` is the canonical
   * id to persist. After a successful apply, `mode` becomes the backend's sticky
   * default so the next new conversation reopens in it — symmetric with
   * `applySelection`. If the apply throws, no persistence occurs.
   */
  async applyMode(backendId: BackendId, mode: CopilotMode, spec: ModeApplySpec): Promise<void> {
    const session = this.getActiveSession();
    if (!session || session.backendId !== backendId) return;
    if (spec.kind === "setMode") {
      await session.setMode(spec.nativeId);
    } else {
      await session.setConfigOption(spec.configId, spec.value);
    }
    await this.persistDefaultMode(backendId, mode);
  }

  /** Read the user's sticky mode preference for `backendId`, or `null` if none. */
  getDefaultMode(backendId: BackendId): CopilotMode | null {
    const backends = getSettings().agentMode?.backends as
      | Record<string, { defaultMode?: CopilotMode | null } | undefined>
      | undefined;
    return backends?.[backendId]?.defaultMode ?? null;
  }

  /** Persist a sticky mode preference for `backendId`. Pass `null` to clear. */
  async persistDefaultMode(backendId: BackendId, mode: CopilotMode | null): Promise<void> {
    setSettings((cur) => {
      const existing = (cur.agentMode.backends as Record<string, unknown> | undefined)?.[
        backendId
      ] as Record<string, unknown> | undefined;
      return {
        agentMode: {
          ...cur.agentMode,
          backends: {
            ...cur.agentMode.backends,
            [backendId]: { ...(existing ?? {}), defaultMode: mode },
          },
        },
      };
    });
  }

  getBackendProcess(backendId: BackendId): BackendProcess | null {
    return this.backends.get(backendId) ?? null;
  }

  /**
   * Restart a backend process so spawn-time configuration, including native
   * skill discovery and deny rules, is rebuilt from current settings. If a
   * session on that backend is busy, the restart is deferred until it is idle.
   *
   * When the manager owns no process yet, a warm probe held by the preloader
   * may still carry the pre-change spawn config; we refresh it instead (see
   * `refreshWarmProbe`) so the first chat-open doesn't adopt a stale proc.
   *
   * Returns `true` when a running backend was restarted, a restart was
   * scheduled, or a warm probe was refreshed; `false` when nothing exists yet.
   */
  async restartBackend(backendId: BackendId, reason: string): Promise<boolean> {
    if (this.disposed) return false;
    const inflight = this.starting.get(backendId);
    if (inflight) {
      await inflight.catch(() => undefined);
    }
    const backend = this.backends.get(backendId);
    if (!backend) return this.refreshWarmProbe(backendId, reason);
    if (this.hasBusySession(backendId)) {
      const prev = this.pendingBackendRestarts.get(backendId);
      this.pendingBackendRestarts.set(backendId, prev ? `${prev}; ${reason}` : reason);
      logInfo(`[AgentMode] deferred ${backendId} backend restart: ${reason}`);
      return true;
    }
    await this.restartBackendNow(backendId, reason);
    return true;
  }

  /**
   * React to a backend's install state changing at runtime — a binary path
   * applied/cleared, or a binary installed/updated from the Configure dialog.
   * Without this, the change only re-renders the settings status line: the
   * running or warm process keeps the old binary, and a backend installed
   * after plugin load is never spawned, so the user has to reload the plugin.
   *
   * Three transitions, all reusing the existing restart/refresh coalescing so
   * a burst of edits folds into one re-probe:
   *   - now uninstalled → tear down any live proc and drop the warm probe so
   *     the picker stops offering a backend that can no longer spawn;
   *   - installed with a live/warm process → restart/refresh it against the
   *     new binary;
   *   - installed but never probed (freshly installed) → kick a first preload
   *     (`restartBackend` returns `false` here, since nothing is warm yet).
   *
   * The fresh-preload case is unique to this signal: the load-time preload
   * loop skips backends that aren't installed yet, so install-state is the
   * only event that can flip a backend from "never preloaded" into "should
   * preload". The provider/system-prompt restart subscriptions always act on
   * an already-installed (already-preloaded) backend, so they only ever need
   * `restartBackend`'s restart/refresh — never a first preload.
   */
  async onInstallStateChanged(backendId: BackendId): Promise<void> {
    if (this.disposed) return;
    if (!this.isBackendInstalled(backendId)) {
      // Tears down a live proc (the install guard in `restartBackendNow` keeps
      // it from respawning); `clearCached` then drops any warm probe.
      await this.restartBackend(backendId, "binary no longer available");
      this.preloader.clearCached(backendId);
      return;
    }
    const refreshed = await this.restartBackend(backendId, "binary path changed");
    if (!refreshed) {
      this.registerPreload(backendId, this.preloader.preload(backendId));
    }
  }

  /**
   * Refresh a preloader warm probe when the manager owns no process yet.
   * Spawn-time config (provider keys, enabled models, native skills, system
   * prompt) is baked into the warm probe when it spawns, so a config change
   * made before the first chat-open would otherwise never reach it — the
   * first `createSession` adopts the stale warm proc and the picker flags
   * freshly-enabled models as "not offered by agent" until a full reload.
   *
   * Delegates the re-probe to `preloader.refresh`, which coalesces the burst of
   * writes a single BYOK save produces (provider row → key → enabled models)
   * into one re-probe against the settled settings. No-op (returns `false`)
   * when nothing is warm/in-flight for this backend, or it isn't installed.
   */
  private refreshWarmProbe(backendId: BackendId, reason: string): boolean {
    if (this.disposed) return false;
    if (!this.isBackendInstalled(backendId)) return false;
    const probe = this.preloader.refresh(backendId);
    if (!probe) return false;
    logInfo(`[AgentMode] refreshing warm ${backendId} probe: ${reason}`);
    this.registerPreload(backendId, probe);
    return true;
  }

  /** Whether `backendId`'s descriptor reports its binary/runtime as installed. */
  private isBackendInstalled(backendId: BackendId): boolean {
    const descriptor = this.opts.resolveDescriptor(backendId);
    return descriptor?.getInstallState(getSettings())?.kind === "ready";
  }

  /** Cached unified backend state for `backendId`, populated by the model preloader. */
  getCachedBackendState(backendId: BackendId): BackendState | null {
    return this.preloader.getCachedBackendState(backendId);
  }

  /**
   * Per-model effort options (baseModelId → options) discovered by the
   * preloader's post-catalog prefetch, or `null`. The picker reads this to show
   * effort steppers for models that aren't currently active.
   */
  getEffortCatalog(backendId: BackendId): Record<string, EffortOption[]> | null {
    return this.preloader.getEffortCatalog(backendId);
  }

  /**
   * The agent's catalog-declared default base model id for `backendId`.
   * Trusts `availableModels` ordering (agents put their recommended model
   * first). Returns `null` when the catalog hasn't been probed yet.
   */
  getDefaultBaseModelId(backendId: BackendId): string | null {
    const state = this.preloader.getCachedBackendState(backendId);
    return state?.model?.availableModels[0]?.baseModelId ?? null;
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
   * Register a backend's plugin-load preload promise. While the promise is
   * pending, `getPreloadStatus(backendId)` returns `"pending"`; on settle it
   * transitions to `"ready"` (the preload itself is best-effort, so even
   * rejected promises flip to `"ready"` here — the picker reads the cached
   * state alongside this status and renders empty-but-error vs loading).
   * On programmatic error (rejected promise) the entry becomes `"error"` so
   * the picker can offer a retry affordance.
   */
  registerPreload(backendId: BackendId, promise: Promise<void>): void {
    this.preloadStatus.set(backendId, "pending");
    this.notify();
    promise.then(
      () => {
        if (this.disposed) return;
        this.preloadStatus.set(backendId, "ready");
        this.notify();
      },
      () => {
        if (this.disposed) return;
        this.preloadStatus.set(backendId, "error");
        this.notify();
      }
    );
  }

  /**
   * Synchronous check, suitable for React render gates. Defaults to the
   * active backend; pass `backendId` to query a specific backend (the
   * picker reads each backend's status). Backends that were never queued
   * (not installed / disabled) are treated as ready so the chat UI doesn't
   * stall waiting on a preload that will never run.
   */
  isPreloadReady(backendId?: BackendId): boolean {
    const id = backendId ?? getSettings().agentMode?.activeBackend;
    if (!id) return true;
    const status = this.preloadStatus.get(id);
    return status === undefined || status === "ready" || status === "error";
  }

  /**
   * Read a backend's preload status for the picker. `"absent"` indicates
   * the backend was never queued (uninstalled or disabled) — the picker
   * uses today's behavior in that case (omit the section silently).
   */
  getPreloadStatus(backendId: BackendId): "pending" | "ready" | "error" | "absent" {
    return this.preloadStatus.get(backendId) ?? "absent";
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
    const session = this.sessions.get(id);
    if (!session) return;
    if (this.activeSessionId === id) return;
    this.activeSessionId = id;
    session.clearNeedsAttention();
    this.notify();
  }

  /**
   * Spawn a fresh session at `oldId`'s tab-strip position and close `oldId`
   * in the background. Used by the in-tab "New Chat" button so the
   * replacement chat takes the same slot the user was looking at instead of
   * appearing at the end of the strip (which made it look like focus had
   * jumped to a sibling tab). `backendId` defaults to the same fallback as
   * `createSession`.
   */
  async replaceSessionInPlace(oldId: string, backendId?: BackendId): Promise<AgentSession> {
    const oldIdx = Array.from(this.sessions.keys()).indexOf(oldId);
    const created = await this.createSession(backendId);
    if (oldIdx >= 0) {
      this.moveMapEntry(this.sessions, created.internalId, oldIdx);
      this.moveMapEntry(this.chatUIStates, created.internalId, oldIdx);
      this.notify();
    }
    void this.closeSession(oldId).catch((e) =>
      logWarn(`[AgentMode] closeSession during replaceSessionInPlace failed`, e)
    );
    return created;
  }

  // Maps preserve insertion order, so reordering means rebuilding the map.
  // Used to land a freshly-created session at a specific tab-strip index.
  private moveMapEntry<V>(map: Map<string, V>, key: string, targetIdx: number): void {
    if (!map.has(key)) return;
    const entries = Array.from(map.entries());
    const fromIdx = entries.findIndex(([k]) => k === key);
    if (fromIdx === -1 || fromIdx === targetIdx) return;
    const [entry] = entries.splice(fromIdx, 1);
    entries.splice(targetIdx, 0, entry);
    map.clear();
    for (const [k, v] of entries) map.set(k, v);
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
   * Find a session by its backend `sessionId` (the agent-side identifier
   * embedded in `requestPermission` / `session/update` notifications).
   * Distinct from the internal id keying our own pool. Returns null while
   * the session is still starting (no backend id yet) or when no session
   * matches.
   */
  getSessionByBackendId(backendSessionId: string): AgentSession | null {
    for (const session of this.sessions.values()) {
      if (session.getBackendSessionId() === backendSessionId) return session;
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
    await Promise.allSettled(allSessions.map((s) => this.drainAutoSave(s)));
    for (const id of Array.from(this.sessionState.keys())) {
      this.detachAutoSave(id);
    }

    await Promise.allSettled(
      allSessions.map(async (session) => {
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
      })
    );
    this.sessions.clear();
    this.chatUIStates.clear();
    this.activeSessionId = null;

    const allBackends = Array.from(this.backends.values());
    await Promise.allSettled(
      allBackends.map(async (proc) => {
        try {
          await proc.shutdown();
        } catch (e) {
          logError("[AgentMode] backend shutdown failed", e);
        }
      })
    );
    this.backends.clear();
    this.starting.clear();
    this.startingBackendId = null;
    this.listeners.clear();
    this.preloadStatus.clear();
    this.preloader.shutdown();
  }

  /**
   * Open a previously-saved Agent Mode chat. If a live session is already
   * bound to that file (because the user opened it earlier this run), focus
   * its tab instead of spawning a duplicate. Otherwise, if the saved file
   * carries a backend `sessionId` and the backend supports resume, rehydrate
   * the prior backend session so the agent retains conversation context on
   * the next turn. Falls back to a fresh session (UI-only history) when no
   * sessionId was saved or the backend can't resume.
   */
  async loadSessionFromHistory(file: TFile): Promise<AgentSession> {
    if (!this.opts.persistenceManager) {
      throw new Error("Agent chat persistence is not configured.");
    }
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }

    for (const [internalId, state] of this.sessionState.entries()) {
      if (state.path !== file.path) continue;
      const existing = this.sessions.get(internalId);
      if (existing && existing.getStatus() !== "closed") {
        this.setActiveSession(internalId);
        return existing;
      }
      state.path = undefined;
    }

    const loaded = await this.opts.persistenceManager.loadFile(file);

    let session: AgentSession | null = null;
    if (loaded.sessionId) {
      session = await this.tryResumeSessionFromHistory(loaded.backendId, loaded.sessionId);
    }
    if (!session) {
      session = await this.createSession(loaded.backendId);
    }

    session.store.loadMessages(loaded.messages);
    if (loaded.label) session.setLabel(loaded.label);
    this.getSessionState(session.internalId).path = file.path;
    this.notify();
    return session;
  }

  /**
   * Spin up an `AgentSession` bound to an existing backend session id. Prefers
   * `loadSession` (ACP replays the transcript through the backend) over
   * `resumeSession` (Claude SDK reads its own on-disk transcript). Returns
   * `null` when the backend supports neither — the caller falls back to a
   * fresh session.
   */
  private async tryResumeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<AgentSession | null> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return null;
    const vaultBasePath = adapter.getBasePath();
    const descriptor = this.resolveDescriptor(backendId);

    this.pendingCreates++;
    this.startingBackendId = backendId;
    this.notify();

    let backend: BackendProcess;
    try {
      // Discard the optional warm probe-session info: we're rehydrating a
      // specific saved session, not opening a fresh chat. The probe
      // session sits unused on the proc until shutdown — harmless.
      ({ proc: backend } = await this.ensureBackend(backendId, descriptor));
    } catch (err) {
      this.lastError = err2String(err);
      this.finishPendingCreate();
      return null;
    }

    if (this.disposed) {
      this.finishPendingCreate();
      return null;
    }

    const mcpServers = resolveMcpServers(backend, getSettings().agentMode?.mcpServers);

    let resumeResult: { sessionId: SessionId; state: BackendState } | null = null;
    try {
      resumeResult = await backend.loadSession({ sessionId, cwd: vaultBasePath, mcpServers });
    } catch (err) {
      if (!(err instanceof MethodUnsupportedError)) {
        logWarn(`[AgentMode] loadSession failed for ${sessionId}`, err);
        this.finishPendingCreate();
        return null;
      }
    }

    if (!resumeResult) {
      try {
        resumeResult = await backend.resumeSession({
          sessionId,
          cwd: vaultBasePath,
          mcpServers,
        });
      } catch (err) {
        if (err instanceof MethodUnsupportedError) {
          logInfo(
            `[AgentMode] backend ${backendId} does not support session resume; falling back to fresh session`
          );
        } else {
          logWarn(`[AgentMode] resumeSession failed for ${sessionId}`, err);
        }
        this.finishPendingCreate();
        return null;
      }
    }

    if (this.disposed) {
      this.finishPendingCreate();
      return null;
    }

    const session = new AgentSession({
      backend,
      backendSessionId: resumeResult.sessionId,
      internalId: uuidv4(),
      backendId,
      initialState: resumeResult.state,
      cwd: vaultBasePath,
      getDescriptor: () => this.opts.resolveDescriptor(backendId),
    });
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
    this.activeSessionId = session.internalId;
    this.attachAutoSave(session);
    this.attachModelCacheSync(session);
    this.attachAttentionTracking(session);
    this.lastError = null;
    this.finishPendingCreate();
    logInfo(
      `[AgentMode] resumed session (internal=${session.internalId} backend-id=${sessionId} backend=${backendId})`
    );
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
    this.getSessionState(session.internalId).unsub = unsubscribe;
  }

  private scheduleAutoSave(session: AgentSession): void {
    if (!getSettings().autosaveChat) return;
    const state = this.getSessionState(session.internalId);
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      state.timer = undefined;
      this.flushAutoSave(session).catch((e) =>
        logWarn(`[AgentMode] auto-save failed for ${session.internalId}`, e)
      );
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * Manual save entry point. Writes the active session via the same code path
   * auto-save uses, but ignores `settings.autosaveChat`. Returns the on-disk
   * path on success, or `null` when there was nothing to save (no active
   * session, no messages, persistence not configured, or signature unchanged).
   */
  async saveActiveSession(): Promise<{ path: string } | null> {
    const session = this.getActiveSession();
    if (!session) return null;
    // Drain any pending debounced write first so it doesn't race with us.
    const state = this.sessionState.get(session.internalId);
    if (state?.timer) {
      window.clearTimeout(state.timer);
      state.timer = undefined;
    }
    return this.flushAutoSave(session);
  }

  private async flushAutoSave(session: AgentSession): Promise<{ path: string } | null> {
    const persistence = this.opts.persistenceManager;
    if (!persistence) return null;
    if (!this.sessions.has(session.internalId)) return null;

    const messages = session.store.getDisplayMessages();
    if (messages.length === 0) return null;

    const label = session.getLabel();
    const sessionId = session.getBackendSessionId();
    // Skip the write when nothing user-visible has changed since the last
    // save. Streaming token updates and idempotent label notifications
    // otherwise rewrite the entire file on every debounce tick. Include
    // the backend session id in the signature so the first save after the
    // session finishes starting (when sessionId flips from null → real)
    // always writes through, even if the message list hasn't changed yet.
    const signature = `${label ?? ""}-${sessionId ?? ""}-${messages.length}-${
      messages[messages.length - 1]?.message ?? ""
    }`;
    const state = this.getSessionState(session.internalId);
    if (state.signature === signature) {
      return state.path ? { path: state.path } : null;
    }

    const result = await persistence.saveSession(messages, session.backendId, {
      label,
      existingPath: state.path,
      sessionId,
    });
    if (result) {
      state.path = result.path;
      state.signature = signature;
    }
    return result;
  }

  /**
   * Cancel any pending debounced auto-save for `session` and run it
   * synchronously, so the on-disk file reflects the final state before the
   * session is disposed. Safe to call when no save is pending.
   */
  private async drainAutoSave(session: AgentSession): Promise<void> {
    const state = this.sessionState.get(session.internalId);
    if (!state?.timer) return;
    window.clearTimeout(state.timer);
    state.timer = undefined;
    try {
      await this.flushAutoSave(session);
    } catch (e) {
      logWarn(`[AgentMode] drain auto-save failed for ${session.internalId}`, e);
    }
  }

  private detachAutoSave(internalId: string): void {
    const state = this.sessionState.get(internalId);
    if (!state) return;
    if (state.timer) window.clearTimeout(state.timer);
    state.unsub?.();
    state.modelCacheUnsub?.();
    state.attentionUnsub?.();
    this.sessionState.delete(internalId);
  }

  /**
   * Mirror this session's unified `BackendState` into the preloader cache
   * so the picker reflects current state. Skips when the session has no
   * usable state yet (during the `"starting"` window) — a naive sync
   * would clobber the previous session's cached entries with an empty
   * snapshot.
   */
  private attachModelCacheSync(session: AgentSession): void {
    const sync = (): void => {
      const state = session.getState();
      if (!state) return;
      if (!state.model && !state.mode) return;
      this.preloader.setCached(session.backendId, state);
    };
    sync();
    const unsubscribe = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: () => {},
      onModelChanged: () => sync(),
    });
    this.getSessionState(session.internalId).modelCacheUnsub = unsubscribe;
  }

  /**
   * Watch this session's status transitions and flag `needsAttention` when
   * it transitions out of `running` into a state that demands the user's
   * eye (turn ended, errored, or paused for permission) while a *different*
   * tab is active. The flag is cleared in `setActiveSession` when the user
   * clicks back to this tab.
   */
  private attachAttentionTracking(session: AgentSession): void {
    let prev = session.getStatus();
    const unsubscribe = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (next) => {
        const wasRunning = prev === "running";
        prev = next;
        void this.flushDeferredBackendRestartIfReady(session.backendId);
        if (!wasRunning) return;
        if (!ATTENTION_TRIGGER_STATUSES.has(next)) return;
        if (this.activeSessionId === session.internalId) return;
        session.markNeedsAttention();
      },
    });
    this.getSessionState(session.internalId).attentionUnsub = unsubscribe;
  }

  /**
   * Obtain a running backend process for `backendId`. Tries three sources
   * in order:
   *  1. An already-running proc owned by the manager (second-and-later
   *     sessions on the same backend).
   *  2. An in-flight spawn — concurrent callers join the first one.
   *  3. The preloader's warm probe (skips spawn + `initialize` handshake).
   *  4. A fresh `descriptor.createBackendProcess()` + `start()`.
   *
   * The returned `warm` slot is non-null only on path 3 and carries the
   * probe session id + state snapshot so callers that open a fresh chat
   * can adopt the probe session as the user's session (avoids a second
   * `newSession` round-trip). Callers that need a specific saved session
   * (e.g. `tryResumeSessionFromHistory`) can ignore `warm` — the probe
   * session simply sits unused on the proc.
   */
  /**
   * Register the session-domain prompters on a freshly-adopted backend. The
   * permission prompter is required; the ask-question prompter is wired only
   * when both the manager was configured with one and the backend advertises
   * the optional `setAskUserQuestionPrompter` surface (Claude SDK today).
   */
  private wirePrompters(proc: BackendProcess): void {
    proc.setPermissionPrompter(this.opts.permissionPrompter);
    if (this.opts.askUserQuestionPrompter) {
      proc.setAskUserQuestionPrompter?.(this.opts.askUserQuestionPrompter);
    }
  }

  private async ensureBackend(
    backendId: BackendId,
    descriptor: BackendDescriptor
  ): Promise<{ proc: BackendProcess; warm: WarmBackend | null }> {
    const existing = this.backends.get(backendId);
    if (existing && existing.isRunning()) return { proc: existing, warm: null };
    const inflight = this.starting.get(backendId);
    if (inflight) return { proc: await inflight, warm: null };

    const warm = this.preloader.takeWarm(backendId);
    if (warm) {
      // Probe subprocess is already started + initialize-handshaken —
      // wire it into the manager without paying either cost again.
      this.wirePrompters(warm.proc);
      this.installBackendExitHandler(backendId, warm.proc, descriptor);
      this.backends.set(backendId, warm.proc);
      return { proc: warm.proc, warm };
    }

    const proc = descriptor.createBackendProcess({
      plugin: this.plugin,
      app: this.app,
      clientVersion: this.plugin.manifest.version,
      descriptor,
    });
    const startPromise = (async () => {
      // ACP backends declare `start()` to spawn the subprocess and run the
      // initialize handshake. In-process adapters (Claude SDK) omit it.
      if (proc.start) await proc.start();
      this.wirePrompters(proc);
      this.installBackendExitHandler(backendId, proc, descriptor);
      this.backends.set(backendId, proc);
      return proc;
    })();
    this.starting.set(backendId, startPromise);
    try {
      return { proc: await startPromise, warm: null };
    } finally {
      this.starting.delete(backendId);
    }
  }

  /**
   * Wire the "backend died unexpectedly" cleanup for `proc`: drop every
   * session bound to `backendId`, surface a `lastError`, and notify. Same
   * shape for both warm-adopted and freshly-spawned procs.
   */
  private installBackendExitHandler(
    backendId: BackendId,
    proc: BackendProcess,
    descriptor: BackendDescriptor
  ): void {
    proc.onExit(() => {
      // Backend died unexpectedly. Sessions belonging to *this* backend
      // are now unusable (their backend session ids are dead) — but other
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
  }

  /** Whether any session for `backendId` is not safe to dispose yet. */
  private hasBusySession(backendId: BackendId): boolean {
    return Array.from(this.sessions.values()).some((session) => {
      if (session.backendId !== backendId) return false;
      const status = session.getStatus();
      return status === "starting" || status === "running" || status === "awaiting_permission";
    });
  }

  /** Execute a pending backend restart once every session for that backend is idle. */
  private async flushDeferredBackendRestartIfReady(backendId: BackendId): Promise<void> {
    const reason = this.pendingBackendRestarts.get(backendId);
    if (!reason) return;
    if (this.hasBusySession(backendId)) return;
    this.pendingBackendRestarts.delete(backendId);
    try {
      await this.restartBackendNow(backendId, reason);
    } catch (err) {
      this.lastError = err2String(err);
      logError(`[AgentMode] deferred ${backendId} backend restart failed`, err);
      this.notify();
    }
  }

  /** Immediately tear down `backendId` and replace the active affected tab. */
  private async restartBackendNow(backendId: BackendId, reason: string): Promise<void> {
    // A restart is already running for this backend. Stash the reason so the
    // tail of the in-flight restart can re-run with the latest settings —
    // otherwise rapid-fire emits (e.g. one BYOK save touching many models)
    // would be silently dropped and the running backend would keep stale
    // config until something else triggered another restart.
    if (this.restartingBackends.has(backendId)) {
      const prev = this.pendingBackendRestarts.get(backendId);
      this.pendingBackendRestarts.set(backendId, prev ? `${prev}; ${reason}` : reason);
      return;
    }
    const proc = this.backends.get(backendId);
    if (!proc) return;
    this.restartingBackends.add(backendId);
    logInfo(`[AgentMode] restarting ${backendId} backend: ${reason}`);
    try {
      const affected = Array.from(this.sessions.values()).filter((s) => s.backendId === backendId);
      // Don't respawn a replacement for a backend that is no longer installed
      // (e.g. its custom path was just cleared) — the spawn would fail. The
      // affected sessions are still closed; the tab falls back to its
      // needs-setup state. `restartBackendNow` is otherwise only reached for an
      // installed backend, so this is a no-op for the normal restart path.
      const shouldCreateReplacement =
        this.isBackendInstalled(backendId) &&
        affected.length > 0 &&
        affected.some((s) => s.internalId === this.activeSessionId);
      for (const session of affected) {
        await this.closeSession(session.internalId);
      }
      await proc.shutdown();
      if (this.backends.get(backendId) === proc) {
        this.backends.delete(backendId);
      }
      this.preloader.clearCached(backendId);
      new Notice(`${this.resolveDescriptor(backendId).displayName} refreshed.`);
      if (!this.disposed && this.isBackendInstalled(backendId)) {
        // Spawn config (enabled models, keys, prompt, skills) is rebuilt on
        // every restart, and the picker's catalog *and* per-model effort
        // catalog both derive from it. A live session mirrors catalog state via
        // attachModelCacheSync but NOT the effort catalog, so always re-probe —
        // the prefetch repopulates effort for every enabled model. When a tab
        // on this backend is active, await the probe and let the replacement
        // adopt its warm proc: one spawn, and the per-model switch flicker
        // stays on the throwaway probe session instead of the user's.
        const probe = this.preloader.preload(backendId);
        this.registerPreload(backendId, probe);
        if (shouldCreateReplacement && !this.disposed) {
          await probe;
          await this.createSession(backendId);
        }
      }
      this.notify();
    } finally {
      this.restartingBackends.delete(backendId);
    }
    // Drain any restart requests that landed while we were running. Clear the
    // entry BEFORE re-invoking so the recursion can't loop forever — a fresh
    // request landing during the next restart will repopulate it.
    const queued = this.pendingBackendRestarts.get(backendId);
    if (queued !== undefined && !this.disposed) {
      this.pendingBackendRestarts.delete(backendId);
      if (this.hasBusySession(backendId)) {
        // A session went busy between requests; fall back to the deferral
        // path so we don't tear down mid-turn.
        this.pendingBackendRestarts.set(backendId, queued);
        return;
      }
      try {
        await this.restartBackendNow(backendId, queued);
      } catch (err) {
        this.lastError = err2String(err);
        logError(`[AgentMode] queued ${backendId} backend restart failed`, err);
        this.notify();
      }
    }
  }
}
