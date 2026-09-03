import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import {
  agentProjectContextLoadAtom,
  type AgentInFlightSource,
  type AgentProjectContextLoadState,
  type ContextLoadStepCount,
  type FailedItem,
} from "@/aiParams";
import {
  getSettings,
  setSettings,
  settingsStore,
  subscribeToSettingsChange,
  type CopilotSettings,
} from "@/settings/model";
import {
  ensureProjectContextMaterialized,
  EMPTY_CONTEXT_MATERIALIZATION_RESULT,
  materializeProjectContextSource,
  type ContextMaterializationResult,
  type ContextMaterializeProgress,
} from "@/context/projectContextMaterializer";
import type {
  MaterializedSourceType,
  MaterializeSourceIdentity,
  SourceFailure,
} from "@/context/contextCacheStore";
import { err2String } from "@/utils";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { fileToHistoryItem, readChatPathProjectId } from "@/utils/chatHistoryUtils";
import { readFrontmatterViaAdapter } from "@/utils/vaultAdapterUtils";
import { App, FileSystemAdapter, Notice, Platform, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { AgentSession, ATTENTION_TRIGGER_STATUSES, DEFAULT_TITLE_PREFIX } from "./AgentSession";
import type { AgentChatPersistenceManager } from "./AgentChatPersistenceManager";
import type { AgentModelPreloader } from "./AgentModelPreloader";
import { buildNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { playNotificationSound } from "@/utils/notificationSound";
import type { AgentSessionIndex } from "./AgentSessionIndex";
import {
  deriveChatTitleFromMessages,
  mergeChatHistoryItems,
  type MarkdownChatEntry,
} from "./chatHistoryMerge";
import { MethodUnsupportedError } from "./errors";
import { replayPersistedMode } from "./replayPersistedMode";
import {
  FanoutOrchestrator,
  type FanoutHost,
  type FanoutRunInput,
} from "./fanout/FanoutOrchestrator";
import type { FanoutTurn } from "./fanout/fanoutTypes";
import { modelCatalogSignature } from "./translateBackendState";
import { GLOBAL_SCOPE, type ProjectScopeId } from "./scope";
import {
  OrphanedProjectError,
  pickScopeNeighbor,
  resolveProjectIdForCwd,
  resolveScopeCwd,
} from "./sessionScope";
import {
  getCachedProjectRecordById,
  getCachedProjectRecords,
  subscribeToProjectRecords,
} from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";
import {
  composeContextDirtyKey,
  contextDirtyKeyMatchesConfig,
  getProjectContextSignature,
  getProjectLandingCaptureSignature,
  landingCaptureIsVerifiable,
} from "@/projects/projectContextSignature";
import { ProjectContentTracker } from "@/context/projectContentTracker";
import { buildProjectContextUpdatesBlock } from "@/context/contextUpdatesBlockBuilder";
import { ensureAgentsFileForDiscovery } from "@/instructions/agentsFile";
import { moveProjectPromptToAgentsFile } from "@/projects/moveProjectPrompt";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  BackendDescriptor,
  BackendId,
  BackendModelCatalog,
  BackendProcess,
  CopilotMode,
  EffortOption,
  LoadSessionOutput,
  ModeApplySpec,
  ModelSelection,
  PermissionDecision,
  PermissionPrompt,
  SessionId,
} from "./types";

const AUTOSAVE_DEBOUNCE_MS = 500;
/**
 * Upper bound on the opportunistic `listSessions` sweep that enriches the
 * recent-chats list from already-running backends. The session index answers
 * the list on its own, so a slow agent must never hold the popover hostage.
 */
const LIST_SESSIONS_TIMEOUT_MS = 1_500;

/** Resolve with `fallback` if `promise` hasn't settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/**
 * Compare two cwd strings for "same directory" after stripping trailing
 * separators. Agents echo back the cwd we handed them, so an exact
 * normalized match is the right level of strictness — anything looser
 * risks leaking another vault's sessions into this vault's history.
 */
function isSameCwd(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+$/, "");
  return norm(a) === norm(b);
}

// Referential-stability constants for "empty" returns — never hand back a fresh
// `[]` (would churn React consumers of these getters).
const EMPTY_SESSIONS = Object.freeze([]) as unknown as AgentSession[];
const EMPTY_HISTORY_ITEMS = Object.freeze([]) as unknown as ChatHistoryItem[];
// DESIGN NOTE — intentionally NOT Object.freeze'd, unlike the array constants above.
// (a) Goal is referential stability: an empty `getRunningChatIds()` /
//     `getAttentionChatIds()` always hands back this same instance, so React
//     consumers compare by identity (tests assert `toBe`).
// (b) `Object.freeze` is a no-op for a Set's contents — `Object.freeze(new Set()).add(x)`
//     still succeeds (freeze guards own properties, not the internal `[[SetData]]` slot),
//     so wrapping it would buy nothing the array constants' freeze buys.
// (c) Runtime immutability rests on the `ReadonlySet<string>` type (no `.add`/`.delete` in
//     the surface) plus the convention that no caller mutates the result — consumers only
//     `.has()`, read `.size`, and iterate.
const EMPTY_RECENT_CHAT_IDS: ReadonlySet<string> = new Set();

// Delivery-cursor seed for a resumed session: BEHIND any real content epoch
// (which starts at 0), so its first send always emits the coarse freshness note
// regardless of whether a change was observed this plugin session.
const RESUMED_SESSION_BEHIND_EPOCH = -1;

/**
 * Map a materializer {@link SourceFailure} to the atom's {@link FailedItem}. The
 * cache layer's `"file"` kind becomes the UI's `"nonMd"` (markdown is never
 * materialized, so an agent failure is only ever web/youtube/nonMd).
 */
function toFailedItem(failure: SourceFailure): FailedItem {
  return {
    path: failure.source,
    type: failure.kind === "file" ? "nonMd" : failure.kind,
    error: failure.error,
    usedStaleSnapshot: failure.usedStaleSnapshot,
  };
}

/** Whether a {@link FailedItem} refers to the same source as a lifecycle event
 * (the cache layer's `"file"` kind is the atom's `"nonMd"`). */
function failedItemIsSource(failed: FailedItem, item: MaterializeSourceIdentity): boolean {
  if (failed.path !== item.source) return false;
  return item.kind === "file" ? failed.type === "nonMd" : failed.type === item.kind;
}

/** Add a source to the live "processing" set (no-op if already present). Returns a
 * NEW array on change so the atom publish is referentially distinct. */
function addProcessingSource(
  list: AgentInFlightSource[],
  item: MaterializeSourceIdentity
): AgentInFlightSource[] {
  if (list.some((s) => s.kind === item.kind && s.source === item.source)) return list;
  return [...list, { kind: item.kind, source: item.source }];
}

/** Remove a source from the live "processing" set. */
function removeProcessingSource(
  list: AgentInFlightSource[],
  item: MaterializeSourceIdentity
): AgentInFlightSource[] {
  return list.filter((s) => !(s.kind === item.kind && s.source === item.source));
}

/** Append a freshly-settled failure, dropping any prior entry for the same source. */
function upsertFailedItem(list: FailedItem[], failure: FailedItem): FailedItem[] {
  return [...list.filter((f) => !(f.path === failure.path && f.type === failure.type)), failure];
}

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

/** Controls which user-facing state an in-place runtime-session replacement inherits. */
export interface ReplaceSessionOptions {
  preserveChatInput?: boolean;
  seedSelection?: ModelSelection;
}

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
  /**
   * Plugin-local index of resumable backend sessions, the markdown-free half
   * of the recent-chats list. Optional only so legacy callers (tests) can
   * omit it; production wiring always supplies one via the barrel in
   * `agentMode/index.ts`.
   */
  sessionIndex?: AgentSessionIndex;
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
/**
 * Text bound to a logical composer before its session is shown. A draft is
 * left in the composer for review; a submit is sent as the chat's next turn.
 */
export interface ComposerHandoff {
  text: string;
  submit: boolean;
}

export class AgentSessionManager {
  private backends = new Map<BackendId, BackendProcess>();
  private starting = new Map<BackendId, Promise<BackendProcess>>();
  private sessions = new Map<string, AgentSession>();
  private chatUIStates = new Map<string, AgentChatUIState>();
  private activeSessionId: string | null = null;
  // The scope the active session belongs to. Invariant:
  // `activeSession.projectId === activeProjectId` (active always belongs to the
  // current scope). `GLOBAL_SCOPE` is the implicit global workspace.
  private activeProjectId: ProjectScopeId = GLOBAL_SCOPE;
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  // Scope identity alone cannot detect A → B → A navigation while an async
  // transition is pending, so rollback ownership uses this monotonic version.
  private scopeSeq = 0;
  // Per-scope most-recently-used session id, so re-entering a scope restores
  // the tab the user last looked at there.
  private readonly lastActiveByScope = new Map<ProjectScopeId, string>();
  // Live sessions hidden from the current tab strip. Re-entering a project
  // detaches its prior conversational sessions here so the strip shows only the
  // fresh visit's workset — but they stay in `this.sessions` (and on disk), so
  // chat history still lists them and their running/attention indicators stay
  // live. Re-attached by `setActiveSession` (history open / tab click) and
  // pruned whenever a session leaves the pool. Keyed by the globally-unique
  // `internalId`, so no per-scope bucketing is needed.
  private readonly detachedFromTabIds = new Set<string>();
  // Projects whose context sources changed since their last materialization,
  // keyed by id → the context signature AT THE TIME the change was observed.
  // A dirty project must NOT reuse a pre-existing empty landing on re-entry (its
  // captured `<project_context>` is stale) and must NOT keep a stale landing in
  // the strip. Cleared once a freshly-created session captures the SAME
  // signature — a newer edit's signature won't match, so its dirtiness survives
  // (no lost update). Mirrors chat mode's `markdownNeedsReload`.
  private readonly contextDirtySignatures = new Map<ProjectScopeId, string>();
  // A project landing session captures MORE than materialized context at
  // creation: each backend reads the project's instruction files from cwd.
  // The materialization dirty flag
  // above deliberately ignores `systemPrompt`, so reuse decisions need their own
  // fingerprint of what the session actually baked in (the landing-capture
  // signature). Keyed by internal session id; every project session gets an
  // entry, but only landing-shaped ones (idle/empty) are ever consulted for
  // reuse. A missing entry means "not reusable as a project landing".
  private readonly landingCaptureSignatures = new Map<string, string>();
  // Watches the vault for changes to files a project's declared sources point at
  // and bumps a per-project content epoch; a bump marks the project dirty (via
  // `markProjectContextDirty`) and lets ongoing/resumed sessions surface a coarse
  // "sources may have changed" note. Constructed/subscribed in the constructor,
  // disposed in `dispose`.
  private readonly contentTracker: ProjectContentTracker;
  private contentTrackerUnsubscribe?: () => void;
  // The content epoch each session has already been shown (via the coarse note or
  // its fresh first-turn manifest). A session whose project's epoch has advanced
  // past this value gets the note on its next send. Keyed by internal session id;
  // a resumed session seeds a "behind" sentinel so its first send always notes.
  private readonly lastSeenProjectContentEpochBySession = new Map<string, number>();
  // Snapshot of project records from the previous change notification, diffed
  // against the next to detect context-source edits. Seeded in the constructor.
  private previousProjectRecords: ProjectFileRecord[] = [];
  private projectRecordsUnsubscriber?: () => void;
  // Dedupe only the auto-spawn path, PER scope. Direct `createSession()` calls
  // (e.g. `+` clicks) are independent — concurrent ones each spawn their own
  // session. Keyed by scope so entering two scopes can't share one in-flight
  // spawn; the key is cleared in `finally` so the next enter doesn't reuse a
  // settled promise.
  private readonly firstSessionPromiseByScope = new Map<ProjectScopeId, Promise<AgentSession>>();
  // Serializes replacements for one logical input even after its runtime session id changes.
  // The cursor retains the last successful owner when an individual replacement fails.
  private readonly replacementCursorByChatInputId = new Map<string, Promise<string>>();
  // Composer handoffs are keyed to the logical composer id, not the active
  // session pointer. This prevents a handoff from landing in the prior chat
  // while React commits the new active session.
  private readonly composerHandoffByChatInputId = new Map<string, ComposerHandoff>();
  // Native session identity is stable across markdown/native history surfaces.
  // Sharing one resume prevents duplicate AgentSessions and backend handlers
  // when the same row is opened again before the first load settles.
  private readonly resumedSessionPromiseById = new Map<string, Promise<AgentSession | null>>();
  // History opens may finish out of order. Only the most recent request may
  // move focus; older successful loads remain available as background tabs.
  private latestHistoryLoadRequestId = 0;
  private pendingCreates = 0;
  private listeners = new Set<() => void>();
  private disposed = false;
  private startingBackendId: BackendId | null = null;
  private lastError: string | null = null;
  /**
   * Bumped on every recorded failure. Lets a create that succeeds tell "no failure happened
   * while I was starting" (clear the banner) from "a sibling create failed in the meantime"
   * (leave it). Without it the distinction rests on microtask ordering between two creates'
   * `ready` chains, which any added await before `newSession` silently flips.
   */
  private lastErrorSeq = 0;

  private readonly pendingBackendRestarts = new Map<
    BackendId,
    { reason: string; immediate: boolean }
  >();
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
  // - `indexTimer`: pending session-index write-through debounce timer
  // - `unsub`: tear-down for the auto-save `session.subscribe()`
  // - `signature`: last serialized snapshot, for no-op skipping
  // - `attentionUnsub`: tear-down for the per-session status watcher that both
  //   flags needs-attention AND notifies on running-membership flips (spinner)
  private readonly sessionState = new Map<
    string,
    {
      path?: string;
      timer?: number;
      indexTimer?: number;
      unsub?: () => void;
      signature?: string;
      attentionUnsub?: () => void;
    }
  >();

  // Session ids of ephemeral read-only fan-out sub-sessions; the shared permission
  // prompter consults this to hard-deny write/exec tools for them.
  private readonly readOnlyFanoutSessions = new Set<SessionId>();
  // Serializes per-session default-model re-applies so two rapid settings
  // changes can't race their setModel/setConfigOption round-trips and leave
  // the session on a stale model. Each link re-reads the latest default, so
  // the final settings value always wins.
  private readonly defaultApplyChains = new Map<string, Promise<void>>();
  private readonly fanoutOrchestrator: FanoutOrchestrator;
  // Tear-down for the settings subscription that re-applies a changed
  // per-backend default model to any live session on that backend.
  private readonly settingsUnsub: () => void;

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
    this.fanoutOrchestrator = new FanoutOrchestrator(this.createFanoutHost());
    this.settingsUnsub = subscribeToSettingsChange((prev, next) =>
      this.onDefaultSelectionsChanged(prev, next)
    );
    this.contentTracker = new ProjectContentTracker(this.app);
    this.contentTrackerUnsubscribe = this.contentTracker.onContentChanged((projectId) =>
      this.markProjectContextDirty(projectId)
    );
    this.setupProjectRecordChangeMonitor();
  }

  /**
   * React to a per-backend default model change made in settings: re-apply
   * it to any live session on that backend so the user's *next* turn uses
   * it (an in-flight turn is unaffected — the descriptor's live re-apply
   * only takes effect on the following prompt). Routes through
   * `descriptor.applySelection` directly rather than `this.applySelection`
   * to avoid re-entrancy with the settings write that triggered us, and to
   * reach a non-active session on that backend.
   */
  private onDefaultSelectionsChanged(prev: CopilotSettings, next: CopilotSettings): void {
    const prevBackends = prev.agentMode?.backends as
      | Record<string, { defaultModel?: ModelSelection | null } | undefined>
      | undefined;
    const nextBackends = next.agentMode?.backends as
      | Record<string, { defaultModel?: ModelSelection | null } | undefined>
      | undefined;
    for (const session of this.sessions.values()) {
      if (session.getStatus() === "closed") continue;
      const backendId = session.backendId;
      const before = prevBackends?.[backendId]?.defaultModel ?? null;
      const after = nextBackends?.[backendId]?.defaultModel ?? null;
      if (before?.baseModelId === after?.baseModelId && before?.effort === after?.effort) continue;
      const descriptor = this.opts.resolveDescriptor(backendId);
      if (!descriptor) continue;
      this.enqueueDefaultApply(session, descriptor);
    }
  }

  /**
   * Append a default-model re-apply to the session's serialized chain. The
   * apply re-reads the latest default at run time, so when several changes land
   * in a burst the final settings value wins instead of an out-of-order
   * round-trip. Clearing to "Agent default" leaves an existing session on its
   * current model; future sessions inherit the backend-reported default.
   * Chaining off `session.ready` also covers a session still in its startup
   * window, which has no `backendSessionId` yet and would throw on a bare
   * `applySelection`.
   */
  private enqueueDefaultApply(session: AgentSession, descriptor: BackendDescriptor): void {
    const backendId = session.backendId;
    const prior = this.defaultApplyChains.get(session.internalId) ?? Promise.resolve();
    const next = prior
      .then(() => session.ready)
      .then(() => {
        if (session.getStatus() === "closed") return;
        const target = this.getDefaultSelection(backendId);
        if (!target) return;
        return descriptor.applySelection(session, target);
      })
      .catch((e) => logWarn(`[AgentMode] re-applying default model for ${backendId} failed`, e))
      .finally(() => {
        if (this.defaultApplyChains.get(session.internalId) === next) {
          this.defaultApplyChains.delete(session.internalId);
        }
      });
    this.defaultApplyChains.set(session.internalId, next);
  }

  /** Whether `backendSessionId` is an ephemeral read-only fan-out sub-session. */
  isReadOnlyFanoutSession(backendSessionId: SessionId): boolean {
    return this.readOnlyFanoutSessions.has(backendSessionId);
  }

  /** Run a multi-agent read-only QA turn. Called by `AgentSession.runTurn` when the turn fans out. */
  runFanoutTurn(input: FanoutRunInput): Promise<FanoutTurn> {
    return this.fanoutOrchestrator.run(input);
  }

  /** Narrow backend seam the {@link FanoutOrchestrator} drives. */
  private createFanoutHost(): FanoutHost {
    return {
      ensureBackendForFanout: async (backendId) => {
        const descriptor = this.resolveDescriptor(backendId);
        const proc = await this.ensureBackend(backendId, descriptor);
        return { proc, descriptor };
      },
      // An absent preference leaves the fan-out sub-session on the model its
      // own session/new reports; catalog ordering carries no default meaning.
      getDefaultSelection: (backendId) => this.getDefaultSelection(backendId),
      getDisplayName: (backendId) => this.resolveDescriptor(backendId).displayName,
      // DESIGN NOTE: fan-out sub-sessions intentionally run at the vault root,
      // not the originating session's project folder, and aren't handed the
      // project's `projectId` / `additionalDirectories`. This is the seam where
      // multi-agent QA (which predates project workspaces) meets project scope.
      // It's acceptable because the project's knowledge already reaches every
      // answerer: `runTurn` injects the first-turn `<project_context>` block into
      // the shared fan-out prompt. What a sub-session lacks is project-scoped
      // tool *reach* (cwd + external roots) — tolerable for ephemeral read-only
      // QA, whose answers are advisory and whose authoritative, fully-scoped reply
      // comes from the main session. Threading project scope into the sub-sessions
      // is a deliberate follow-up, not part of the project-workspace landing.
      getCwd: () => {
        const adapter = this.app.vault.adapter;
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
      },
      registerReadOnlySession: (sessionId) => {
        this.readOnlyFanoutSessions.add(sessionId);
        return () => this.readOnlyFanoutSessions.delete(sessionId);
      },
      excludeSubSessionFromHistory: (backendId, sessionId) => {
        void this.opts.sessionIndex?.deleteSession(backendId, sessionId);
      },
    };
  }

  /**
   * Watch project config edits so a changed context source (URLs / inclusions /
   * etc.) invalidates the project's materialized context. Seeds the prior-records
   * snapshot up front so the first notification diffs against the real baseline.
   */
  private setupProjectRecordChangeMonitor(): void {
    this.previousProjectRecords = getCachedProjectRecords();
    this.projectRecordsUnsubscriber?.();
    this.projectRecordsUnsubscriber = subscribeToProjectRecords((nextRecords) => {
      this.handleProjectRecordsChanged(nextRecords);
    });
  }

  /**
   * Diff the new project records against the previous snapshot and mark any
   * project whose context signature changed as dirty (its materialized context
   * is stale). For the ACTIVE project we also warm its off-vault conversion
   * cache in the background so the next chat there starts with sources already
   * fetched — the
   * warm never publishes to {@link agentProjectContextLoadAtom}, so it can never
   * gate the composer of a session that won't even consume the new context.
   */
  private handleProjectRecordsChanged(nextRecords: ProjectFileRecord[]): void {
    if (this.disposed) return;
    const prevRecords = this.previousProjectRecords;
    this.previousProjectRecords = nextRecords;

    // Drop dirty flags for projects that no longer exist (deleted/renamed-away).
    const nextIds = new Set(nextRecords.map((r) => r.project.id));
    for (const id of this.contextDirtySignatures.keys()) {
      if (!nextIds.has(id)) this.contextDirtySignatures.delete(id);
    }

    for (const nextRecord of nextRecords) {
      const prevRecord = prevRecords.find((r) => r.project.id === nextRecord.project.id);
      if (!prevRecord) continue; // brand-new project: nothing materialized yet
      const nextSignature = getProjectContextSignature(nextRecord);
      if (getProjectContextSignature(prevRecord) === nextSignature) continue;

      const projectId = nextRecord.project.id;
      // Advance the SAME content epoch a file change uses, so an ongoing session
      // gets the coarse note when a config edit adds a source it can't otherwise
      // see (a new URL/PDF/folder). Bump BEFORE marking dirty so the dirty key
      // carries the new epoch; same key shape as a content change, so the clear
      // guard treats both uniformly. A config edit also keeps the baseline warm of
      // the active project (its sources may have genuinely changed).
      this.contentTracker.bumpEpoch(projectId);
      this.markProjectContextDirty(projectId, nextRecord);
      if (projectId === this.activeProjectId) this.warmProjectContext(projectId);
    }
  }

  /**
   * Flag a project's materialized context as stale under an epoch-salted dirty
   * key (config signature + the tracker's current content epoch). A pure content
   * edit doesn't move the config signature, so the epoch salt is what lets it read
   * as a distinct dirty revision and gate empty-landing reuse. Unlike a config
   * change this does NOT warm — freshness is recovered lazily when the next
   * session for the project materializes (the empty-landing gate forces that).
   */
  private markProjectContextDirty(
    projectId: ProjectScopeId,
    record = getCachedProjectRecordById(projectId)
  ): void {
    if (this.disposed || projectId === GLOBAL_SCOPE || !record) return;
    const key = composeContextDirtyKey(
      getProjectContextSignature(record),
      this.contentTracker.getEpoch(projectId)
    );
    this.contextDirtySignatures.set(projectId, key);
  }

  /**
   * Fire-and-forget refresh of a project's off-vault conversion-cache snapshots. Unlike
   * {@link rematerializeContext} this NEVER touches the context-load atom, so it
   * silently warms the disk cache without gating any composer. The materializer
   * single-flights and cheap-skips unchanged sources, so a newly-added URL is
   * fetched while everything else is a no-op. Skipped off-desktop (no adapter).
   */
  private warmProjectContext(projectId: ProjectScopeId): void {
    if (this.disposed || projectId === GLOBAL_SCOPE) return;
    let cwd: string;
    try {
      cwd = this.resolveSessionCwd(projectId);
    } catch {
      return; // off-desktop: no FileSystemAdapter, nothing to warm
    }
    void ensureProjectContextMaterialized(
      this.app,
      projectId,
      cwd,
      undefined,
      undefined,
      this.currentContextRevisionKey(projectId)
    ).catch((err) => logWarn(`[AgentMode] background context warm failed for ${projectId}`, err));
  }

  /**
   * The epoch-salted revision key for a project's CURRENT config + content epoch,
   * passed to the materializer's single-flight so a run reading stale content is
   * superseded rather than joined once the content epoch advances. `undefined`
   * when no record is cached (the materializer then falls back to the config
   * signature, its prior behavior).
   */
  private currentContextRevisionKey(projectId: ProjectScopeId): string | undefined {
    const record = getCachedProjectRecordById(projectId);
    if (!record) return undefined;
    return composeContextDirtyKey(
      getProjectContextSignature(record),
      this.contentTracker.getEpoch(projectId)
    );
  }

  /** Whether a project's materialized context is known to be stale. */
  private isProjectContextDirty(projectId: ProjectScopeId): boolean {
    return this.contextDirtySignatures.has(projectId);
  }

  /**
   * Clear a project's dirty flag once a freshly-created session has captured its
   * context — but ONLY if the dirty key still EXACTLY equals the one captured at
   * this session's materialization kickoff (a newer config edit or content bump
   * replaces the key, so it won't match and the project stays dirty — the
   * lost-update guard), AND the materializer result's config signature belongs to
   * that captured key's config. The exact-key check is what makes the epoch-salted
   * content revision safe: paired with the materializer's `revisionKey`, the run
   * that resolved actually read the captured epoch's content.
   */
  private clearContextDirtyIfCaptured(
    projectId: ProjectScopeId,
    capturedKey: string | undefined,
    resultContextSignature: string | undefined
  ): void {
    if (capturedKey === undefined || resultContextSignature === undefined) return;
    if (this.contextDirtySignatures.get(projectId) !== capturedKey) return;
    if (contextDirtyKeyMatchesConfig(capturedKey, resultContextSignature)) {
      this.contextDirtySignatures.delete(projectId);
    }
  }

  /**
   * Sync accessor wired into a project session (see `ProjectContextUpdatesHooks`):
   * flush pending vault events so this send sees a just-made edit, then return the
   * coarse note iff the project's content epoch has advanced past what this session
   * last saw. GLOBAL sessions never get the hook, so this is a project-only path.
   *
   * DESIGN NOTE — this hook only emits a coarse "sources may have changed" note; it
   * deliberately does NOT rebuild the live session's `projectContextBlock` or remount
   * its `additionalDirectories` (both captured at session init). So a source added or
   * edited while an empty landing sits open surfaces as the note on the first in-place
   * send, but the manifest/roots stay as captured: already-mounted or in-cwd sources
   * are re-read by the agent when the note prompts it, whereas a newly-declared
   * external root or a materialized snapshot (e.g. a PDF conversion) is only recovered
   * by a fresh or re-entered session — the empty-landing reuse gate forces that on
   * leave/re-enter. This keeps a pure content change from triggering any in-place
   * re-materialization; full in-place source re-delivery is a separate concern.
   * If a future review flags the in-place stale manifest again, point them here.
   */
  private getProjectContextUpdates(
    internalId: string,
    projectId: ProjectScopeId
  ): { epoch: number; block: string } | null {
    if (projectId === GLOBAL_SCOPE) return null;
    this.contentTracker.flushNow();
    const epoch = this.contentTracker.getEpoch(projectId);
    const lastSeen = this.lastSeenProjectContentEpochBySession.get(internalId) ?? 0;
    if (epoch <= lastSeen) return null;
    return { epoch, block: buildProjectContextUpdatesBlock() };
  }

  /** Advance a session's content-epoch cursor once its note rode an accepted turn. */
  private markProjectContextUpdatesDelivered(internalId: string, epoch: number): void {
    const lastSeen = this.lastSeenProjectContentEpochBySession.get(internalId) ?? 0;
    if (epoch > lastSeen) this.lastSeenProjectContentEpochBySession.set(internalId, epoch);
  }

  /**
   * List every known Agent Mode chat as a `ChatHistoryItem`: markdown-saved
   * notes (ranked using the plugin's shared in-memory `lastAccessedAt`
   * tracker) merged with the session index's native-store entries, de-duped
   * on `backendId + sessionId`. Native entries exist independently of the
   * `autosaveChat` setting, so the list survives autosave being off. Before
   * merging, already-running backends are swept via `listSessions` (bounded
   * by {@link LIST_SESSIONS_TIMEOUT_MS}) so chats created outside the plugin
   * surface too — a backend is never spawned just to enumerate history.
   */
  async getChatHistoryItems(scope?: ProjectScopeId): Promise<ChatHistoryItem[]> {
    const persistence = this.opts.persistenceManager;
    const index = this.opts.sessionIndex;
    if (!persistence && !index) return EMPTY_HISTORY_ITEMS;

    // Paths of saved chats backed by a live session that is flagging for
    // attention (finished / errored / paused while backgrounded). In-memory and
    // app-lifetime only — purely-on-disk chats stay unflagged. Applied in the
    // map below so both the global and project views carry the cue.
    const liveAttentionPaths = this.collectLiveAttentionPaths();

    let files: TFile[] = [];
    let markdownEntries: MarkdownChatEntry[] = [];
    if (persistence) {
      files = await persistence.getAgentChatHistoryFiles();
      const tracker = this.plugin.getChatHistoryLastAccessedAtManager();
      markdownEntries = await Promise.all(
        files.map(async (file) => {
          // readSessionRefFromFile falls back to an adapter read for files in
          // hidden save folders, which the metadata cache never indexes — a
          // cache-only read would leave those rows unmergeable and duplicate
          // their native twins.
          const ref = await this.readSessionRefFromFile(file.path);
          const item = fileToHistoryItem(this.app, file, tracker);
          return {
            item: liveAttentionPaths.has(item.id) ? { ...item, needsAttention: true } : item,
            backendId: ref?.backendId,
            sessionId: ref?.sessionId,
          };
        })
      );
    }

    // Project view: resolve the AUTHORITATIVE projectId per file and keep only
    // this scope's chats. The sync `fileToHistoryItem` reads only metadataCache,
    // which can lag right after a save or miss hidden-dir files — that would
    // default such a chat to global and wrongly drop it from its project list.
    // `readChatPathProjectId` hits the cache for indexed files (zero extra IO)
    // and falls back to a one-shot adapter read only for unindexed ones.
    if (scope && scope !== GLOBAL_SCOPE) {
      const resolved = await Promise.all(
        files.map(async (file, i) => {
          const projectId =
            (await readChatPathProjectId(this.app, file.path))?.trim() || GLOBAL_SCOPE;
          return projectId === scope ? markdownEntries[i] : null;
        })
      );
      // Drop cross-device-unresumable chats AFTER scope resolution: the resolver
      // indexes `markdownEntries[i]` against `files`, so filtering the list before
      // it would misalign those indices.
      const scopedMarkdown = await this.dropNonLocalMarkdownEntries(
        resolved.filter((entry): entry is MarkdownChatEntry => entry !== null)
      );
      if (!index) {
        const items = scopedMarkdown.map((e) => e.item);
        return items.length === 0 ? EMPTY_HISTORY_ITEMS : items;
      }
      // Native entries scope by the index's recorded projectId (written
      // through from live sessions, or cwd-attributed by the sweep), so
      // autosave-off project chats list here too — same dual-source merge as
      // the global view, just filtered to this scope on both sides.
      await this.refreshNativeSessionsFromBackends();
      const scopedNative = (await index.getEntries()).filter((e) => e.projectId === scope);
      const merged = mergeChatHistoryItems(scopedMarkdown, scopedNative);
      return merged.length === 0 ? EMPTY_HISTORY_ITEMS : merged;
    }

    markdownEntries = await this.dropNonLocalMarkdownEntries(markdownEntries);
    if (!index) return markdownEntries.map((e) => e.item);

    await this.refreshNativeSessionsFromBackends();
    const nativeEntries = await index.getEntries();
    return mergeChatHistoryItems(markdownEntries, nativeEntries);
  }

  /**
   * Saved-file paths of live sessions currently flagging `needsAttention`. The
   * path is keyed off the session's persisted file (set after its first save),
   * matching `ChatHistoryItem.id`. Sessions that never saved (no path) or aren't
   * flagging are skipped.
   */
  private collectLiveAttentionPaths(): Set<string> {
    const paths = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (!session.getNeedsAttention()) continue;
      const path = this.sessionState.get(internalId)?.path;
      if (path) paths.add(path);
    }
    return paths;
  }

  /**
   * Every recent-list id this session may currently be rendered under. The ids
   * match `ChatHistoryItem.id`: the persisted markdown path once saved, the
   * `(backendId, sessionId)` native id before that. Deliberately BOTH when both
   * exist: the mounted landing list is a snapshot, so right after the first
   * autosave re-keys the chat from native id to path, the visible row may still
   * carry the old native id — emitting both keeps `.has()` hitting whichever
   * the row was rendered under, with no history reload. Harmless overshoot: a
   * native id maps to the same chat and its native twin row is de-duped away.
   *
   * DESIGN NOTE — known limitation, deliberately deferred: a session that has
   * neither saved nor reached the native index yet has NO row in the list at
   * all, so its spinner/dot has nowhere to hang until the list next reloads.
   * That's a missing row, not an id mismatch — dual ids can't help, and forcing
   * a history reload from here would couple autosave to row visibility.
   */
  private recentChatIdsForSession(internalId: string, session: AgentSession): string[] {
    const ids: string[] = [];
    const path = this.sessionState.get(internalId)?.path;
    if (path) ids.push(path);
    const backendSessionId = session.getBackendSessionId();
    if (backendSessionId) ids.push(buildNativeChatId(session.backendId, backendSessionId));
    return ids;
  }

  /**
   * Recent-list ids of pool sessions whose backend turn is currently
   * `"running"`, so the landing rows can swap their relative-time chip for a
   * spinner. Only `"running"` counts — `awaiting_permission` is surfaced via
   * the needs-attention dot. Returns a shared module constant when empty so
   * React consumers don't churn on a fresh `Set`.
   */
  getRunningChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (session.getStatus() !== "running") continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  /**
   * Recent-list ids of pool sessions currently flagging needs-attention, so a
   * row's done-dot can light up the moment its backgrounded turn finishes —
   * the live complement to the `item.needsAttention` snapshot that
   * `getChatHistoryItems` bakes in at load time (which goes stale the moment a
   * session finishes after the list mounted, and never covers native-only
   * rows). Same shape and constant-on-empty contract as `getRunningChatIds`.
   */
  getAttentionChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (!session.getNeedsAttention()) continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  /**
   * Update the user-visible title of a saved chat — frontmatter `topic` for
   * markdown chats, the index entry (plus the live session's label, when the
   * session is open) for native-store entries.
   */
  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const native = parseNativeChatId(fileId);
    if (native) {
      const index = this.opts.sessionIndex;
      if (!index) throw new Error("Agent session index is not configured.");
      await index.setTitle(native.backendId, native.sessionId, newTitle);
      // Match the (backendId, sessionId) pair, not the id alone: on a
      // cross-backend id collision, renaming by id could relabel the wrong
      // backend's live tab (and its index entry via the label autosave).
      this.findLiveSession(native.backendId, native.sessionId)?.setLabel(newTitle);
      return;
    }
    const persistence = this.opts.persistenceManager;
    if (!persistence) throw new Error("Agent chat persistence is not configured.");
    await persistence.updateTopic(fileId, newTitle);
  }

  /**
   * Delete a chat from history. Native-store entries are tombstoned in the
   * index (the backend's own session store is left untouched — it's shared
   * with the CLI outside Obsidian). Markdown chats are trashed AND their
   * backend session is tombstoned, so the native twin doesn't reappear on
   * the next merge.
   */
  async deleteChatHistory(fileId: string): Promise<void> {
    const index = this.opts.sessionIndex;
    const native = parseNativeChatId(fileId);
    if (native) {
      if (!index) throw new Error("Agent session index is not configured.");
      this.cancelPendingIndexTouch(native.backendId, native.sessionId);
      await index.deleteSession(native.backendId, native.sessionId);
      return;
    }
    const persistence = this.opts.persistenceManager;
    if (!persistence) throw new Error("Agent chat persistence is not configured.");
    if (index) {
      const ref = await this.readSessionRefFromFile(fileId);
      if (ref) {
        this.cancelPendingIndexTouch(ref.backendId, ref.sessionId);
        await index.deleteSession(ref.backendId, ref.sessionId);
      }
    }
    await persistence.deleteFile(fileId);
  }

  /**
   * Drop any debounced index write-through still pending for a live session
   * with this (backendId, sessionId). Without this, deleting a chat inside the
   * ~500ms debounce window of a recent message/label change lets the already-
   * queued `flushIndexTouch` fire after the tombstone is written — its
   * `recordSession` clears the tombstone and re-adds the deleted chat to
   * Recent Chats. Activity *after* the delete still re-indexes normally (a
   * deliberate "the user is using it again" signal); only the pre-delete
   * timer is cancelled.
   */
  private cancelPendingIndexTouch(backendId: BackendId, sessionId: string): void {
    for (const session of this.sessions.values()) {
      if (session.backendId !== backendId) continue;
      if (session.getBackendSessionId() !== sessionId) continue;
      const state = this.sessionState.get(session.internalId);
      if (state?.indexTimer) {
        window.clearTimeout(state.indexTimer);
        state.indexTimer = undefined;
      }
    }
  }

  /**
   * Read the backend session identity from a saved chat's frontmatter, via
   * the metadata cache with an adapter fallback for hidden-directory files.
   * Returns null when the file predates session-id persistence.
   */
  private async readSessionRefFromFile(
    fileId: string
  ): Promise<{ backendId: BackendId; sessionId: string } | null> {
    let fm: Record<string, unknown> | undefined;
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    }
    if (!fm) {
      try {
        fm = (await readFrontmatterViaAdapter(this.app, fileId)) ?? undefined;
      } catch {
        return null;
      }
    }
    const backendId = typeof fm?.backendId === "string" ? fm.backendId.trim() : "";
    const sessionId = typeof fm?.sessionId === "string" ? fm.sessionId.trim() : "";
    if (!backendId || !sessionId) return null;
    return { backendId, sessionId };
  }

  /**
   * Sweep already-running backends' native session stores into the index.
   * "Running" includes the preloader's warm probe subprocesses — they're
   * spawned for every installed backend at plugin load, so sweeping them
   * surfaces codex/opencode history on the very first Agent Home open,
   * before any chat has started a manager-owned backend. Strictly
   * opportunistic: never spawns a backend, swallows per-backend failures,
   * and is capped by {@link LIST_SESSIONS_TIMEOUT_MS} so the history
   * surface stays responsive when an agent is slow to answer.
   */
  private async refreshNativeSessionsFromBackends(): Promise<void> {
    const index = this.opts.sessionIndex;
    if (!index) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const vaultBasePath = adapter.getBasePath();
    const procs = this.getRunningProcsByBackend();
    if (procs.size === 0) return;
    const sweeps = Array.from(procs, ([backendId, proc]) =>
      this.sweepNativeSessions(backendId, proc, vaultBasePath)
    );
    await withTimeout(
      Promise.allSettled(sweeps).then(() => undefined),
      LIST_SESSIONS_TIMEOUT_MS,
      undefined
    );
  }

  /**
   * Currently-running backend processes, keyed by backend id. "Running"
   * includes the preloader's warm probe subprocesses, spawned for every
   * installed backend at plugin load, so this is populated on the first Agent
   * Home open without spawning anything. Manager-owned procs win over warm
   * probes for the same backend id — they're the same subprocess lineage, but
   * the manager's entry is the one whose lifecycle we control.
   */
  private getRunningProcsByBackend(): Map<BackendId, BackendProcess> {
    const procs = new Map<BackendId, BackendProcess>();
    for (const { backendId, proc } of this.preloader.getWarmProcs()) {
      if (proc.isRunning()) procs.set(backendId, proc);
    }
    for (const [backendId, proc] of this.backends) {
      if (proc.isRunning()) procs.set(backendId, proc);
    }
    return procs;
  }

  /**
   * Drop markdown chats whose backend session can't be resumed on this device
   * — a chat started on another machine syncs its note (with the session id)
   * but not the backend's local transcript store, so resuming it dead-ends.
   * Resumability is probed against each chat's own scope cwd (its project
   * folder, or the vault root for global chats), since a backend may key its
   * transcript store by cwd. Only hides a row when a running backend can
   * cheaply and definitively say
   * the session is absent; an unknown answer (no such capability, backend not
   * running, or a probe error) keeps the row so we never hide a local chat.
   *
   * A dropped chat's `(backendId, sessionId)` is also tombstoned in the index,
   * so the native sweep below doesn't resurface it as a markdown-less row that
   * dead-ends in `loadNativeSessionFromHistory` — a normal autosaved chat has
   * a `flushIndexTouch` index entry twinned with its note.
   */
  private async dropNonLocalMarkdownEntries(
    entries: MarkdownChatEntry[]
  ): Promise<MarkdownChatEntry[]> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return entries;
    const vaultRoot = adapter.getBasePath();
    const procs = this.getRunningProcsByBackend();
    const keep = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.backendId || !entry.sessionId) return true;
        const proc = procs.get(entry.backendId);
        if (!proc?.sessionExistsLocally) return true;
        // Probe with the chat's OWN scope cwd, not the vault root: a project
        // chat's transcript lives under its project folder (Claude keys the
        // transcript path by cwd), so probing every row with the vault root
        // would wrongly report a local project chat as non-resumable and hide
        // it. Resolving per entry keeps both the flat global view and a project
        // view correct. A scope that no longer resolves (deleted project) falls
        // back to keeping the row — never hide a chat on an uncertain answer.
        let cwd: string;
        try {
          const projectId =
            (await readChatPathProjectId(this.app, entry.item.id))?.trim() || GLOBAL_SCOPE;
          cwd = resolveScopeCwd(vaultRoot, projectId);
        } catch {
          return true;
        }
        try {
          return await proc.sessionExistsLocally({ sessionId: entry.sessionId, cwd });
        } catch {
          return true;
        }
      })
    );
    const index = this.opts.sessionIndex;
    if (index) {
      await Promise.all(
        entries.map(async (entry, i) => {
          if (keep[i] || !entry.backendId || !entry.sessionId) return;
          this.cancelPendingIndexTouch(entry.backendId, entry.sessionId);
          await index.deleteSession(entry.backendId, entry.sessionId);
        })
      );
    }
    return entries.filter((_, i) => keep[i]);
  }

  /**
   * Merge one backend's `listSessions` result into the index. Keeps sessions
   * whose cwd is this vault's root (global scope) or a known project folder
   * (attributed to that project) — agent-side cwd filtering is not trusted,
   * and a stray session from another vault must never leak into this vault's
   * history. Skips the preloader's probe session and requires a real title so
   * the sweep can't surface empty placeholder sessions.
   */
  private async sweepNativeSessions(
    backendId: BackendId,
    proc: BackendProcess,
    vaultBasePath: string
  ): Promise<void> {
    const index = this.opts.sessionIndex;
    if (!index) return;
    const descriptor = this.opts.resolveDescriptor(backendId);
    // Only backends that summarize their own titles contribute trustworthy
    // titles to native discovery. For the rest (codex, Claude Code) the agent's
    // title is the raw first prompt (which leaks the injected context envelope),
    // and the sweep has no transcript to derive a clean one — those sessions are
    // indexed via flushIndexTouch with a client-derived title instead.
    if (!descriptor?.summarizesSessionTitle) return;
    let sessions;
    try {
      ({ sessions } = await proc.listSessions({ cwd: vaultBasePath }));
    } catch (err) {
      if (!(err instanceof MethodUnsupportedError)) {
        logWarn(`[AgentMode] listSessions sweep failed for ${backendId}`, err);
      }
      return;
    }
    const probeSessionId = descriptor.getProbeSessionId?.(getSettings());
    const now = Date.now();
    const discovered = [];
    for (const s of sessions) {
      const inVaultRoot = isSameCwd(s.cwd, vaultBasePath);
      // A session run inside a materialized project folder belongs to that
      // project's history; anything matching neither the vault root nor a
      // known project folder is another vault's session.
      const projectId = inVaultRoot ? undefined : resolveProjectIdForCwd(vaultBasePath, s.cwd);
      if (!inVaultRoot && !projectId) continue;
      if (probeSessionId && s.sessionId === probeSessionId) continue;
      // A live fan-out sub-session is ephemeral: skip it even before its
      // async tombstone lands, so a sweep racing the in-flight turn can't
      // surface it as a phantom chat.
      if (this.readOnlyFanoutSessions.has(s.sessionId)) continue;
      const title = s.title?.trim();
      if (!title || title.startsWith(DEFAULT_TITLE_PREFIX)) continue;
      const updatedAtMs = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
      const timestamp = Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : now;
      discovered.push({
        backendId,
        sessionId: s.sessionId,
        title,
        createdAtMs: timestamp,
        lastAccessedAtMs: timestamp,
        projectId,
      });
    }
    if (discovered.length > 0) await index.mergeDiscoveredSessions(discovered);
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
    // Only reuse the active session when it belongs to the current scope —
    // after `enterProject` the prior scope's session may still be pointed at by
    // `activeSessionId` until this seeds a fresh one for the new scope.
    if (active && active.projectId === this.activeProjectId && active.getStatus() !== "closed") {
      return active;
    }
    // Dedupe rapid auto-spawn callers (e.g. the router effect re-running
    // before the first create has populated the pool) so we don't seed two
    // sessions when one was asked for. Keyed per scope so two scopes spawning
    // at once don't collapse into one shared session.
    const scope = this.activeProjectId;
    const pending = this.firstSessionPromiseByScope.get(scope);
    if (pending) return pending;
    const promise = this.createSession(undefined, scope);
    this.firstSessionPromiseByScope.set(scope, promise);
    try {
      return await promise;
    } finally {
      this.firstSessionPromiseByScope.delete(scope);
    }
  }

  /**
   * Spawn a fresh `AgentSession`. Lazily starts the requested backend on its
   * first call. The new session becomes the active one *when its scope is the
   * current one* (a background/restart create stays parked). `backendId`
   * defaults to `settings.agentMode.activeBackend` (the model-picker keeps that
   * in sync with the user's most recently selected default model). `projectId`
   * defaults to the active scope and is bound immutably onto the session.
   *
   * The new session's initial (model, effort) defaults to the persisted
   * default for `backendId` via `getDefaultSelection`. Pass `seedSelection`
   * to seed a specific (model, effort) without touching that default — used
   * by a cross-backend chat pick, which is transient. `chatInputId` is supplied
   * only when the replacement must retain the same logical AgentChatInput.
   */
  async createSession(
    backendId?: BackendId,
    projectId: ProjectScopeId = this.activeProjectId,
    seedSelection?: ModelSelection,
    chatInputId?: string
  ): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }

    // Resolve the backend to spawn: the explicit request, else the persisted
    // default, else opencode. Held in one variable so the whole method — cwd
    // mirror, descriptor, pending-create bookkeeping — uses the same id. Coerce
    // an unknown id (corrupt persisted `activeBackend`, or a removed backend) to
    // opencode so auto-spawn degrades gracefully instead of throwing — the same
    // safety the removed Self-Host redirect used to provide as a side effect.
    const requestedId = backendId ?? getSettings().agentMode?.activeBackend ?? "opencode";
    const resolvedId = this.opts.resolveDescriptor(requestedId) ? requestedId : "opencode";
    // Read SYNCHRONOUSLY, before this method's first await, so the success path below can
    // tell whether any failure landed while this create was in flight.
    const errorSeqAtStart = this.lastErrorSeq;

    // Read the live record once: it drives both the instruction-file ensure below and the
    // landing-capture signature recorded after the session is built.
    const projectRecord =
      projectId === GLOBAL_SCOPE ? undefined : getCachedProjectRecordById(projectId);

    // Make this scope's instructions discoverable BEFORE resolving cwd, so every backend
    // sees them on its first session. Only initializes a scope that has something to
    // preserve (a legacy `project.md` body, or an AGENTS.md already on disk needing its
    // Claude import) — a fresh project folder stays empty. Never throws.
    await this.ensureScopeInstructions(projectId, projectRecord);

    const landingCaptureSignature = projectRecord
      ? getProjectLandingCaptureSignature(this.app, projectRecord)
      : undefined;

    // Resolves the scope's cwd (vault root for global, project folder otherwise)
    // and validates desktop/orphaned up front, before any pending-create state
    // is mutated.
    const cwd = this.resolveSessionCwd(projectId);

    // Kick off context materialization WITHOUT blocking session creation: the
    // session must become visible immediately so the composer's loading card +
    // send-gate render while prefetch runs (§3.1.9). The returned promise is
    // threaded into the session, which awaits it right before `newSession`.
    // Skipped for GLOBAL_SCOPE — no promise, no atom write, byte-identical to a
    // context-free create. Never rejects (degrades to empty roots).
    // Settle queued vault events first so a just-edited source is reflected in the
    // epoch/dirty snapshot below (a `+`-click create doesn't go through
    // `enterProject`'s flush). No-op when nothing is pending.
    if (projectId !== GLOBAL_SCOPE) this.contentTracker.flushNow();
    // Snapshot the content epoch + dirty key BEFORE kicking materialization, so
    // the delivery-cursor seed and the dirty-clear guard both reference the exact
    // revision this session is about to capture. A content change that lands while
    // materialization is in flight bumps the epoch past `capturedContentEpoch`, so
    // it still surfaces as a note on a later send (and supersedes the run via the
    // revision key rather than being silently absorbed).
    const capturedContentEpoch =
      projectId === GLOBAL_SCOPE ? 0 : this.contentTracker.getEpoch(projectId);
    const capturedDirtyKey =
      projectId === GLOBAL_SCOPE ? undefined : this.contextDirtySignatures.get(projectId);
    const contextReady =
      projectId === GLOBAL_SCOPE
        ? undefined
        : this.beginContextMaterialization(
            projectId,
            cwd,
            undefined,
            this.currentContextRevisionKey(projectId)
          );

    const descriptor = this.resolveDescriptor(resolvedId);

    this.pendingCreates++;
    this.startingBackendId = resolvedId;
    this.notify();

    let backend: BackendProcess;
    try {
      backend = await this.ensureBackend(resolvedId, descriptor);
    } catch (err) {
      this.setLastError(err2String(err));
      this.finishPendingCreate();
      throw err;
    }

    if (this.disposed) {
      this.finishPendingCreate();
      throw new Error("AgentSessionManager was shut down during session creation");
    }

    // An absent preference means "Agent default": let session/new report the
    // backend's actual selection. Catalog ordering describes choices, not a
    // default, so only explicit transient or persisted selections are applied.
    const resolvedSeed = seedSelection ?? this.getDefaultSelection(resolvedId) ?? undefined;

    // A new chat must always start from a brand-new backend session. When a
    // warm preload probe is available we reuse its already-spawned and
    // initialize-handshaken subprocess (the expensive part), but never its
    // *session*: opencode persists its probe session id and resumes it from
    // disk on the next preload, so adopting that session as the chat would
    // replay the previous conversation's transcript and auto-title into a
    // supposedly fresh chat. `AgentSession.start` runs `newSession` on the
    // (warm or cold) proc at the resolved scope cwd, threading the project
    // scope + context roots.
    const internalId = uuidv4();
    const resolvedChatInputId = chatInputId ?? uuidv4();
    const session = AgentSession.start({
      backend,
      cwd,
      internalId,
      chatInputId: resolvedChatInputId,
      backendId: resolvedId,
      projectId,
      defaultModelSelection: resolvedSeed,
      getDescriptor: () => this.opts.resolveDescriptor(resolvedId),
      runFanoutTurn: (input) => this.runFanoutTurn(input),
      getDisplayName: (backendId) => this.resolveDescriptor(backendId).displayName,
      getApp: () => this.app,
      contextReady,
      // Project sessions only — leaving these absent keeps a GLOBAL session's
      // turn path byte-identical to before this feature (no hook, no note).
      ...(projectId !== GLOBAL_SCOPE
        ? {
            getProjectContextUpdates: () => this.getProjectContextUpdates(internalId, projectId),
            markProjectContextUpdatesDelivered: (epoch: number) =>
              this.markProjectContextUpdatesDelivered(internalId, epoch),
          }
        : {}),
    });
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
    // Record what this project landing captured so re-entry can tell a current
    // landing from one that baked in stale config (incl. a System-Prompt-only
    // edit the materialization dirty flag ignores). Global sessions capture no
    // project config, so they get no entry (and are never reused as landings).
    if (landingCaptureSignature) {
      this.landingCaptureSignatures.set(session.internalId, landingCaptureSignature);
    } else {
      this.landingCaptureSignatures.delete(session.internalId);
    }
    // A fresh id is never detached; clear defensively so a new session can't
    // inherit a stale hidden-from-strip flag.
    this.detachedFromTabIds.delete(session.internalId);
    // Always the scope's newest MRU. But only steal the global active pointer
    // when this session's scope is still the current one — a slow auto-spawn or
    // a restart that replaces a *background* tab must not yank the user out of a
    // scope they've since switched to (preserves `active.projectId ===
    // activeProjectId`).
    this.lastActiveByScope.set(projectId, session.internalId);
    if (projectId === this.activeProjectId) {
      this.activeSessionId = session.internalId;
    }
    this.attachAutoSave(session);
    this.attachAttentionTracking(session);
    this.notify();

    // Seed the delivery cursor as soon as the project's context is MATERIALIZED —
    // before the session becomes sendable (which only happens once `initialize`
    // opens the backend session, after `contextReady` resolves). Piggybacking on
    // `session.ready` instead would leave a window during the post-`newSession`
    // `confirmSeededSelection` await where a first send could emit a redundant note.
    // Only acts while this exact session is still pooled, and never regresses a
    // higher already-acked epoch. (The dirty CLEAR stays on `session.ready` below —
    // a failed backend startup must leave the project dirty so a re-entry re-spawns.)
    if (contextReady) {
      void contextReady
        .then((result) => {
          if (this.disposed || this.sessions.get(internalId) !== session) return;
          if (result.contextSignature === undefined) return;
          const seen = this.lastSeenProjectContentEpochBySession.get(internalId);
          if (seen === undefined || capturedContentEpoch > seen) {
            this.lastSeenProjectContentEpochBySession.set(internalId, capturedContentEpoch);
          }
        })
        .catch(() => {});
    }

    // Once the ACP session is ready, apply backend-specific persisted state
    // (claude's effort, future config-option preferences) and clear the
    // "starting" pill. On failure, capture into `lastError` so the status
    // surface and retry handler can react. The session itself transitions to
    // status "error" inside its own `initialize`. For warm-adopted sessions
    // `ready` is already resolved, so the chain runs on the next microtask.
    void session.ready
      .then(async () => {
        // Reaching here means the session is fully ready — it captured its context
        // and opened its backend session (a failed startup rejects into `.catch` and
        // never runs this, so the project stays dirty and a re-entry re-spawns).
        // Clear the dirty flag FIRST, before any optional backend config that could
        // hang and stall `finishPendingCreate`. Clear only when the captured dirty
        // key still matches (a newer edit/content bump superseded it — lost-update
        // guard) and the materializer captured a signature (a failed materialize
        // carries none). The cursor SEED already ran off `contextReady` above.
        if (contextReady) {
          const result = await contextReady;
          if (
            !this.disposed &&
            this.sessions.get(internalId) === session &&
            result.contextSignature !== undefined
          ) {
            this.clearContextDirtyIfCaptured(projectId, capturedDirtyKey, result.contextSignature);
          }
        }
        if (descriptor.applyInitialSessionConfig) {
          try {
            await descriptor.applyInitialSessionConfig(session, getSettings(), resolvedSeed);
          } catch (e) {
            logWarn(
              `[AgentMode] applyInitialSessionConfig failed for ${resolvedId}; continuing`,
              e
            );
          }
        }
        // Only clear when nothing failed while this session was starting — a concurrent
        // create's failure must stay on the status surface.
        if (this.lastErrorSeq === errorSeqAtStart) {
          this.lastError = null;
        }
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
        this.setLastError(err2String(err));
      })
      .finally(() => this.finishPendingCreate());

    return session;
  }

  /** Create a fresh global session with reviewable, unsent composer text. */
  async createGlobalSessionWithDraft(initialDraft: string): Promise<AgentSession> {
    const projectId = GLOBAL_SCOPE;
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);
    const chatInputId = uuidv4();
    this.composerHandoffByChatInputId.set(chatInputId, { text: initialDraft, submit: false });
    try {
      return await this.createSession(undefined, projectId, undefined, chatInputId);
    } catch (error) {
      this.composerHandoffByChatInputId.delete(chatInputId);
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw error;
    }
  }

  /**
   * Start a chat in the active scope that sends `prompt` as its next turn, for
   * command-palette actions that hand work to the agent. An active chat with
   * no messages yet takes the prompt itself so the action does not leave a
   * blank tab behind; any other active chat keeps running untouched in its
   * own tab. https://github.com/Brevilabs/obsidian-copilot-private/issues/357
   * @param prompt - The complete user prompt to send.
   */
  async createSessionWithPrompt(prompt: string): Promise<AgentSession> {
    const handoff: ComposerHandoff = { text: prompt, submit: true };
    const active = this.getActiveSession();
    // Reuse only an empty chat that can still send. A startup failure leaves
    // the session active, empty, and permanently unable to open a backend
    // session, so reusing it would flush the prompt into a dead chat instead
    // of the promised new one.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/357
    const activeStatus = active?.getStatus();
    if (
      active &&
      active.projectId === this.activeProjectId &&
      (activeStatus === "idle" || activeStatus === "starting") &&
      !active.hasUserVisibleMessages()
    ) {
      this.composerHandoffByChatInputId.set(active.chatInputId, handoff);
      // This composer is already mounted; the shell re-reads handoffs on the
      // re-render this notification triggers.
      this.notify();
      return active;
    }
    const chatInputId = uuidv4();
    this.composerHandoffByChatInputId.set(chatInputId, handoff);
    try {
      return await this.createSession(undefined, this.activeProjectId, undefined, chatInputId);
    } catch (error) {
      this.composerHandoffByChatInputId.delete(chatInputId);
      throw error;
    }
  }

  /** Return and remove the handoff bound to one logical composer. */
  consumeComposerHandoff(chatInputId: string): ComposerHandoff | undefined {
    const handoff = this.composerHandoffByChatInputId.get(chatInputId);
    this.composerHandoffByChatInputId.delete(chatInputId);
    return handoff;
  }

  /** Record a failure for the status surface, advancing the failure sequence. */
  private setLastError(message: string): void {
    this.lastError = message;
    this.lastErrorSeq++;
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

  /**
   * Absolute cwd for a session in `projectId`'s scope. Single source of truth
   * for every session-construction site. Throws on a non-desktop adapter or an
   * orphaned project (missing record) — the latter must never silently fall
   * back to the vault root.
   */
  private resolveSessionCwd(projectId: ProjectScopeId): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    return resolveScopeCwd(adapter.getBasePath(), projectId);
  }

  /**
   * Start (but do NOT await) materializing a project's context, returning a
   * promise of the extra searchable roots. Caller has already done config
   * migration + cwd resolution, so the materializer sees the post-migration
   * record and resolved cwd. Only ever invoked for a non-global scope.
   *
   * Publishes the blocking load state SYNCHRONOUSLY (before the session even
   * appears) so the composer gates send the instant the tab renders, then flips
   * to `done`/`error` and stores the result for the session once the materializer
   * settles. NEVER rejects — failure degrades to an empty
   * result so the session's `newSession` (which awaits this) is never blocked.
   *
   * Resolves the full {@link ContextMaterializationResult} (searchable roots +
   * the optional inline `<project_context>` block); the session captures both
   * before opening. Progress/counts are NOT carried here — they publish
   * separately via {@link agentProjectContextLoadAtom}.
   */
  private beginContextMaterialization(
    projectId: ProjectScopeId,
    cwd: string,
    forceRetryFailed?: boolean,
    revisionKey?: string
  ): Promise<ContextMaterializationResult> {
    // Accumulate counts so every publish carries the latest of all three steps
    // (resolve / prefetch / parse), not just the one that fired last.
    const counts: {
      resolved?: number;
      prefetch?: ContextLoadStepCount;
      parsed?: ContextLoadStepCount;
    } = {};
    // Per-source state mirroring the legacy CAG tracker: `processingSources` is
    // the live "in flight" set, `failedSources` accrues settled failures. Both
    // publish incrementally so the popover renders a true queue; the materializer
    // sends a final `failures` list that reconciles `failedSources` at the end.
    let failedSources: FailedItem[] = [];
    let processingSources: AgentInFlightSource[] = [];
    // The latest step phase, so item-lifecycle publishes (which carry no phase of
    // their own) keep the loading card on the current step.
    let stepPhase: "resolve" | "prefetch" | "parse" = "resolve";

    // Own the atom only when no concurrent run is already driving it. The
    // materializer single-flights, so a second caller would otherwise (a) seed a
    // count-less "resolve" over the owner's live counts and (b) publish a
    // count-less terminal "done" during the owner's linger window. Letting only
    // the flight owner publish keeps the projectId-keyed atom coherent.
    const prior = settingsStore.get(agentProjectContextLoadAtom)[projectId];
    const ownsPublish = !prior?.blocking;

    // Seed the blocking state synchronously (before the session even appears) so
    // the composer gates send the instant the tab renders.
    if (ownsPublish) {
      this.setContextLoadState(projectId, { phase: "resolve", blocking: true });
    }

    // Re-emit the running state with the current counts + per-source sets. Empty
    // `processingSources` publishes as `undefined` (the adapter falls back to a
    // frozen empty), matching the `retryingSources` referential-stability pattern.
    const publishProgress = () => {
      this.setContextLoadState(projectId, {
        phase: stepPhase,
        blocking: true,
        ...counts,
        failedSources,
        processingSources: processingSources.length > 0 ? processingSources : undefined,
      });
    };

    const onProgress = ownsPublish
      ? (progress: ContextMaterializeProgress) => {
          switch (progress.phase) {
            case "failures":
              // Final reconciliation of the run's failures (data-only; the
              // terminal `done` publish carries the authoritative list).
              failedSources = progress.failures.map(toFailedItem);
              return;
            case "itemStart":
              processingSources = addProcessingSource(processingSources, progress.item);
              failedSources = failedSources.filter((f) => !failedItemIsSource(f, progress.item));
              publishProgress();
              return;
            case "itemFailed":
              processingSources = removeProcessingSource(processingSources, progress.item);
              failedSources = upsertFailedItem(failedSources, toFailedItem(progress.failure));
              publishProgress();
              return;
            case "itemSettled":
              processingSources = removeProcessingSource(processingSources, progress.item);
              publishProgress();
              return;
            case "resolve":
              counts.resolved = progress.resolved;
              stepPhase = "resolve";
              publishProgress();
              return;
            case "prefetch":
              counts.prefetch = { done: progress.done, total: progress.total };
              stepPhase = "prefetch";
              publishProgress();
              return;
            case "parse":
              counts.parsed = { done: progress.done, total: progress.total };
              stepPhase = "parse";
              publishProgress();
              return;
          }
        }
      : undefined;

    return ensureProjectContextMaterialized(
      this.app,
      projectId,
      cwd,
      onProgress,
      forceRetryFailed,
      revisionKey
    )
      .then((ctx) => {
        if (ownsPublish) {
          // Always carry `failedSources` (empty when clean) so a prior run's
          // failures never linger; the run is done, so nothing is processing.
          this.setContextLoadState(projectId, {
            phase: "done",
            blocking: false,
            ...counts,
            failedSources,
          });
        }
        return ctx;
      })
      .catch((err) => {
        // The materializer's contract is never-reject; this guards a contract
        // breach. Publish as a completed run with a single synthetic failure
        // (not a distinct error phase — there is no "whole context" failure state).
        logWarn(`[AgentMode] project context materialize failed for ${projectId}; continuing`, err);
        if (ownsPublish) {
          this.setContextLoadState(projectId, {
            phase: "done",
            blocking: false,
            failedSources: [{ path: "Project context", type: "nonMd", error: err2String(err) }],
          });
        }
        return EMPTY_CONTEXT_MATERIALIZATION_RESULT;
      });
  }

  /** Publish a project's context-load state to the projectId-keyed atom. */
  private setContextLoadState(projectId: string, state: AgentProjectContextLoadState): void {
    settingsStore.set(agentProjectContextLoadAtom, (prev) => ({ ...prev, [projectId]: state }));
  }

  /**
   * Re-run a project's context materialization on demand — the status popover's
   * "Retry" action. Fire-and-forget: progress/failures republish through
   * {@link agentProjectContextLoadAtom} exactly like a session-create run. Passes
   * `forceRetryFailed` so known-bad sources are re-fetched instead of honoring
   * their persisted failure markers (the automatic path cheap-skips them). A
   * no-op for the global scope (no per-project context).
   *
   * Early-exits while a run already owns the load atom (`blocking`), mirroring
   * {@link rematerializeSource}: joining the in-flight session-create run would
   * let its cheap-skip swallow the force, so the user's Retry would do nothing.
   * Returns whether a real forced run started (so the caller can defer the
   * post-retry landing refresh).
   */
  rematerializeContext(projectId: ProjectScopeId): boolean {
    if (projectId === GLOBAL_SCOPE) return false;
    // A session-create run owns the atom while blocking; don't fold the force in.
    if (settingsStore.get(agentProjectContextLoadAtom)[projectId]?.blocking) return false;
    let cwd: string;
    try {
      cwd = this.resolveSessionCwd(projectId);
    } catch (err) {
      // Off-desktop (no FileSystemAdapter): surface as a completed run with a
      // single synthetic failure, mirroring the materializer's fatal path.
      this.setContextLoadState(projectId, {
        phase: "done",
        blocking: false,
        failedSources: [{ path: "Project context", type: "nonMd", error: err2String(err) }],
      });
      return false;
    }
    // Start the forced pass SYNCHRONOUSLY so it claims the materializer's
    // single-flight slot before this returns: a background warm (a source edit)
    // runs through that guard without owning the blocking atom, so the check
    // above can't see it — but the forced run supersedes it (see
    // {@link ensureProjectContextMaterialized}), and any landing refresh the
    // returned `true` triggers then joins THIS forced run, not the stale warm.
    void this.beginContextMaterialization(
      projectId,
      cwd,
      true,
      this.currentContextRevisionKey(projectId)
    );
    // Reason: report whether a real run started so the caller can defer the
    // post-retry landing refresh (skipped for the no-op scopes above).
    return true;
  }

  /**
   * Re-materialize a SINGLE source on demand — the per-row "Retry" in the
   * Content Conversion panel. Ignored while a full run is in flight (the UI hides
   * Retry then, and the running pass already re-attempts every source). On
   * settle, drops this source's stale failure from the load atom — re-adding it
   * only if the retry failed again — so the panel reflects the new outcome
   * without a whole-project re-run. A no-op for the global scope.
   *
   * Returns whether a retry actually ran to completion — `false` when it was
   * skipped (global scope, a full run owns the atom, or this source is already
   * retrying), so the caller can avoid a premature post-retry refresh.
   */
  async rematerializeSource(
    projectId: ProjectScopeId,
    item: { kind: MaterializedSourceType; source: string }
  ): Promise<boolean> {
    if (projectId === GLOBAL_SCOPE) return false;
    const before = settingsStore.get(agentProjectContextLoadAtom)[projectId];
    // A full run owns the atom while blocking; don't race it.
    if (before?.blocking) return false;

    const matchesItem = (f: FailedItem) =>
      f.path === item.source && (item.kind === "file" ? f.type === "nonMd" : f.type === item.kind);
    const sameSource = (r: { kind: MaterializedSourceType; source: string }) =>
      r.kind === item.kind && r.source === item.source;

    // Single-flight per source: if this source's retry is already in flight, a
    // second click would fire a duplicate materialize and let the first finisher
    // clear the spinner early — so bail rather than re-fire.
    const beforeRetrying = before?.retryingSources ?? [];
    if (beforeRetrying.some(sameSource)) return false;

    // Optimistically mark this source as retrying so its row flips to a spinner
    // immediately — the click has visible feedback even if the retry fails again.
    // Drop its stale failure now; re-add below only if the retry fails.
    this.setContextLoadState(projectId, {
      ...(before ?? { phase: "done" as const }),
      blocking: false,
      failedSources: (before?.failedSources ?? []).filter((f) => !matchesItem(f)),
      retryingSources: [...beforeRetrying, item],
    });

    // The single-source retry serializes with any in-flight full run on the
    // shared per-artifact lock (keyed by snapshot file name), and shared snapshots
    // are never reconciled — so a concurrent warm can no longer reap the snapshot
    // this Retry writes. No pre-join is needed.
    const failures = await materializeProjectContextSource(this.app, projectId, item);

    const prev = settingsStore.get(agentProjectContextLoadAtom)[projectId];
    // A full run may have started during our await — it now owns the atom. Bail
    // so we don't clobber its `blocking` send-gate / progress with a stale write.
    if (prev?.blocking) return false;
    const others = (prev?.failedSources ?? []).filter((f) => !matchesItem(f));
    const remainingRetrying = (prev?.retryingSources ?? []).filter((r) => !sameSource(r));
    this.setContextLoadState(projectId, {
      ...(prev ?? { phase: "done" as const }),
      blocking: false,
      retryingSources: remainingRetrying.length > 0 ? remainingRetrying : undefined,
      failedSources: [...others, ...failures.map(toFailedItem)],
    });
    return true;
  }

  /** The scope the active session belongs to ({@link GLOBAL_SCOPE} or a project id). */
  getActiveProjectId(): ProjectScopeId {
    return this.activeProjectId;
  }

  /**
   * Sessions belonging to `projectId`, in tab order. Feeds the scoped tab strip.
   * Distinct from {@link getSessions} (which stays full-set for draft-prune /
   * auto-spawn). Returns a shared frozen empty array when the scope has none.
   */
  getSessionsForScope(projectId: ProjectScopeId): AgentSession[] {
    const scoped: AgentSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (this.detachedFromTabIds.has(session.internalId)) continue;
      scoped.push(session);
    }
    return scoped.length === 0 ? EMPTY_SESSIONS : scoped;
  }

  /** Session ids belonging to `projectId`, in tab order. */
  private getSessionIdsForScope(projectId: ProjectScopeId): string[] {
    const ids: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (this.detachedFromTabIds.has(session.internalId)) continue;
      ids.push(session.internalId);
    }
    return ids;
  }

  /**
   * Switch the active scope to `projectId` and surface one of its sessions:
   * its MRU (if still alive) → any existing session in the scope → a freshly
   * auto-spawned one. Orphaned ids (project deleted) show a Notice and are
   * rejected without touching the active scope or cwd (no recovery UI yet).
   * `exitProject` is just re-entering {@link GLOBAL_SCOPE}.
   */
  async enterProject(projectId: ProjectScopeId): Promise<void> {
    if (this.disposed) return;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice("This project no longer exists. Restore it to open its chats.");
      return;
    }
    // Already here with a live in-scope session — nothing to restore.
    const current = this.getActiveSession();
    if (
      projectId === this.activeProjectId &&
      current &&
      current.projectId === projectId &&
      current.getStatus() !== "closed"
    ) {
      return;
    }

    // Snapshot the scope this entry replaces BEFORE the optimistic switch, so a
    // rejected auto-spawn below can restore it (see `spawnEnteredScopeOrRollback`).
    const previousActiveProjectId = this.activeProjectId;
    const previousActiveSessionId = this.activeSessionId;
    const scopeSeq = this.setActiveScope(projectId);

    // A project scope opens as a FRESH visit: its prior conversational chats
    // move to chat history (detached from the tab strip — not closed, so a
    // backgrounded turn keeps running and stays visible via the history row's
    // spinner/done-dot). A never-used empty landing tab is reused instead of
    // stacking a new blank tab on every visit. The global workspace keeps its
    // restore-the-last-tab behavior (it's the implicit scope `exitProject`
    // returns to, not a project the user deliberately re-opens).
    if (projectId !== GLOBAL_SCOPE) {
      // Settle any queued vault events NOW so the reuse decision below sees a file
      // the user edited moments ago (within the tracker's debounce window). Without
      // this, an edit-then-immediately-reopen would read `dirty=false` and reuse the
      // stale empty landing — violating "don't reuse a stale empty landing".
      this.contentTracker.flushNow();
      // Reuse an empty landing only when it's safe: not dirty (its
      // `<project_context>` would be stale — materialization-only, see
      // `contextDirtySignatures`) AND its creation-time capture still matches the
      // live project config (`pickReusableLandingSession` checks the
      // landing-capture signature, which also covers a System-Prompt-only edit the
      // dirty flag ignores). When we instead spawn fresh, detach the project's
      // empty landings too so a stale blank one can't linger in the strip; when we
      // reuse, leave them so the adopted tab survives.
      const dirty = this.isProjectContextDirty(projectId);
      const reusable = dirty ? null : this.pickReusableLandingSession(projectId);
      this.detachSessionsForProjectEntry(projectId, { includeEmpty: !reusable });
      if (reusable) {
        this.detachedFromTabIds.delete(reusable.internalId);
        this.activeSessionId = reusable.internalId;
        this.lastActiveByScope.set(projectId, reusable.internalId);
        reusable.clearNeedsAttention();
        this.notify();
        this.touchProjectUsage(projectId);
        return;
      }
      this.activeSessionId = null;
      this.notify();
      await this.spawnEnteredScopeOrRollback(
        previousActiveProjectId,
        previousActiveSessionId,
        scopeSeq
      );
      this.touchProjectUsage(projectId);
      return;
    }

    const restored = this.restoreScopeActiveSession(projectId);
    if (restored) {
      this.activeSessionId = restored.internalId;
      this.lastActiveByScope.set(projectId, restored.internalId);
      restored.clearNeedsAttention();
      this.notify();
      this.touchProjectUsage(projectId);
      return;
    }

    // No reusable session in this scope — drop the stale cross-scope pointer
    // (keeps the `active.projectId === activeProjectId` invariant) and spawn.
    this.activeSessionId = null;
    this.notify();
    await this.getOrCreateActiveSession();
    // Reason: count as a "use" only after the spawn resolves — a failed spawn
    // (await throws) must not bump MRU.
    this.touchProjectUsage(projectId);
  }

  /**
   * Detach a project scope's prior tabs on re-entry — they stay live in the pool
   * and listed in chat history. Conversational chats (with user-visible
   * messages) always detach. Empty landing tabs detach only when
   * `includeEmpty` is set (the caller is spawning a fresh session, so any
   * existing empty landing is stale/unusable and must not linger in the strip);
   * otherwise they're left attached so the reused one stays the visit's tab (see
   * {@link pickReusableLandingSession}).
   *
   * DESIGN NOTE — detached sessions are deliberately kept ALIVE (a backgrounded
   * turn keeps running; the history row shows its spinner/done-dot) and are NOT
   * evicted here, so repeated project re-entry accumulates idle detached sessions
   * for the app's lifetime. Bounding the idle-detached class — an LRU cap that
   * never evicts running/awaiting sessions — needs a per-session backend close
   * primitive the backends don't expose yet, so it is out of scope for the
   * project-workspace landing. Known limitation, deliberately deferred
   * (obsidian-copilot-preview#164; the missing close primitive is
   * obsidian-copilot-preview#178). If a future review flags this again, point
   * them here.
   */
  private detachSessionsForProjectEntry(
    projectId: ProjectScopeId,
    opts: { includeEmpty: boolean }
  ): void {
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (session.getStatus() === "closed") continue;
      if (!opts.includeEmpty && !session.hasUserVisibleMessages()) continue;
      this.detachedFromTabIds.add(session.internalId);
    }
  }

  /**
   * The scope's reusable empty landing tab — a live, never-messaged session that
   * a fresh visit can adopt instead of spawning a new blank one. A candidate must
   * also have captured the CURRENT project config (matching landing-capture
   * signature); one that baked in stale config is skipped. Prefers the scope's
   * MRU; falls back to the most recent matching session. `null` means the caller
   * should spawn fresh.
   *
   * A DETACHED landing is never reusable: it was pushed out of the strip because a
   * fresh visit spawned past it (e.g. it was content-dirty at the time), so its
   * captured `<project_context>` may predate a change the landing-capture signature
   * — which tracks config, not file contents — cannot see. Re-adopting it would
   * violate "don't reuse a stale empty landing"; spawn fresh instead.
   */
  private pickReusableLandingSession(projectId: ProjectScopeId): AgentSession | null {
    const expected = this.currentLandingCaptureSignature(projectId);
    // An unverifiable signature (instruction file outside the vault cache) cannot prove the
    // candidate still matches the scope's instructions, so spawn fresh rather than hand back
    // a backend that may have read the file before the user's last edit.
    if (!expected || !landingCaptureIsVerifiable(expected)) return null;
    const isReusable = (session: AgentSession): boolean =>
      this.isReusableLandingShell(session, projectId) &&
      !this.detachedFromTabIds.has(session.internalId) &&
      this.landingCaptureSignatures.get(session.internalId) === expected;

    const mruId = this.lastActiveByScope.get(projectId);
    const mru = mruId ? this.sessions.get(mruId) : undefined;
    if (mru && isReusable(mru)) return mru;

    let fallback: AgentSession | null = null;
    for (const session of this.sessions.values()) {
      if (isReusable(session)) fallback = session;
    }
    return fallback;
  }

  /**
   * Whether a session is a clean slate to adopt as a landing — idle/starting and
   * never messaged. An "error" landing (backend never opened) or one mid-turn
   * ("running"/"awaiting_permission") is not, so the caller should spawn fresh.
   * This is the shell check ONLY; capture-freshness is gated separately.
   */
  private isReusableLandingShell(session: AgentSession, projectId: ProjectScopeId): boolean {
    return (
      session.projectId === projectId &&
      (session.getStatus() === "idle" || session.getStatus() === "starting") &&
      !session.hasUserVisibleMessages()
    );
  }

  /** The live project record's landing-capture signature, or null off-project. */
  private currentLandingCaptureSignature(projectId: ProjectScopeId): string | null {
    if (projectId === GLOBAL_SCOPE) return null;
    const record = getCachedProjectRecordById(projectId);
    return record ? getProjectLandingCaptureSignature(this.app, record) : null;
  }

  /**
   * Initialize the scope's canonical instruction files so the backend discovers them from
   * cwd. Neither scope invents instructions: the vault file only ever gains its Claude
   * import next to an AGENTS.md the user wrote themselves, and a project only materializes
   * one when it has legacy `project.md` prompt text to move there. Best-effort — never
   * rejects.
   */
  private async ensureScopeInstructions(
    projectId: ProjectScopeId,
    record: ProjectFileRecord | undefined
  ): Promise<void> {
    if (projectId === GLOBAL_SCOPE) {
      await ensureAgentsFileForDiscovery(this.app, "", "");
      return;
    }
    if (!record) return;
    // The vault-root ensure runs for project scope too: Claude only sees a root AGENTS.md
    // through the sibling CLAUDE.md import, and a user who hand-created the root file gets
    // that import written on their FIRST session, not just a global one. Creates nothing
    // when no root AGENTS.md exists.
    await ensureAgentsFileForDiscovery(this.app, "", "");
    await moveProjectPromptToAgentsFile(this.app, record);
    // Anchored on the record's own path, matching `resolveScopeCwd`: the folder the agent
    // will actually open is `dirname(record.filePath)`, which is not the live projects root
    // for the moment after a Copilot-folder change.
    await ensureAgentsFileForDiscovery(
      this.app,
      getProjectAnchorFromConfigPath(record.filePath).projectFolderPath,
      ""
    );
  }

  /**
   * Record a successful enter of `projectId` as its most-recent use. Skips
   * {@link GLOBAL_SCOPE}
   * (the implicit workspace `exitProject` returns to) and any scope that is no
   * longer current — the spawn-path caller touches after an `await`, so a
   * concurrent `enterProject` may have moved the active scope on in the meantime.
   */
  private touchProjectUsage(projectId: ProjectScopeId): void {
    // Reason: the spawn path touches after `await getOrCreateActiveSession()`;
    // if the user switched scopes (or we were disposed) during that await, the
    // project they LEFT must not be bumped to MRU top. Only credit the scope
    // we're actually still in. The restored path passes trivially — there
    // `activeProjectId` already equals `projectId` when this is called.
    if (this.disposed || projectId === GLOBAL_SCOPE || this.activeProjectId !== projectId) return;
    // Reason: MRU feedback only — fire-and-forget so the throttled frontmatter
    // write never blocks the scope switch; touchProjectLastUsed logs+swallows
    // its own failures.
    void ProjectFileManager.getInstance(this.app).touchProjectLastUsed(projectId);
  }

  /** Leave the current project and return to the global workspace. */
  async exitProject(): Promise<void> {
    await this.enterProject(GLOBAL_SCOPE);
  }

  /** Record the current active session as its scope's MRU before a scope switch. */
  private parkActiveScope(): void {
    const active = this.getActiveSession();
    if (active && active.getStatus() !== "closed") {
      this.lastActiveByScope.set(active.projectId, active.internalId);
    }
  }

  /**
   * Pick the session to surface when entering `projectId`: its recorded MRU if
   * still alive, else the last existing session in the scope. `null` means the
   * scope is empty and the caller should auto-spawn.
   */
  private restoreScopeActiveSession(projectId: ProjectScopeId): AgentSession | null {
    const mruId = this.lastActiveByScope.get(projectId);
    if (mruId) {
      const mru = this.sessions.get(mruId);
      if (mru && mru.getStatus() !== "closed") return mru;
    }
    const scoped = this.getSessionsForScope(projectId);
    return scoped.length > 0 ? scoped[scoped.length - 1] : null;
  }

  /**
   * Park the current scope and point `activeProjectId` at `projectId` without
   * restoring/spawning a session — used by history load, which creates the
   * specific saved session itself right after.
   */
  private setActiveScope(projectId: ProjectScopeId): number {
    if (projectId === this.activeProjectId) return this.scopeSeq;
    this.parkActiveScope();
    this.activeProjectId = projectId;
    return ++this.scopeSeq;
  }

  /**
   * Undo a scope switch that precedes a specific session create/resume when that
   * operation rejects. Only roll back if we're still parked in the attempted
   * scope — a concurrent scope switch means the user has moved on, and forcing
   * them back would reintroduce the race `createSession`'s activation guard avoids.
   */
  private rollbackOptimisticScopeSwitch(
    previousProjectId: ProjectScopeId,
    attemptedScopeVersion: number
  ): void {
    if (this.scopeSeq === attemptedScopeVersion) {
      this.activeProjectId = previousProjectId;
      this.scopeSeq++;
      this.notify();
    }
  }

  /**
   * Auto-spawn a just-entered project scope's first session, undoing the
   * optimistic scope switch if the spawn rejects (e.g. a missing backend binary).
   * By this point `enterProject` has parked the prior scope, pointed
   * `activeProjectId` at the new scope, detached the new scope's tabs, and nulled
   * `activeSessionId`. The callers only surface a Notice, so without this a
   * rejected spawn would strand the manager in a project scope with no active
   * chat. Restores the previous scope's `activeProjectId` + active-session pointer
   * and re-notifies, then rethrows so the caller still reports the failure.
   *
   * Guarded by the attempted switch's version: concurrent navigation during
   * the awaited spawn means the user moved on, and forcing them back would
   * clobber that newer switch (mirrors
   * {@link rollbackOptimisticScopeSwitch}). The detached tabs are intentionally left
   * detached — they belong to the project we failed to enter, are invisible from
   * the restored scope, and a later successful entry re-detaches them anyway as a
   * fresh visit.
   */
  private async spawnEnteredScopeOrRollback(
    previousProjectId: ProjectScopeId,
    previousActiveSessionId: string | null,
    attemptedScopeVersion: number
  ): Promise<void> {
    try {
      await this.getOrCreateActiveSession();
    } catch (err) {
      if (this.scopeSeq === attemptedScopeVersion) {
        this.activeProjectId = previousProjectId;
        this.scopeSeq++;
        this.activeSessionId = previousActiveSessionId;
        this.notify();
      }
      throw err;
    }
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
   * A chat-side model switch is transient: it mutates only the active
   * session. The durable per-backend default is written exclusively by the
   * settings picker (`persistDefaultSelection`), so a one-off chat pick no
   * longer drifts the default.
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
  }

  /**
   * Apply a canonical mode change against the active session. `spec` carries
   * the translated native dispatch info (which ACP RPC + payload). A descriptor
   * whose mapping does not depend on live backend state gets one final lookup
   * here so settings changes made after the picker rendered take effect on the
   * click. After a successful apply, `mode` becomes the backend's sticky default
   * so the next new conversation reopens in it — symmetric with `applySelection`.
   * If the apply throws, no persistence occurs.
   *
   * @param backendId Backend expected to own the active session.
   * @param mode Canonical mode selected in the picker.
   * @param spec Translated fallback for mappings that require live backend state.
   */
  async applyMode(backendId: BackendId, mode: CopilotMode, spec: ModeApplySpec): Promise<void> {
    const session = this.getActiveSession();
    if (!session || session.backendId !== backendId) return;
    const latestMapping = this.resolveDescriptor(backendId).getModeMapping?.(null, null);
    const latestNativeId =
      latestMapping?.kind === "setMode" ? latestMapping.canonical[mode] : undefined;
    const resolvedSpec: ModeApplySpec = latestNativeId
      ? { kind: "setMode", nativeId: latestNativeId }
      : spec;
    if (resolvedSpec.kind === "setMode") {
      await session.setMode(resolvedSpec.nativeId);
    } else {
      await session.setConfigOption(resolvedSpec.configId, resolvedSpec.value);
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
   * skill discovery and deny rules, is rebuilt from current settings. By
   * default a busy backend waits until it is idle; privacy-boundary callers can
   * disable that deferral and cancel the active turn.
   *
   * When the manager owns no process yet, a warm probe held by the preloader
   * may still carry the pre-change spawn config; we refresh it instead (see
   * `refreshWarmProbe`) so the first chat-open doesn't adopt a stale proc.
   *
   * Returns `true` when a running backend was restarted, a restart was
   * scheduled, or a warm probe was refreshed; `false` when nothing exists yet.
   *
   * @param backendId Backend process whose spawn-time state is stale.
   * @param reason Diagnostic reason recorded for the restart.
   * @param options Whether a busy turn may delay the restart.
   */
  async restartBackend(
    backendId: BackendId,
    reason: string,
    options?: { deferWhileBusy?: boolean }
  ): Promise<boolean> {
    if (this.disposed) return false;
    const inflight = this.starting.get(backendId);
    if (inflight) {
      await inflight.catch(() => undefined);
    }
    const backend = this.backends.get(backendId);
    if (!backend) return this.refreshWarmProbe(backendId, reason);
    // Most config changes preserve the current turn. A Search scope change may
    // opt out so no later tool call uses the prior privacy boundary.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
    if (options?.deferWhileBusy !== false && this.hasBusySession(backendId)) {
      const prev = this.pendingBackendRestarts.get(backendId);
      this.pendingBackendRestarts.set(backendId, {
        reason: prev ? `${prev.reason}; ${reason}` : reason,
        immediate: prev?.immediate ?? false,
      });
      logInfo(`[AgentMode] deferred ${backendId} backend restart: ${reason}`);
      return true;
    }
    await this.restartBackendNow(backendId, reason, options?.deferWhileBusy === false);
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
    const installState = this.opts.resolveDescriptor(backendId)?.getInstallState(getSettings());
    // Compatibility probes publish a transient checking state before their
    // authoritative result. Keep live and warm processes intact until that
    // result says whether the configured runtime is actually usable.
    if (installState?.kind === "checking") return;
    if (installState?.kind !== "ready") {
      // Tears down a live proc (the install guard in `restartBackendNow` keeps
      // it from respawning); `clearCached` then drops any warm probe.
      await this.restartBackend(backendId, "binary no longer available");
      this.preloader.clearCached(backendId);
      // An uninstalled backend must vanish from the picker, so its settled
      // preload status can't keep vouching for enabled-model fallback rows.
      // Incompatible/error installs keep their status: their rows stay
      // visible so a pick routes the user to the Upgrade/Configure pill.
      if (!installState || installState.kind === "absent") {
        if (this.preloadStatus.delete(backendId)) this.notify();
      }
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

  /** Probe-owned model discovery shared across sessions for `backendId`. */
  getCachedModelCatalog(backendId: BackendId): BackendModelCatalog | null {
    return this.preloader.getCachedModelCatalog(backendId);
  }

  /**
   * Per-model effort options (baseModelId → options) discovered by the
   * preloader's post-catalog prefetch, or `null`. The picker reads this to show
   * effort steppers for models that aren't currently active.
   */
  getEffortCatalog(backendId: BackendId): Record<string, EffortOption[]> | null {
    return this.preloader.getEffortCatalog(backendId);
  }

  /** Subscribe to preloader cache updates. Used by the picker hook. */
  subscribeModelCache(listener: () => void): () => void {
    return this.preloader.subscribe(listener);
  }

  /**
   * Stable string that changes whenever anything a model picker reads for
   * `backendId` changes: preload status, the shared model catalog, and the
   * prefetched effort catalog. A `useSyncExternalStore` snapshot built only
   * from `getPreloadStatus` would miss the post-`"ready"` effort-catalog
   * prefetch (the snapshot stays `"ready"`, so React skips the rerender and
   * the Default effort dropdown never appears).
   */
  getModelCacheSignature(backendId: BackendId): string {
    const status = this.getPreloadStatus(backendId);
    const catalog = modelCatalogSignature(this.getCachedModelCatalog(backendId));
    const effort = this.getEffortCatalog(backendId);
    const effortSig = effort
      ? Object.keys(effort)
          .sort()
          .map((id) => `${id}:${effort[id].map((o) => o.value ?? "").join(",")}`)
          .join("|")
      : "";
    return `${status}#${catalog}#${effortSig}`;
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
    const closedScope = session.projectId;
    // Capture the closed tab's index WITHIN ITS SCOPE before delete so the
    // neighbour pick stays in-scope (never jumps the user to another project).
    const scopeIdsBefore = this.getSessionIdsForScope(closedScope);
    const closedIdx = scopeIdsBefore.indexOf(id);
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
    this.composerHandoffByChatInputId.delete(session.chatInputId);
    this.chatUIStates.delete(id);
    this.landingCaptureSignatures.delete(id);
    this.lastSeenProjectContentEpochBySession.delete(id);
    this.detachedFromTabIds.delete(id);
    // Drop the closed session from its scope's MRU so a later enter can't
    // resurrect a dead id.
    if (this.lastActiveByScope.get(closedScope) === id) {
      this.lastActiveByScope.delete(closedScope);
    }
    if (this.activeSessionId === id) {
      const scopeIdsAfter = this.getSessionIdsForScope(closedScope);
      const nextId = pickScopeNeighbor(
        scopeIdsAfter,
        closedIdx,
        this.lastActiveByScope.get(closedScope)
      );
      this.activeSessionId = nextId;
      if (nextId) this.lastActiveByScope.set(closedScope, nextId);
      // `activeProjectId` stays `closedScope` even when it's now empty — never
      // silently jump the active scope on close.
    }
    this.notify();
  }

  /**
   * Move the active pointer to `id`. No-op if `id` is unknown. When the target
   * lives in a different scope, the active scope follows it (cross-scope
   * auto-switch) so the `active.projectId === activeProjectId` invariant holds.
   * This is NOT a cancel path — the previously-active turn keeps running in the
   * background (D6 auto-park).
   */
  setActiveSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (this.activeSessionId === id) return;
    if (session.projectId !== this.activeProjectId) {
      this.setActiveScope(session.projectId);
    }
    // Surfacing a session (history open / tab click) re-attaches it to its
    // scope's tab strip if a prior project re-entry had detached it.
    this.detachedFromTabIds.delete(id);
    this.activeSessionId = id;
    this.lastActiveByScope.set(session.projectId, id);
    session.clearNeedsAttention();
    this.notify();
  }

  /**
   * Spawn a fresh session at `oldId`'s tab-strip position and close `oldId`
   * in the background. Used by the in-tab "New Chat" button so the
   * replacement chat takes the same slot the user was looking at instead of
   * appearing at the end of the strip (which made it look like focus had
   * jumped to a sibling tab). `backendId` defaults to the same fallback as
   * `createSession`. Set `preserveChatInput` only when the visible input remains
   * the same while its runtime session is replaced.
   */
  async replaceSessionInPlace(
    oldId: string,
    backendId?: BackendId,
    options: ReplaceSessionOptions = {}
  ): Promise<AgentSession> {
    const replacementKey = this.sessions.get(oldId)?.chatInputId ?? oldId;
    const cursor =
      this.replacementCursorByChatInputId.get(replacementKey) ?? Promise.resolve(oldId);
    const replacement = cursor.then((currentId) =>
      this.replaceSessionInPlaceOnce(currentId, backendId, options)
    );
    const nextCursor = replacement.then(
      (current) => current.internalId,
      () => cursor
    );
    this.replacementCursorByChatInputId.set(replacementKey, nextCursor);
    try {
      return await replacement;
    } finally {
      if (this.replacementCursorByChatInputId.get(replacementKey) === nextCursor) {
        this.replacementCursorByChatInputId.delete(replacementKey);
      }
    }
  }

  private async replaceSessionInPlaceOnce(
    oldId: string,
    backendId?: BackendId,
    options: ReplaceSessionOptions = {}
  ): Promise<AgentSession> {
    const oldIdx = Array.from(this.sessions.keys()).indexOf(oldId);
    // The replacement inherits the REPLACED session's scope, not the active
    // scope (they can differ if the old tab wasn't the active one).
    const replaced = this.sessions.get(oldId);
    const replacedProjectId = replaced?.projectId ?? this.activeProjectId;
    const chatInputId = options.preserveChatInput ? replaced?.chatInputId : undefined;
    const created = await this.createSession(
      backendId,
      replacedProjectId,
      options.seedSelection,
      chatInputId
    );
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

  /**
   * Live (non-closed) session matching BOTH `backendId` and the backend
   * `sessionId`. Matching the full identity at once — rather than finding the
   * first session by `sessionId` and checking the backend after — keeps an
   * (effectively impossible, UUID) cross-backend id collision from hiding the
   * correct already-open tab. Used by the native-history open/rename paths.
   */
  private findLiveSession(backendId: BackendId, sessionId: string): AgentSession | null {
    for (const session of this.sessions.values()) {
      if (session.backendId !== backendId) continue;
      if (session.getBackendSessionId() !== sessionId) continue;
      if (session.getStatus() === "closed") continue;
      return session;
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
   * label changed, backend exit, isStarting/lastError flips). Also fires when a
   * session enters or leaves `running` (so the recent-list spinner can follow).
   * Returns an unsubscribe function. Listeners must not throw.
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
    this.settingsUnsub();
    // Unsubscribe SYNCHRONOUSLY up front: the teardown below awaits, and a
    // project-record change landing in that window must not re-enter the handler
    // on a half-disposed manager.
    this.projectRecordsUnsubscriber?.();
    this.projectRecordsUnsubscriber = undefined;
    // Stop the vault watcher and drop its listener before the awaited teardown so
    // a late vault event can't bump an epoch on a half-disposed manager.
    this.contentTrackerUnsubscribe?.();
    this.contentTrackerUnsubscribe = undefined;
    this.contentTracker.dispose();
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
    this.composerHandoffByChatInputId.clear();
    this.chatUIStates.clear();
    this.landingCaptureSignatures.clear();
    this.lastSeenProjectContentEpochBySession.clear();
    this.activeSessionId = null;
    this.activeProjectId = GLOBAL_SCOPE;
    this.scopeSeq++;
    this.lastActiveByScope.clear();
    this.detachedFromTabIds.clear();
    this.contextDirtySignatures.clear();
    this.firstSessionPromiseByScope.clear();

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
    // Push any debounced index write to disk before the plugin unloads.
    await this.opts.sessionIndex?.flush();
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
    const requestId = ++this.latestHistoryLoadRequestId;

    for (const [internalId, state] of this.sessionState.entries()) {
      if (state.path !== file.path) continue;
      const existing = this.sessions.get(internalId);
      if (existing && existing.getStatus() !== "closed") {
        this.setActiveSession(internalId);
        return existing;
      }
      state.path = undefined;
    }

    // Captured before we create the loaded session (which becomes active) so
    // we can replace an empty landing tab in place instead of leaving it.
    const previousActiveId = this.activeSessionId;

    const loaded = await this.opts.persistenceManager.loadFile(file);
    // `loaded.projectId` is authoritative (GLOBAL_SCOPE for legacy chats with no
    // frontmatter). Read scope FIRST so the resumed session gets the right cwd;
    // an orphaned project (deleted) shows a Notice and aborts rather than
    // downgrading to the vault root (no recovery menu yet).
    const projectId = loaded.projectId;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice("This chat belongs to a project that no longer exists.");
      throw new OrphanedProjectError(projectId);
    }
    // Point the active scope at the chat's scope before constructing its
    // session (which then activates within that scope). No restore/spawn here —
    // we create the specific saved session next. Snapshot the scope this call
    // actually replaces right here, AFTER the awaits above — capturing earlier
    // would let a scope switch raced in during `loadFile` make rollback restore
    // a stale scope.
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);

    // Resume or create the saved session. Either await can reject (e.g. a
    // missing backend binary fails to spawn); on failure, undo the scope switch
    // above so a failed open doesn't leave the active scope ahead of the active
    // session. The throw points are all before a session activates, so no
    // already-active session in the target scope can be wrongly rolled back.
    let session: AgentSession;
    try {
      const resumed = loaded.sessionId
        ? await this.tryResumeSessionFromHistory(loaded.backendId, loaded.sessionId, projectId)
        : null;
      session = resumed ?? (await this.createSession(loaded.backendId, projectId));
    } catch (err) {
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw err;
    }

    session.loadDisplayMessages(loaded.messages);
    session.seedSessionUsage(loaded.usage);
    if (loaded.label) session.setLabel(loaded.label);
    this.getSessionState(session.internalId).path = file.path;
    if (loaded.sessionId) {
      // Keep the native twin's recency in step with the markdown side so the
      // merged history ranks this chat correctly after a reopen.
      void this.opts.sessionIndex?.touch(loaded.backendId, loaded.sessionId);
    }
    if (requestId === this.latestHistoryLoadRequestId) {
      this.setActiveSession(session.internalId);
      this.absorbIntoEmptyActiveTab(session, previousActiveId);
      this.notify();
    }
    return session;
  }

  /**
   * When a history item is opened while the active tab is an empty landing
   * (no user-visible messages), give the loaded session that tab's strip
   * position and close the empty one — so opening a chat doesn't leave a
   * stray blank tab behind. A tab with a real conversation is never
   * clobbered; the loaded chat opens as a new tab in that case.
   */
  private absorbIntoEmptyActiveTab(loaded: AgentSession, previousActiveId: string | null): void {
    if (!previousActiveId || previousActiveId === loaded.internalId) return;
    const previous = this.sessions.get(previousActiveId);
    if (!previous || previous.hasUserVisibleMessages()) return;
    const oldIdx = Array.from(this.sessions.keys()).indexOf(previousActiveId);
    if (oldIdx >= 0) {
      this.moveMapEntry(this.sessions, loaded.internalId, oldIdx);
      this.moveMapEntry(this.chatUIStates, loaded.internalId, oldIdx);
    }
    // Background close: the loaded session is already active, so closing the
    // empty one won't reassign the active pointer.
    void this.closeSession(previousActiveId).catch((e) =>
      logWarn(`[AgentMode] closing empty tab during history load failed`, e)
    );
  }

  /**
   * Open a chat that exists only in a backend's native session store (no
   * markdown note). If a live session is already bound to that backend
   * session id, focus it; otherwise resume through the same path markdown
   * history uses. Unlike `loadSessionFromHistory` there is no fresh-session
   * fallback — silently opening an empty chat would misread as data loss, so
   * the failure surfaces to the caller instead.
   *
   * The visible transcript comes back with the resume itself: ACP backends
   * replay it during `loadSession`, and Claude is hydrated from its on-disk
   * store by {@link hydrateResumedTranscript}.
   */
  async loadNativeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const requestId = ++this.latestHistoryLoadRequestId;
    // Identity is the (backendId, sessionId) pair — searched together so an
    // id collision across backends can't hide the correct already-open tab.
    const existing = this.findLiveSession(backendId, sessionId);
    if (existing) {
      this.setActiveSession(existing.internalId);
      return existing;
    }
    // Captured before the resumed session becomes active so we can replace an
    // empty landing tab in place rather than spawning a new one.
    const previousActiveId = this.activeSessionId;
    const index = this.opts.sessionIndex;
    const entry = index ? await index.getEntry(backendId, sessionId) : null;
    // Scope from the index entry (write-through / sweep attribution); absent ≙
    // global. Mirrors loadSessionFromHistory's frontmatter handling: orphan
    // guard first (never downgrade a project chat to the vault root), then
    // point the active scope at the chat's scope before constructing it.
    const projectId: ProjectScopeId = entry?.projectId ?? GLOBAL_SCOPE;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice("This chat belongs to a project that no longer exists.");
      throw new OrphanedProjectError(projectId);
    }
    // Snapshot the scope this call actually replaces right here, AFTER the
    // `getEntry` await — capturing earlier would let a scope switch raced in
    // during the await make rollback restore a stale scope.
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);
    // Unlike markdown history there is no fresh-session fallback — a failed
    // resume rejects, so undo the scope switch above before propagating it.
    let session: AgentSession;
    try {
      const resumed = await this.tryResumeSessionFromHistory(backendId, sessionId, projectId);
      if (!resumed) {
        throw new Error(
          `Could not resume session ${sessionId} from the ${backendId} session store.`
        );
      }
      session = resumed;
    } catch (err) {
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw err;
    }
    // Rebuild the visible transcript for backends that resume without
    // replaying it (Claude SDK reads its on-disk session jsonl). ACP backends
    // already loaded theirs from the replay above, so the store is non-empty
    // and this is a no-op for them. Best-effort: an empty result leaves
    // the resumed-but-blank session as-is rather than failing the open.
    await this.hydrateResumedTranscript(session, backendId, sessionId);
    // Reapply with the recorded source: a user rename stays sticky, but an
    // agent/derived title is agent-sourced so a resumed opencode/codex
    // session can still refresh its title from later agent updates.
    if (entry?.title) {
      session.restoreLabel(entry.title, entry.titleSource === "user" ? "user" : "agent");
    }
    if (index) await index.touch(backendId, sessionId);
    if (requestId === this.latestHistoryLoadRequestId) {
      this.setActiveSession(session.internalId);
      this.absorbIntoEmptyActiveTab(session, previousActiveId);
      this.notify();
    }
    return session;
  }

  /**
   * Load a resumed session's display transcript from the backend's on-disk
   * store when the backend supports it and the session came back empty.
   * No-op for backends that replay via `loadSession` (they have no
   * `readPersistedTranscript`) or when the store can't be reached.
   */
  private async hydrateResumedTranscript(
    session: AgentSession,
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<void> {
    const proc = this.backends.get(backendId);
    if (!proc?.readPersistedTranscript) return;
    if (session.store.getDisplayMessages().length > 0) return;
    try {
      // The store is keyed by the cwd the session RAN in (Claude encodes the
      // transcript path from it), so a project chat must hydrate from its
      // project folder — the vault root would look in the wrong directory.
      // Resolved inside the try: hydration is best-effort, and an orphaned
      // scope just skips it like any other store miss.
      const transcript = await proc.readPersistedTranscript({
        sessionId,
        cwd: this.resolveSessionCwd(session.projectId),
      });
      if (transcript.length > 0) session.loadDisplayMessages(transcript);
    } catch (e) {
      logWarn(`[AgentMode] could not hydrate transcript for ${sessionId}`, e);
    }
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
    sessionId: SessionId,
    projectId: ProjectScopeId
  ): Promise<AgentSession | null> {
    const existing = this.findLiveSession(backendId, sessionId);
    if (existing) return existing;

    const key = buildNativeChatId(backendId, sessionId);
    const inFlight = this.resumedSessionPromiseById.get(key);
    if (inFlight) return inFlight;

    const resume = this.resumeSessionFromHistory(backendId, sessionId, projectId).finally(() => {
      if (this.resumedSessionPromiseById.get(key) === resume) {
        this.resumedSessionPromiseById.delete(key);
      }
    });
    this.resumedSessionPromiseById.set(key, resume);
    return resume;
  }

  private async resumeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId,
    projectId: ProjectScopeId
  ): Promise<AgentSession | null> {
    // Same instruction ensure as `createSession` — a resumed session still derives its cwd
    // from the scope, so the backend needs the file present before cwd is read.
    await this.ensureScopeInstructions(
      projectId,
      projectId === GLOBAL_SCOPE ? undefined : getCachedProjectRecordById(projectId)
    );
    const cwd = this.resolveSessionCwd(projectId);
    // Settle queued vault events so the revision key below reflects a just-edited
    // source — otherwise resume could join an in-flight run reading the old content
    // and rehydrate the backend with stale searchable roots (the forced coarse note
    // can't add a root the backend never mounted).
    if (projectId !== GLOBAL_SCOPE) this.contentTracker.flushNow();
    // Kick off materialization in parallel (publishes the blocking load state up
    // front), overlapping with `ensureBackend`. Unlike a fresh create, a resumed
    // session can't appear before the backend rehydrates it, so we await the
    // roots just before `loadSession`. Never rejects → resume is never blocked.
    const contextReady =
      projectId === GLOBAL_SCOPE
        ? undefined
        : this.beginContextMaterialization(
            projectId,
            cwd,
            undefined,
            this.currentContextRevisionKey(projectId)
          );
    const descriptor = this.resolveDescriptor(backendId);

    this.pendingCreates++;
    this.startingBackendId = backendId;
    this.notify();

    let backend: BackendProcess;
    try {
      backend = await this.ensureBackend(backendId, descriptor);
    } catch (err) {
      this.setLastError(err2String(err));
      this.finishPendingCreate();
      return null;
    }

    if (this.disposed) {
      this.finishPendingCreate();
      return null;
    }

    // Await the roots now (materialize has been running alongside ensureBackend).
    // GLOBAL has no contextReady → undefined, identical to a context-free resume.
    // The inline `<project_context>` block is for fresh first prompts only, so a
    // resumed session uses just the searchable roots here.
    const additionalDirectories = contextReady
      ? (await contextReady).additionalDirectories
      : undefined;
    // The await above is a new suspension point — re-check disposal before
    // touching the (possibly tearing-down) backend, mirroring the fresh-create
    // guard in AgentSession.initialize. Same cleanup as the path's other returns.
    if (this.disposed) {
      this.finishPendingCreate();
      return null;
    }
    let resumeResult: LoadSessionOutput | null = null;
    try {
      resumeResult = await backend.loadSession({
        sessionId,
        cwd,
        projectId,
        additionalDirectories,
      });
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
          cwd,
          projectId,
          additionalDirectories,
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

    const internalId = uuidv4();
    const session = new AgentSession({
      backend,
      backendSessionId: resumeResult.sessionId,
      internalId,
      backendId,
      projectId,
      initialState: resumeResult.state,
      cwd,
      getDescriptor: () => this.opts.resolveDescriptor(backendId),
      runFanoutTurn: (input) => this.runFanoutTurn(input),
      getDisplayName: (id) => this.resolveDescriptor(id).displayName,
      getApp: () => this.app,
      // Project sessions only. A resumed conversation was closed for a while, so
      // its sources may well have changed — seed the cursor BEHIND the current
      // epoch so its first send always emits the coarse note (the maintainer's
      // "resumed-session note"), independent of whether a change was observed this
      // plugin session. Deferred fresh-manifest re-delivery is a separate feature.
      ...(projectId !== GLOBAL_SCOPE
        ? {
            getProjectContextUpdates: () => this.getProjectContextUpdates(internalId, projectId),
            markProjectContextUpdatesDelivered: (epoch: number) =>
              this.markProjectContextUpdatesDelivered(internalId, epoch),
          }
        : {}),
    });

    // ACP backends rebuild the visible transcript from the frames the agent
    // replays during `loadSession`; `resumeSession` (Claude) returns none and
    // is hydrated from its own store further down instead.
    if (resumeResult.transcript?.length) {
      session.loadDisplayMessages(resumeResult.transcript);
    }

    if (descriptor.applyInitialSessionConfig) {
      try {
        await descriptor.applyInitialSessionConfig(session, getSettings());
      } catch (e) {
        logWarn(
          `[AgentMode] applyInitialSessionConfig failed for resumed ${backendId} session; continuing`,
          e
        );
      }
    }
    await replayPersistedMode(session, this.getDefaultMode(backendId));
    if (this.disposed) {
      await session.dispose();
      this.finishPendingCreate();
      return null;
    }
    if (projectId !== GLOBAL_SCOPE) {
      this.lastSeenProjectContentEpochBySession.set(internalId, RESUMED_SESSION_BEHIND_EPOCH);
    }
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
    this.detachedFromTabIds.delete(session.internalId);
    this.attachAutoSave(session);
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
    const index = this.opts.sessionIndex;
    if (!persistence && !index) return;

    // The markdown auto-save is gated on `settings.autosaveChat` inside
    // `scheduleAutoSave`; the index write-through is not — history must keep
    // tracking the session even when the user opted out of markdown notes.
    const trigger = () => {
      this.scheduleAutoSave(session);
      this.scheduleIndexTouch(session);
    };
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

  private scheduleIndexTouch(session: AgentSession): void {
    if (!this.opts.sessionIndex) return;
    const state = this.getSessionState(session.internalId);
    if (state.indexTimer) window.clearTimeout(state.indexTimer);
    state.indexTimer = window.setTimeout(() => {
      state.indexTimer = undefined;
      this.flushIndexTouch(session).catch((e) =>
        logWarn(`[AgentMode] session-index update failed for ${session.internalId}`, e)
      );
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * Record this session in the index so it appears in recent chats whether
   * or not a markdown note exists. Skips sessions that haven't produced a
   * user-visible message yet — a freshly-opened empty tab isn't history.
   */
  private async flushIndexTouch(session: AgentSession): Promise<void> {
    const index = this.opts.sessionIndex;
    if (!index) return;
    if (!this.sessions.has(session.internalId)) return;
    const sessionId = session.getBackendSessionId();
    if (!sessionId) return;
    const messages = session.store.getDisplayMessages();
    if (messages.length === 0) return;
    const now = Date.now();
    // Prefer the agent/user label; fall back to a title derived from the
    // first user message so chats that have no agent title (every Claude
    // Code chat — its SDK has no title API) don't read "Untitled chat".
    // The derived title is recorded agent-sourced, so an opencode/codex
    // summarizer title still overrides it later, and a user rename always wins.
    const label = session.getLabel();
    const title = label ?? deriveChatTitleFromMessages(messages);
    const titleSource: "user" | "agent" | undefined = !title
      ? undefined
      : label && session.getLabelSource() === "user"
        ? "user"
        : "agent";
    await index.recordSession({
      backendId: session.backendId,
      sessionId,
      title,
      titleSource,
      createdAtMs: messages[0]?.timestamp?.epoch ?? now,
      lastAccessedAtMs: now,
      // Scope the native entry so project views can list it (markdown chats
      // carry the scope in frontmatter; native-only chats have only this).
      // GLOBAL_SCOPE maps to the field's "absent" encoding.
      projectId: session.projectId === GLOBAL_SCOPE ? undefined : session.projectId,
    });
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
    const usage = session.getSessionUsage();
    // Skip the write when nothing user-visible has changed since the last
    // save. Streaming token updates and idempotent label notifications
    // otherwise rewrite the entire file on every debounce tick. Include
    // the backend session id in the signature so the first save after the
    // session finishes starting (when sessionId flips from null → real)
    // always writes through, even if the message list hasn't changed yet.
    // For an in-flight fan-out turn `message` stays empty until completion, so
    // fold in a fingerprint of the live slots — otherwise mid-stream autosaves
    // de-dupe to the first partial snapshot and a crash loses later progress.
    const last = messages[messages.length - 1];
    const fanoutSig = last?.fanout
      ? Object.values(last.fanout.answers)
          .map((a) => `${a.status}:${a.text.length}`)
          .join(",") + `|${last.fanout.summary.status}:${last.fanout.summary.text.length}`
      : "";
    // Fold in the usage `updatedAt` so a turn that only changed token usage
    // (message text/label/sessionId all unchanged) still writes through.
    const signature = `${label ?? ""}-${sessionId ?? ""}-${messages.length}-${
      last?.message ?? ""
    }-${fanoutSig}-${usage?.updatedAt ?? ""}`;
    const state = this.getSessionState(session.internalId);
    if (state.signature === signature) {
      return state.path ? { path: state.path } : null;
    }

    const result = await persistence.saveSession(messages, session.backendId, {
      label,
      existingPath: state.path,
      sessionId,
      // GLOBAL_SCOPE writes no frontmatter (byte-identical to legacy chats);
      // a real project id binds the chat to that scope on disk.
      projectId: session.projectId,
      usage: usage ?? undefined,
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
    if (state?.indexTimer) {
      window.clearTimeout(state.indexTimer);
      state.indexTimer = undefined;
      try {
        await this.flushIndexTouch(session);
      } catch (e) {
        logWarn(`[AgentMode] drain session-index update failed for ${session.internalId}`, e);
      }
    }
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
    if (state.indexTimer) window.clearTimeout(state.indexTimer);
    state.unsub?.();
    state.attentionUnsub?.();
    this.sessionState.delete(internalId);
  }

  /**
   * Watch this session's status transitions out of `running` into a state
   * that demands the user's eye (turn ended, errored, or paused for
   * permission) and raise the applicable attention signals.
   */
  private attachAttentionTracking(session: AgentSession): void {
    let prev = session.getStatus();
    const unsubscribe = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (next) => {
        const wasRunning = prev === "running";
        const isRunning = next === "running";
        prev = next;
        void this.flushDeferredBackendRestartIfReady(session.backendId);
        // Only a turn that actually ran can newly demand attention.
        // https://github.com/logancyang/obsidian-copilot/issues/2987
        const wantsUser = wasRunning && ATTENTION_TRIGGER_STATUSES.has(next);
        if (wantsUser) this.signalSessionNeedsAttention(session);
        // Re-render recent-list rows when this session's running membership
        // flips, so the row's spinner appears/disappears in step.
        if (wasRunning !== isRunning) this.notify();
      },
    });
    this.getSessionState(session.internalId).attentionUnsub = unsubscribe;
  }

  /** Whether keyboard focus is currently inside this session's active Agent Chat leaf. */
  private isSessionFocused(session: AgentSession): boolean {
    if (this.activeSessionId !== session.internalId) return false;
    // A sidebar input can own keyboard focus while Obsidian keeps the center
    // editor as its most recent leaf. https://github.com/logancyang/obsidian-copilot/issues/2987
    return this.app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE).some((leaf) => {
      const container = leaf.view.containerEl;
      const doc = container.doc;
      const activeElement = doc.activeElement;
      return doc.hasFocus() && activeElement !== null && container.contains(activeElement);
    });
  }

  /** Raise visual attention for background tabs and audible attention outside the active chat. */
  private signalSessionNeedsAttention(session: AgentSession): void {
    // The dot identifies a different Agent tab that wants the user; keyboard
    // focus does not change which tab is selected. https://github.com/logancyang/obsidian-copilot/issues/2987
    if (this.activeSessionId !== session.internalId) session.markNeedsAttention();
    // Sound follows real focus so a selected but unattended chat can still
    // call the user back. https://github.com/logancyang/obsidian-copilot/issues/2987
    if (this.isSessionFocused(session)) return;
    this.playConfiguredNotificationSound();
  }

  /** Play the user's chosen sound when agent notifications are enabled. */
  private playConfiguredNotificationSound(): void {
    const { notificationSound, notificationSoundId } = getSettings().agentMode;
    if (!notificationSound) return;
    playNotificationSound(notificationSoundId);
  }

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
    // Lets a backend with its own permission gate (Claude SDK) hard-deny write/exec
    // tools for read-only fan-out sub-sessions — see `permissionBridge`.
    proc.setReadOnlySessionPredicate?.((sessionId) => this.isReadOnlyFanoutSession(sessionId));
  }

  /**
   * Obtain a running backend process from manager ownership, an in-flight
   * spawn, a warm probe process, or a fresh spawn. Warm process adoption never
   * adopts the probe session; callers open or resume their own session.
   */
  private async ensureBackend(
    backendId: BackendId,
    descriptor: BackendDescriptor
  ): Promise<BackendProcess> {
    const existing = this.backends.get(backendId);
    if (existing && existing.isRunning()) return existing;
    const inflight = this.starting.get(backendId);
    if (inflight) return inflight;
    const startPromise = (async () => {
      // A plugin-load probe owns the only process for this backend until it
      // settles. Await that same deduped probe so a user selection cannot race
      // it and spawn a second process before the warm entry exists.
      if (!this.isPreloadReady(backendId)) {
        await this.preloader.preload(backendId);
      }

      const warm = this.preloader.takeWarm(backendId);
      if (warm) {
        // Probe subprocess is already started + initialize-handshaken —
        // wire it into the manager without paying either cost again.
        this.wirePrompters(warm.proc);
        this.installBackendExitHandler(backendId, warm.proc, descriptor);
        this.backends.set(backendId, warm.proc);
        return warm.proc;
      }

      const proc = descriptor.createBackendProcess({
        plugin: this.plugin,
        app: this.app,
        clientVersion: this.plugin.manifest.version,
        descriptor,
      });
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
      return await startPromise;
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
        this.composerHandoffByChatInputId.delete(s.chatInputId);
        this.chatUIStates.delete(s.internalId);
        this.landingCaptureSignatures.delete(s.internalId);
        this.lastSeenProjectContentEpochBySession.delete(s.internalId);
        this.detachedFromTabIds.delete(s.internalId);
        // Drop the dead session from its scope's MRU so a later enter can't
        // resurrect a dead id.
        if (this.lastActiveByScope.get(s.projectId) === s.internalId) {
          this.lastActiveByScope.delete(s.projectId);
        }
        s.cancel().catch(() => {});
        s.dispose().catch(() => {});
      }
      if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) {
        // Repoint at a STRIP-VISIBLE survivor only. A session detached on a prior
        // project re-entry was deliberately parked to history; crash recovery must
        // not silently resurrect it into the active tab. If none is visible, leave
        // active null — the crash pill shows and the router (which bails on
        // lastError) won't auto-respawn behind the user.
        let next: AgentSession | undefined;
        for (const s of this.sessions.values()) {
          if (!this.detachedFromTabIds.has(s.internalId)) {
            next = s;
            break;
          }
        }
        this.activeSessionId = next?.internalId ?? null;
        // Crash repointing can cross scopes; keep `active.projectId ===
        // activeProjectId` rather than leaving a stale scope behind.
        if (next) {
          this.activeProjectId = next.projectId;
          this.scopeSeq++;
        }
      }
      // Surface the crash so the empty-state pill shows it and the
      // router's auto-spawn effect (which bails on lastError) doesn't
      // immediately respawn behind the user's back. The next explicit
      // create call clears it.
      this.setLastError(`${descriptor.displayName} backend exited unexpectedly.`);
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
    const pending = this.pendingBackendRestarts.get(backendId);
    if (!pending) return;
    if (!pending.immediate && this.hasBusySession(backendId)) return;
    this.pendingBackendRestarts.delete(backendId);
    try {
      await this.restartBackendNow(backendId, pending.reason, pending.immediate);
    } catch (err) {
      this.setLastError(err2String(err));
      logError(`[AgentMode] deferred ${backendId} backend restart failed`, err);
      this.notify();
    }
  }

  /** Immediately tear down `backendId` and replace the active affected tab. */
  private async restartBackendNow(
    backendId: BackendId,
    reason: string,
    immediate = false
  ): Promise<void> {
    // A restart is already running for this backend. Stash the reason so the
    // tail of the in-flight restart can re-run with the latest settings —
    // otherwise rapid-fire emits (e.g. one BYOK save touching many models)
    // would be silently dropped and the running backend would keep stale
    // config until something else triggered another restart.
    if (this.restartingBackends.has(backendId)) {
      const prev = this.pendingBackendRestarts.get(backendId);
      this.pendingBackendRestarts.set(backendId, {
        reason: prev ? `${prev.reason}; ${reason}` : reason,
        immediate: (prev?.immediate ?? false) || immediate,
      });
      // A Search scope change queued behind another refresh must keep its
      // non-deferrable privacy semantics when the first refresh completes.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
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
      const replacedSession = affected.find((s) => s.internalId === this.activeSessionId);
      const shouldCreateReplacement =
        this.isBackendInstalled(backendId) && affected.length > 0 && replacedSession !== undefined;
      // The replacement must inherit the REPLACED session's scope, not the
      // current active scope — captured before the close loop repoints `active`.
      const replacementProjectId = replacedSession?.projectId ?? this.activeProjectId;
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
        // every restart, and the picker's catalog and per-model effort catalog
        // are both probe-owned, so always re-probe. When a tab on this backend
        // is active, await the probe and let the replacement adopt its warm
        // proc: one spawn, and the per-model switch flicker stays on the
        // throwaway probe session instead of the user's.
        const probe = this.preloader.preload(backendId);
        this.registerPreload(backendId, probe);
        if (shouldCreateReplacement && !this.disposed) {
          await probe;
          // The replacement inherits the REPLACED session's scope (captured
          // above as `replacementProjectId`), not the current active scope.
          await this.createSession(backendId, replacementProjectId);
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
      if (!queued.immediate && this.hasBusySession(backendId)) {
        // A session went busy between requests; fall back to the deferral
        // path so we don't tear down mid-turn.
        this.pendingBackendRestarts.set(backendId, queued);
        return;
      }
      try {
        await this.restartBackendNow(backendId, queued.reason, queued.immediate);
      } catch (err) {
        this.setLastError(err2String(err));
        logError(`[AgentMode] queued ${backendId} backend restart failed`, err);
        this.notify();
      }
    }
  }
}
