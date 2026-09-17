import type { BackendState } from "@/agentMode/session/types";
import { resolveEffort } from "@/lib/model-effort";
import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
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
import type { AgentFileManager } from "@/agents/AgentFileManager";
import { BUILTIN_AGENT, BUILTIN_AGENT_SLUG, toAgentEntry } from "@/agents/types";
import type { AgentEntry, CustomAgent } from "@/agents/types";
import {
  COPILOT_SESSION_AGENT,
  loadSessionAgent,
  missingSessionAgent,
  type SessionAgent,
} from "./sessionAgent";
import {
  deriveChatTitleFromMessages,
  mergeChatHistoryItems,
  type MarkdownChatEntry,
} from "./chatHistoryMerge";
import { MethodUnsupportedError } from "./errors";
import { replayPersistedMode } from "./replayPersistedMode";
import { applyModeSpec } from "./modeApply";
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
const LIST_SESSIONS_TIMEOUT_MS = 1_500;

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

function isSameCwd(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+$/, "");
  return norm(a) === norm(b);
}

const EMPTY_SESSIONS = Object.freeze([]) as unknown as AgentSession[];
const EMPTY_HISTORY_ITEMS = Object.freeze([]) as unknown as ChatHistoryItem[];
const EMPTY_RECENT_CHAT_IDS: ReadonlySet<string> = new Set();
const EMPTY_CHAT_INPUT_IDS: readonly string[] = Object.freeze([]);
/** The picker's list before any agent exists: the built-in entry alone. */
const BUILTIN_ONLY_AGENT_ENTRIES: readonly AgentEntry[] = Object.freeze([BUILTIN_AGENT]);
/** See AGENTS.md → "Referential stability". */
const EMPTY_CUSTOM_AGENTS: readonly CustomAgent[] = Object.freeze([]);

const RESUMED_SESSION_BEHIND_EPOCH = -1;

function toFailedItem(failure: SourceFailure): FailedItem {
  return {
    path: failure.source,
    type: failure.kind === "file" ? "nonMd" : failure.kind,
    error: failure.error,
    usedStaleSnapshot: failure.usedStaleSnapshot,
  };
}

function failedItemIsSource(failed: FailedItem, item: MaterializeSourceIdentity): boolean {
  if (failed.path !== item.source) return false;
  return item.kind === "file" ? failed.type === "nonMd" : failed.type === item.kind;
}

function addProcessingSource(
  list: AgentInFlightSource[],
  item: MaterializeSourceIdentity
): AgentInFlightSource[] {
  if (list.some((s) => s.kind === item.kind && s.source === item.source)) return list;
  return [...list, { kind: item.kind, source: item.source }];
}

function removeProcessingSource(
  list: AgentInFlightSource[],
  item: MaterializeSourceIdentity
): AgentInFlightSource[] {
  return list.filter((s) => !(s.kind === item.kind && s.source === item.source));
}

function upsertFailedItem(list: FailedItem[], failure: FailedItem): FailedItem[] {
  return [...list.filter((f) => !(f.path === failure.path && f.type === failure.type)), failure];
}

export type PermissionPrompter = (req: PermissionPrompt) => Promise<PermissionDecision>;

export type AskUserQuestionPrompter = (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;

export type DescriptorResolver = (id: BackendId) => BackendDescriptor | undefined;

export interface ReplaceSessionOptions {
  preserveChatInput?: boolean;
  seedSelection?: ModelSelection;
}

export interface AgentSessionManagerOptions {
  permissionPrompter: PermissionPrompter;
  askUserQuestionPrompter?: AskUserQuestionPrompter;
  resolveDescriptor: DescriptorResolver;
  modelPreloader: AgentModelPreloader;
  beforeBackendStart?: (id: BackendId) => Promise<void>;
  persistenceManager?: AgentChatPersistenceManager;
  sessionIndex?: AgentSessionIndex;
  /**
   * Reader for `copilot/agents/`, used to resolve the agent a chat is talking
   * to and to load its persona and memory. Optional only so legacy callers
   * (tests) can omit it; production wiring always supplies one via the barrel
   * in `agentMode/index.ts`. Without it every chat runs as the built-in
   * Copilot, and a chat that names an agent shows the name as a plain label.
   */
  agentFileManager?: AgentFileManager;
}

export class AgentSessionManager {
  private backends = new Map<BackendId, BackendProcess>();
  private starting = new Map<BackendId, Promise<BackendProcess>>();
  private sessions = new Map<string, AgentSession>();
  private chatUIStates = new Map<string, AgentChatUIState>();
  private activeSessionId: string | null = null;
  private activeProjectId: ProjectScopeId = GLOBAL_SCOPE;
  private scopeSeq = 0;
  private readonly lastActiveByScope = new Map<ProjectScopeId, string>();
  private readonly detachedFromTabIds = new Set<string>();
  private readonly contextDirtySignatures = new Map<ProjectScopeId, string>();
  private readonly landingCaptureSignatures = new Map<string, string>();
  private readonly contentTracker: ProjectContentTracker;
  private contentTrackerUnsubscribe?: () => void;
  private readonly lastSeenProjectContentEpochBySession = new Map<string, number>();
  private previousProjectRecords: ProjectFileRecord[] = [];
  private projectRecordsUnsubscriber?: () => void;
  private readonly firstSessionPromiseByScope = new Map<ProjectScopeId, Promise<AgentSession>>();
  private readonly replacementCursorByChatInputId = new Map<string, Promise<string>>();
  readonly drafts: AgentInputDraftStore;
  private readonly resumedSessionPromiseById = new Map<string, Promise<AgentSession | null>>();
  private latestHistoryLoadRequestId = 0;
  private pendingCreates = 0;
  private listeners = new Set<() => void>();
  private disposed = false;
  private startingBackendId: BackendId | null = null;
  private lastError: string | null = null;
  private lastErrorSeq = 0;

  private readonly pendingBackendRestarts = new Map<
    BackendId,
    { reason: string; immediate: boolean }
  >();
  private readonly restartingBackends = new Set<BackendId>();
  /**
   * Backends running with spawn config the user has since changed. Applying it restarts the
   * backend and closes every session, so it waits for the user's Reload.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/475
   */
  private readonly heldConfigChanges = new Map<BackendId, string>();
  /**
   * Chat inputs mid-replacement during a backend restart, so the composer draft is not
   * pruned in the gap between the old session closing and its replacement existing.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/473
   */
  private readonly retainedChatInputIds = new Set<string>();
  /**
   * `backendId:baseModelId` pairs already warned about; the read runs on every session create.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/474
   */
  private readonly warnedUnavailableModels = new Set<string>();
  private readonly preloader: AgentModelPreloader;
  private readonly preloadStatus = new Map<BackendId, "pending" | "ready" | "error">();
  private readonly sessionState = new Map<
    string,
    {
      source?: { path: string };
      timer?: number;
      indexTimer?: number;
      unsub?: () => void;
      signature?: string;
      attentionUnsub?: () => void;
    }
  >();

  private readonly readOnlyFanoutSessions = new Set<SessionId>();
  private readonly defaultApplyChains = new Map<string, Promise<void>>();
  private readonly fanoutOrchestrator: FanoutOrchestrator;
  private selectedAgentSlug: string = BUILTIN_AGENT_SLUG;
  private agentRoster: readonly CustomAgent[] = EMPTY_CUSTOM_AGENTS;
  private agentEntries: readonly AgentEntry[] = BUILTIN_ONLY_AGENT_ENTRIES;
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
    this.drafts = new AgentInputDraftStore(app, (chatInputId) =>
      this.getLiveChatInputIds().includes(chatInputId)
    );
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

  private enqueueDefaultApply(session: AgentSession, descriptor: BackendDescriptor): void {
    const backendId = session.backendId;
    const prior = this.defaultApplyChains.get(session.internalId) ?? Promise.resolve();
    const next = prior
      .then(() => session.ready)
      .then(() => {
        if (session.getStatus() === "closed") return;
        const target = this.getSeedSelection(backendId);
        if (!target) return;
        return descriptor
          .applySelection(session, target)
          .then(() => this.repairDefaultEffort(backendId, session.getState()));
      })
      .catch((e) => logWarn(`[AgentMode] re-applying default model for ${backendId} failed`, e))
      .finally(() => {
        if (this.defaultApplyChains.get(session.internalId) === next) {
          this.defaultApplyChains.delete(session.internalId);
        }
      });
    this.defaultApplyChains.set(session.internalId, next);
  }

  isReadOnlyFanoutSession(backendSessionId: SessionId): boolean {
    return this.readOnlyFanoutSessions.has(backendSessionId);
  }

  runFanoutTurn(input: FanoutRunInput): Promise<FanoutTurn> {
    return this.fanoutOrchestrator.run(input);
  }

  private createFanoutHost(): FanoutHost {
    return {
      ensureBackendForFanout: async (backendId) => {
        const descriptor = this.resolveDescriptor(backendId);
        const proc = await this.ensureBackend(backendId, descriptor);
        return { proc, descriptor };
      },
      getDefaultSelection: (backendId) => this.getSeedSelection(backendId),
      onSelectionApplied: (backendId, state) => this.repairDefaultEffort(backendId, state),
      getDisplayName: (backendId) => this.resolveDescriptor(backendId).displayName,
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

  private setupProjectRecordChangeMonitor(): void {
    this.previousProjectRecords = getCachedProjectRecords();
    this.projectRecordsUnsubscriber?.();
    this.projectRecordsUnsubscriber = subscribeToProjectRecords((nextRecords) => {
      this.handleProjectRecordsChanged(nextRecords);
    });
  }

  private handleProjectRecordsChanged(nextRecords: ProjectFileRecord[]): void {
    if (this.disposed) return;
    const prevRecords = this.previousProjectRecords;
    this.previousProjectRecords = nextRecords;

    const nextIds = new Set(nextRecords.map((r) => r.project.id));
    for (const id of this.contextDirtySignatures.keys()) {
      if (!nextIds.has(id)) this.contextDirtySignatures.delete(id);
    }

    for (const nextRecord of nextRecords) {
      const prevRecord = prevRecords.find((r) => r.project.id === nextRecord.project.id);
      if (!prevRecord) continue;
      const nextSignature = getProjectContextSignature(nextRecord);
      if (getProjectContextSignature(prevRecord) === nextSignature) continue;

      const projectId = nextRecord.project.id;
      this.contentTracker.bumpEpoch(projectId);
      this.markProjectContextDirty(projectId, nextRecord);
      if (projectId === this.activeProjectId) this.warmProjectContext(projectId);
    }
  }

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

  private warmProjectContext(projectId: ProjectScopeId): void {
    if (this.disposed || projectId === GLOBAL_SCOPE) return;
    let cwd: string;
    try {
      cwd = this.resolveSessionCwd(projectId);
    } catch {
      return;
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

  private currentContextRevisionKey(projectId: ProjectScopeId): string | undefined {
    const record = getCachedProjectRecordById(projectId);
    if (!record) return undefined;
    return composeContextDirtyKey(
      getProjectContextSignature(record),
      this.contentTracker.getEpoch(projectId)
    );
  }

  private isProjectContextDirty(projectId: ProjectScopeId): boolean {
    return this.contextDirtySignatures.has(projectId);
  }

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

  private markProjectContextUpdatesDelivered(internalId: string, epoch: number): void {
    const lastSeen = this.lastSeenProjectContentEpochBySession.get(internalId) ?? 0;
    if (epoch > lastSeen) this.lastSeenProjectContentEpochBySession.set(internalId, epoch);
  }

  async getChatHistoryItems(scope?: ProjectScopeId): Promise<ChatHistoryItem[]> {
    const persistence = this.opts.persistenceManager;
    const index = this.opts.sessionIndex;
    if (!persistence && !index) return EMPTY_HISTORY_ITEMS;

    const liveAttentionPaths = this.collectLiveAttentionPaths();
    // Rows show the agent's icon before the title, which needs the roster the
    // slugs resolve against (`designdocs/CUSTOM_AGENTS.md` §8). Refreshing here
    // also keeps the talking-to picker current whenever the landing reloads.
    await this.refreshAgents();
    const iconBySlug = new Map(this.agentRoster.map((agent) => [agent.slug, agent.icon]));

    let files: TFile[] = [];
    let markdownEntries: MarkdownChatEntry[] = [];
    if (persistence) {
      files = await persistence.getAgentChatHistoryFiles();
      const tracker = this.plugin.getChatHistoryLastAccessedAtManager();
      markdownEntries = await Promise.all(
        files.map(async (file) => {
          const ref = await this.readSessionRefFromFile(file.path);
          const base = fileToHistoryItem(this.app, file, tracker);
          // A slug with no icon (or none left, its agent deleted) simply gets no
          // glyph; the row falls back to the backend brand icon it always had.
          const agentIcon = ref?.agentSlug ? iconBySlug.get(ref.agentSlug) : undefined;
          const item =
            liveAttentionPaths.has(base.id) || agentIcon
              ? {
                  ...base,
                  ...(liveAttentionPaths.has(base.id) ? { needsAttention: true } : {}),
                  ...(agentIcon ? { agentIcon } : {}),
                }
              : base;
          return { item, backendId: ref?.backendId, sessionId: ref?.sessionId };
        })
      );
    }

    if (scope && scope !== GLOBAL_SCOPE) {
      const resolved = await Promise.all(
        files.map(async (file, i) => {
          const projectId =
            (await readChatPathProjectId(this.app, file.path))?.trim() || GLOBAL_SCOPE;
          return projectId === scope ? markdownEntries[i] : null;
        })
      );
      const scopedMarkdown = await this.dropNonLocalMarkdownEntries(
        resolved.filter((entry): entry is MarkdownChatEntry => entry !== null)
      );
      if (!index) {
        const items = scopedMarkdown.map((e) => e.item);
        return items.length === 0 ? EMPTY_HISTORY_ITEMS : items;
      }
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

  private collectLiveAttentionPaths(): Set<string> {
    const paths = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (!session.getNeedsAttention()) continue;
      const path = this.sessionState.get(internalId)?.source?.path;
      if (path) paths.add(path);
    }
    return paths;
  }

  private recentChatIdsForSession(internalId: string, session: AgentSession): string[] {
    const ids: string[] = [];
    const path = this.sessionState.get(internalId)?.source?.path;
    if (path) ids.push(path);
    const backendSessionId = session.getBackendSessionId();
    if (backendSessionId) ids.push(buildNativeChatId(session.backendId, backendSessionId));
    return ids;
  }

  getOpenChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      // A starting or failed session has no backend resource for the user to close.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/429
      if (!session.getBackendSessionId()) continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  async closeChatSession(historyId: string): Promise<void> {
    for (const [internalId, session] of this.sessions) {
      // History can still display the native identity after the first autosave.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/429
      if (this.recentChatIdsForSession(internalId, session).includes(historyId)) {
        await this.closeSession(internalId, { releaseBackend: true });
        return;
      }
    }
  }

  /**
   * Closing a tab is navigation; only the history action releases the backend resource.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/429
   */
  detachSessionFromTab(id: string): void {
    const session = this.sessions.get(id);
    if (!session || this.detachedFromTabIds.has(id)) return;
    const scopeIdsBefore = this.getSessionIdsForScope(session.projectId);
    const closedIndex = scopeIdsBefore.indexOf(id);
    this.detachedFromTabIds.add(id);

    if (this.lastActiveByScope.get(session.projectId) === id) {
      this.lastActiveByScope.delete(session.projectId);
    }
    if (this.activeSessionId === id) {
      const nextId = pickScopeNeighbor(
        this.getSessionIdsForScope(session.projectId),
        closedIndex,
        this.lastActiveByScope.get(session.projectId)
      );
      this.activeSessionId = nextId;
      if (nextId) this.lastActiveByScope.set(session.projectId, nextId);
    }
    this.notify();
  }

  getRunningChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (session.getStatus() !== "running") continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  getAttentionChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (!session.getNeedsAttention()) continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const native = parseNativeChatId(fileId);
    if (native) {
      const index = this.opts.sessionIndex;
      if (!index) throw new Error("Agent session index is not configured.");
      await index.setTitle(native.backendId, native.sessionId, newTitle);
      this.findLiveSession(native.backendId, native.sessionId)?.setLabel(newTitle);
      return;
    }
    const persistence = this.opts.persistenceManager;
    if (!persistence) throw new Error("Agent chat persistence is not configured.");
    await persistence.updateTopic(fileId, newTitle);
  }

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

  private async readSessionRefFromFile(
    fileId: string
  ): Promise<{ backendId: BackendId; sessionId: string; agentSlug?: string } | null> {
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
    const agentSlug = typeof fm?.agentSlug === "string" ? fm.agentSlug.trim() : "";
    return { backendId, sessionId, agentSlug: agentSlug || undefined };
  }

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

  private async sweepNativeSessions(
    backendId: BackendId,
    proc: BackendProcess,
    vaultBasePath: string
  ): Promise<void> {
    const index = this.opts.sessionIndex;
    if (!index) return;
    const descriptor = this.opts.resolveDescriptor(backendId);
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
      const projectId = inVaultRoot ? undefined : resolveProjectIdForCwd(vaultBasePath, s.cwd);
      if (!inVaultRoot && !projectId) continue;
      if (probeSessionId && s.sessionId === probeSessionId) continue;
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

  async getOrCreateActiveSession(): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const active = this.getActiveSession();
    if (active && active.projectId === this.activeProjectId && active.getStatus() !== "closed") {
      return active;
    }
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

  async createSession(
    backendId?: BackendId,
    projectId: ProjectScopeId = this.activeProjectId,
    seedSelection?: ModelSelection,
    chatInputId?: string,
    sessionAgent?: SessionAgent
  ): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }

    const bound = sessionAgent ? null : await this.bindSessionAgent(this.selectedAgentSlug);
    const agent = sessionAgent ?? bound?.agent ?? COPILOT_SESSION_AGENT;
    const pinned = bound?.source ?? null;
    const pinnedBackendId = backendId ? undefined : pinned?.backendId;
    const requestedId =
      backendId ?? pinnedBackendId ?? getSettings().agentMode?.activeBackend ?? "opencode";
    const resolvedId = this.opts.resolveDescriptor(requestedId) ? requestedId : "opencode";
    const errorSeqAtStart = this.lastErrorSeq;
    const descriptor = this.resolveDescriptor(resolvedId);
    const pinnedSelection =
      pinned?.modelId && (!pinned.backendId || pinned.backendId === resolvedId)
        ? { baseModelId: pinned.modelId, effort: null }
        : undefined;
    const resolvedSeed =
      seedSelection ?? pinnedSelection ?? this.getSeedSelection(resolvedId) ?? undefined;
    if (!resolvedSeed && descriptor.routesCopilotModels) {
      const message = `Enable a model for ${descriptor.displayName} in Copilot's model settings to start a chat.`;
      this.setLastError(message);
      this.notify();
      throw new Error(message);
    }

    const projectRecord =
      projectId === GLOBAL_SCOPE ? undefined : getCachedProjectRecordById(projectId);

    await this.ensureScopeInstructions(projectId, projectRecord);

    const landingCaptureSignature = projectRecord
      ? getProjectLandingCaptureSignature(this.app, projectRecord)
      : undefined;

    const cwd = this.resolveSessionCwd(projectId);

    if (projectId !== GLOBAL_SCOPE) this.contentTracker.flushNow();
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
      defaultMode: this.getDefaultMode(resolvedId),
      getDescriptor: () => this.opts.resolveDescriptor(resolvedId),
      runFanoutTurn: (input) => this.runFanoutTurn(input),
      getDisplayName: (backendId) => this.resolveDescriptor(backendId).displayName,
      getApp: () => this.app,
      contextReady,
      ...(projectId !== GLOBAL_SCOPE
        ? {
            getProjectContextUpdates: () => this.getProjectContextUpdates(internalId, projectId),
            markProjectContextUpdatesDelivered: (epoch: number) =>
              this.markProjectContextUpdatesDelivered(internalId, epoch),
          }
        : {}),
    });
    session.setAgent(agent);
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
    if (landingCaptureSignature) {
      this.landingCaptureSignatures.set(session.internalId, landingCaptureSignature);
    } else {
      this.landingCaptureSignatures.delete(session.internalId);
    }
    this.detachedFromTabIds.delete(session.internalId);
    this.lastActiveByScope.set(projectId, session.internalId);
    if (projectId === this.activeProjectId) {
      this.activeSessionId = session.internalId;
    }
    this.attachAutoSave(session);
    this.attachAttentionTracking(session);
    this.notify();

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

    void session.ready
      .then(async () => {
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
        this.repairDefaultEffort(resolvedId, session.getState());
        if (this.lastErrorSeq === errorSeqAtStart) {
          this.lastError = null;
        }
        logInfo(
          `[AgentMode] session ready (internal=${session.internalId} backend-id=${session.getBackendSessionId()} backend=${resolvedId}); pool size=${this.sessions.size}`
        );
        await replayPersistedMode(session, this.getDefaultMode(resolvedId));
      })
      .catch((err) => {
        this.setLastError(err2String(err));
      })
      .finally(() => this.finishPendingCreate());

    return session;
  }

  async createGlobalSessionWithDraft(initialDraft: string): Promise<AgentSession> {
    const projectId = GLOBAL_SCOPE;
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);
    let session: AgentSession;
    try {
      session = await this.createSession(undefined, projectId);
    } catch (error) {
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw error;
    }
    this.drafts.update(session.chatInputId, (draft) => ({ ...draft, input: initialDraft }));
    return session;
  }

  async addContextNoteToActiveChat(note: TFile): Promise<void> {
    const session = await this.getOrCreateActiveSession();
    this.drafts.addContextNote(session.chatInputId, note);
  }

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

  private resolveSessionCwd(projectId: ProjectScopeId): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    return resolveScopeCwd(adapter.getBasePath(), projectId);
  }

  private beginContextMaterialization(
    projectId: ProjectScopeId,
    cwd: string,
    forceRetryFailed?: boolean,
    revisionKey?: string
  ): Promise<ContextMaterializationResult> {
    const counts: {
      resolved?: number;
      prefetch?: ContextLoadStepCount;
      parsed?: ContextLoadStepCount;
    } = {};
    let failedSources: FailedItem[] = [];
    let processingSources: AgentInFlightSource[] = [];
    let stepPhase: "resolve" | "prefetch" | "parse" = "resolve";

    const prior = settingsStore.get(agentProjectContextLoadAtom)[projectId];
    const ownsPublish = !prior?.blocking;

    if (ownsPublish) {
      this.setContextLoadState(projectId, { phase: "resolve", blocking: true });
    }

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

  private setContextLoadState(projectId: string, state: AgentProjectContextLoadState): void {
    settingsStore.set(agentProjectContextLoadAtom, (prev) => ({ ...prev, [projectId]: state }));
  }

  rematerializeContext(projectId: ProjectScopeId): boolean {
    if (projectId === GLOBAL_SCOPE) return false;
    if (settingsStore.get(agentProjectContextLoadAtom)[projectId]?.blocking) return false;
    let cwd: string;
    try {
      cwd = this.resolveSessionCwd(projectId);
    } catch (err) {
      this.setContextLoadState(projectId, {
        phase: "done",
        blocking: false,
        failedSources: [{ path: "Project context", type: "nonMd", error: err2String(err) }],
      });
      return false;
    }
    void this.beginContextMaterialization(
      projectId,
      cwd,
      true,
      this.currentContextRevisionKey(projectId)
    );
    return true;
  }

  async rematerializeSource(
    projectId: ProjectScopeId,
    item: { kind: MaterializedSourceType; source: string }
  ): Promise<boolean> {
    if (projectId === GLOBAL_SCOPE) return false;
    const before = settingsStore.get(agentProjectContextLoadAtom)[projectId];
    if (before?.blocking) return false;

    const matchesItem = (f: FailedItem) =>
      f.path === item.source && (item.kind === "file" ? f.type === "nonMd" : f.type === item.kind);
    const sameSource = (r: { kind: MaterializedSourceType; source: string }) =>
      r.kind === item.kind && r.source === item.source;

    const beforeRetrying = before?.retryingSources ?? [];
    if (beforeRetrying.some(sameSource)) return false;

    this.setContextLoadState(projectId, {
      ...(before ?? { phase: "done" as const }),
      blocking: false,
      failedSources: (before?.failedSources ?? []).filter((f) => !matchesItem(f)),
      retryingSources: [...beforeRetrying, item],
    });

    const failures = await materializeProjectContextSource(this.app, projectId, item);

    const prev = settingsStore.get(agentProjectContextLoadAtom)[projectId];
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

  async refreshAgents(): Promise<void> {
    const files = this.opts.agentFileManager;
    if (!files) return;
    let agents: readonly CustomAgent[];
    try {
      agents = (await files.listAgents()).map((record) => record.agent);
    } catch (error) {
      logWarn("[Agents] Could not list agents", error);
      return;
    }
    const entries: readonly AgentEntry[] =
      agents.length === 0
        ? BUILTIN_ONLY_AGENT_ENTRIES
        : [BUILTIN_AGENT, ...agents.map(toAgentEntry)];
    const unchanged =
      entries.length === this.agentEntries.length &&
      entries.every((entry, i) => {
        const before = this.agentEntries[i];
        return (
          entry.slug === before.slug &&
          entry.name === before.name &&
          entry.icon === before.icon &&
          entry.description === before.description
        );
      });
    this.agentRoster = agents.length === 0 ? EMPTY_CUSTOM_AGENTS : agents;
    if (unchanged) return;
    this.agentEntries = entries;
    if (!entries.some((entry) => entry.slug === this.selectedAgentSlug)) {
      this.selectedAgentSlug = BUILTIN_AGENT_SLUG;
    }
    this.notify();
  }

  getAgentEntries(): readonly AgentEntry[] {
    return this.agentEntries;
  }

  getSelectedAgentSlug(): string {
    return this.selectedAgentSlug;
  }

  async setSelectedAgent(slug: string): Promise<void> {
    this.selectedAgentSlug = slug || BUILTIN_AGENT_SLUG;
    const agent = await this.resolveSessionAgent(this.selectedAgentSlug);
    for (const session of this.sessions.values()) {
      if (session.getStatus() === "closed") continue;
      if (session.hasUserVisibleMessages()) continue;
      session.setAgent(agent);
    }
    this.notify();
  }

  private async bindSessionAgent(
    slug: string | null | undefined
  ): Promise<{ agent: SessionAgent; source: CustomAgent | null }> {
    if (!slug || slug === BUILTIN_AGENT_SLUG) return { agent: COPILOT_SESSION_AGENT, source: null };
    const files = this.opts.agentFileManager;
    if (!files) return { agent: missingSessionAgent(slug), source: null };
    try {
      const record = await files.readAgent(slug);
      if (!record) return { agent: missingSessionAgent(slug), source: null };
      return { agent: await loadSessionAgent(files, record.agent), source: record.agent };
    } catch (error) {
      logWarn(`[Agents] Could not read agent "${slug}"`, error);
      return { agent: missingSessionAgent(slug), source: null };
    }
  }

  private async resolveSessionAgent(slug: string | null | undefined): Promise<SessionAgent> {
    return (await this.bindSessionAgent(slug)).agent;
  }

  getActiveProjectId(): ProjectScopeId {
    return this.activeProjectId;
  }

  getSessionsForScope(projectId: ProjectScopeId): AgentSession[] {
    const scoped: AgentSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (this.detachedFromTabIds.has(session.internalId)) continue;
      scoped.push(session);
    }
    return scoped.length === 0 ? EMPTY_SESSIONS : scoped;
  }

  private getSessionIdsForScope(projectId: ProjectScopeId): string[] {
    const ids: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (this.detachedFromTabIds.has(session.internalId)) continue;
      ids.push(session.internalId);
    }
    return ids;
  }

  async enterProject(projectId: ProjectScopeId): Promise<void> {
    if (this.disposed) return;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice("This project no longer exists. Restore it to open its chats.");
      return;
    }
    const current = this.getActiveSession();
    if (
      projectId === this.activeProjectId &&
      current &&
      current.projectId === projectId &&
      current.getStatus() !== "closed"
    ) {
      return;
    }

    const previousActiveProjectId = this.activeProjectId;
    const previousActiveSessionId = this.activeSessionId;
    const scopeSeq = this.setActiveScope(projectId);

    if (projectId !== GLOBAL_SCOPE) {
      this.contentTracker.flushNow();
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

    this.activeSessionId = null;
    this.notify();
    await this.getOrCreateActiveSession();
    this.touchProjectUsage(projectId);
  }

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

  private pickReusableLandingSession(projectId: ProjectScopeId): AgentSession | null {
    const expected = this.currentLandingCaptureSignature(projectId);
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

  private isReusableLandingShell(session: AgentSession, projectId: ProjectScopeId): boolean {
    return (
      session.projectId === projectId &&
      (session.getStatus() === "idle" || session.getStatus() === "starting") &&
      !session.hasUserVisibleMessages()
    );
  }

  private currentLandingCaptureSignature(projectId: ProjectScopeId): string | null {
    if (projectId === GLOBAL_SCOPE) return null;
    const record = getCachedProjectRecordById(projectId);
    return record ? getProjectLandingCaptureSignature(this.app, record) : null;
  }

  private async ensureScopeInstructions(
    projectId: ProjectScopeId,
    record: ProjectFileRecord | undefined
  ): Promise<void> {
    if (projectId === GLOBAL_SCOPE) {
      await ensureAgentsFileForDiscovery(this.app, "");
      return;
    }
    if (!record) return;
    await ensureAgentsFileForDiscovery(this.app, "");
    await moveProjectPromptToAgentsFile(this.app, record);
    await ensureAgentsFileForDiscovery(
      this.app,
      getProjectAnchorFromConfigPath(record.filePath).projectFolderPath
    );
  }

  private touchProjectUsage(projectId: ProjectScopeId): void {
    if (this.disposed || projectId === GLOBAL_SCOPE || this.activeProjectId !== projectId) return;
    void ProjectFileManager.getInstance(this.app).touchProjectLastUsed(projectId);
  }

  async exitProject(): Promise<void> {
    await this.enterProject(GLOBAL_SCOPE);
  }

  private parkActiveScope(): void {
    const active = this.getActiveSession();
    if (active && active.getStatus() !== "closed") {
      this.lastActiveByScope.set(active.projectId, active.internalId);
    }
  }

  private restoreScopeActiveSession(projectId: ProjectScopeId): AgentSession | null {
    const mruId = this.lastActiveByScope.get(projectId);
    if (mruId) {
      const mru = this.sessions.get(mruId);
      if (mru && mru.getStatus() !== "closed") return mru;
    }
    const scoped = this.getSessionsForScope(projectId);
    return scoped.length > 0 ? scoped[scoped.length - 1] : null;
  }

  private setActiveScope(projectId: ProjectScopeId): number {
    if (projectId === this.activeProjectId) return this.scopeSeq;
    this.parkActiveScope();
    this.activeProjectId = projectId;
    return ++this.scopeSeq;
  }

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

  getDefaultSelection(backendId: BackendId): ModelSelection | null {
    const backends = getSettings().agentMode?.backends as
      | Record<string, { defaultModel?: ModelSelection | null } | undefined>
      | undefined;
    return backends?.[backendId]?.defaultModel ?? null;
  }

  /**
   * A carried selection wins, then the saved default, then the first enabled model with
   * credentials; the saved preference itself is never rewritten.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/474
   * https://github.com/logancyang/obsidian-copilot/issues/3319
   */
  getSeedSelection(backendId: BackendId, preferred?: ModelSelection | null): ModelSelection | null {
    const saved = this.getDefaultSelection(backendId);
    const descriptor = this.opts.resolveDescriptor(backendId);
    const offered = descriptor?.getEnabledModelEntries?.(getSettings());
    const requested = preferred ?? saved;
    // A missing accessor cannot validate agent-native models. An empty list is
    // authoritative because it can mean the user just disabled the last model.
    // https://github.com/logancyang/obsidian-copilot/issues/3319
    if (!offered) return requested;

    const runnable = offered.filter((entry) => entry.credentialState === "ok");
    // A backend that may only run enabled models has no agent default to fall back to.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/625
    if (!requested && descriptor?.routesCopilotModels !== true) return null;

    const resolved =
      [preferred, saved].find(
        (selection): selection is ModelSelection =>
          !!selection && runnable.some((entry) => entry.baseModelId === selection.baseModelId)
      ) ?? (runnable[0] ? { baseModelId: runnable[0].baseModelId, effort: null } : null);
    if (requested && resolved?.baseModelId !== requested.baseModelId) {
      const replacementName = runnable.find(
        (entry) => entry.baseModelId === resolved?.baseModelId
      )?.name;
      this.warnSelectionNotRunnable(backendId, requested.baseModelId, replacementName);
    }
    return resolved;
  }

  private warnSelectionNotRunnable(
    backendId: BackendId,
    baseModelId: string,
    replacementName?: string
  ): void {
    const key = `${backendId}:${baseModelId}`;
    if (this.warnedUnavailableModels.has(key)) return;
    this.warnedUnavailableModels.add(key);
    const agent = this.resolveDescriptor(backendId).displayName;
    const model = baseModelId.split("/").pop() || baseModelId;
    logInfo(`[AgentMode] ${backendId} cannot start a chat on ${baseModelId}`);
    new Notice(
      replacementName
        ? `${agent} couldn't use ${model}. Using ${replacementName} instead.`
        : `${agent} couldn't use ${model}. Enable a model ${agent} can run.`
    );
  }

  private repairDefaultEffort(backendId: BackendId, state: BackendState | null): void {
    const saved = this.getDefaultSelection(backendId);
    const model = state?.model;
    if (!saved || model?.current.baseModelId !== saved.baseModelId) return;
    const options = model.availableModels.find(
      (entry) => entry.baseModelId === saved.baseModelId
    )?.effortOptions;
    const effort = resolveEffort(saved.effort, options);
    // Repair the durable preference as well as the session so future chats do
    // not repeatedly request a removed effort. Read the current saved value to
    // preserve valid settings edits made during startup.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
    if (effort !== saved.effort && effort === model.current.effort) {
      void this.persistDefaultSelection(backendId, { ...saved, effort }).catch((err) =>
        logWarn("Failed to save repaired agent effort", err)
      );
    }
  }

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
    this.repairDefaultEffort(session.backendId, session.getState());
  }

  async applyMode(backendId: BackendId, mode: CopilotMode, spec: ModeApplySpec): Promise<void> {
    const session = this.getActiveSession();
    if (!session || session.backendId !== backendId) return;
    const latestMapping = this.resolveDescriptor(backendId).getModeMapping?.(null, null);
    const latestNativeId =
      latestMapping?.kind === "setMode" ? latestMapping.canonical[mode] : undefined;
    const resolvedSpec: ModeApplySpec = latestNativeId
      ? { kind: "setMode", nativeId: latestNativeId }
      : spec;
    await applyModeSpec(session, resolvedSpec);
    await this.persistDefaultMode(backendId, mode);
  }

  getDefaultMode(backendId: BackendId): CopilotMode | null {
    const backends = getSettings().agentMode?.backends as
      | Record<string, { defaultMode?: CopilotMode | null } | undefined>
      | undefined;
    return backends?.[backendId]?.defaultMode ?? null;
  }

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
      // The chat's Reload action reports a queued restart as in progress, so
      // publish the queue entry rather than leaving the button looking inert.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
      this.notify();
      return true;
    }
    await this.restartBackendNow(backendId, reason, options?.deferWhileBusy === false);
    return true;
  }

  /**
   * A running process keeps its spawn config, so the change is held while a session exists to
   * lose and offered as a Reload. Callers that must apply now call `restartBackend` directly.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/475
   */
  async noteSpawnConfigChanged(backendId: BackendId, reason: string): Promise<void> {
    if (this.disposed) return;
    const inflight = this.starting.get(backendId);
    if (inflight) await inflight.catch(() => undefined);
    if (this.disposed) return;
    if (!this.hasSessionOn(backendId)) {
      await this.restartBackend(backendId, reason);
      return;
    }
    const prev = this.heldConfigChanges.get(backendId);
    this.heldConfigChanges.set(backendId, prev ? `${prev}; ${reason}` : reason);
    logInfo(`[AgentMode] holding ${backendId} backend restart: ${reason}`);
    if (prev === undefined) this.notify();
  }

  hasHeldConfigChange(backendId: BackendId): boolean {
    return this.heldConfigChanges.has(backendId);
  }

  /**
   * Lets the Reload action show progress while the restart is queued behind a turn.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/475
   */
  isBackendRestartPending(backendId: BackendId): boolean {
    return this.restartingBackends.has(backendId) || this.pendingBackendRestarts.has(backendId);
  }

  /**
   * The Reload action: performs the restart `noteSpawnConfigChanged` declined to do.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/475
   */
  async applyHeldConfigChange(backendId: BackendId): Promise<void> {
    const reason = this.heldConfigChanges.get(backendId);
    if (reason === undefined) return;
    await this.restartBackend(backendId, reason);
  }

  private hasSessionOn(backendId: BackendId): boolean {
    return Array.from(this.sessions.values()).some((s) => s.backendId === backendId);
  }

  async onInstallStateChanged(backendId: BackendId): Promise<void> {
    if (this.disposed) return;
    const installState = this.opts.resolveDescriptor(backendId)?.getInstallState(getSettings());
    if (installState?.kind === "checking") return;
    if (installState?.kind !== "ready") {
      await this.restartBackend(backendId, "binary no longer available");
      this.preloader.clearCached(backendId);
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

  private refreshWarmProbe(backendId: BackendId, reason: string): boolean {
    if (this.disposed) return false;
    if (!this.isBackendInstalled(backendId)) return false;
    const probe = this.preloader.refresh(backendId);
    if (!probe) return false;
    logInfo(`[AgentMode] refreshing warm ${backendId} probe: ${reason}`);
    this.registerPreload(backendId, probe);
    return true;
  }

  private isBackendInstalled(backendId: BackendId): boolean {
    const descriptor = this.opts.resolveDescriptor(backendId);
    return descriptor?.getInstallState(getSettings())?.kind === "ready";
  }

  getCachedModelCatalog(backendId: BackendId): BackendModelCatalog | null {
    return this.preloader.getCachedModelCatalog(backendId);
  }

  getEffortCatalog(backendId: BackendId): Record<string, EffortOption[]> | null {
    return this.preloader.getEffortCatalog(backendId);
  }

  subscribeModelCache(listener: () => void): () => void {
    return this.preloader.subscribe(listener);
  }

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

  preloadModels(backendId: BackendId): Promise<void> {
    return this.preloader.preload(backendId);
  }

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

  isPreloadReady(backendId?: BackendId): boolean {
    const id = backendId ?? getSettings().agentMode?.activeBackend;
    if (!id) return true;
    const status = this.preloadStatus.get(id);
    return status === undefined || status === "ready" || status === "error";
  }

  getPreloadStatus(backendId: BackendId): "pending" | "ready" | "error" | "absent" {
    return this.preloadStatus.get(backendId) ?? "absent";
  }

  async closeSession(id: string, options?: { releaseBackend: boolean }): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    const closedScope = session.projectId;
    const scopeIdsBefore = this.getSessionIdsForScope(closedScope);
    const closedIdx = scopeIdsBefore.indexOf(id);
    // User-requested release must block new sends before cancellation and saving.
    // Internal teardown also works when the whole backend is being restarted.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/429
    if (options?.releaseBackend) {
      await session.releaseBackendSession();
    } else {
      try {
        await session.cancel();
      } catch (e) {
        logWarn(`[AgentMode] cancel during closeSession failed`, e);
      }
    }
    await this.drainAutoSave(session);
    try {
      await session.dispose();
    } catch (e) {
      logWarn(`[AgentMode] dispose during closeSession failed`, e);
    }
    this.detachAutoSave(id);
    this.sessions.delete(id);
    this.chatUIStates.delete(id);
    this.landingCaptureSignatures.delete(id);
    this.lastSeenProjectContentEpochBySession.delete(id);
    this.detachedFromTabIds.delete(id);
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
    }
    this.notify();
  }

  setActiveSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (this.activeSessionId === id) return;
    if (session.projectId !== this.activeProjectId) {
      this.setActiveScope(session.projectId);
    }
    this.detachedFromTabIds.delete(id);
    this.activeSessionId = id;
    this.lastActiveByScope.set(session.projectId, id);
    session.clearNeedsAttention();
    this.notify();
  }

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
    const replaced = this.sessions.get(oldId);
    const replacedProjectId = replaced?.projectId ?? this.activeProjectId;
    const chatInputId = options.preserveChatInput ? replaced?.chatInputId : undefined;
    const created = await this.createSession(
      backendId,
      replacedProjectId,
      options.seedSelection,
      chatInputId,
      replaced?.getAgent()
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

  renameSession(id: string, label: string | null): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.setLabel(label);
    this.notify();
  }

  getIsStarting(): boolean {
    return this.startingBackendId !== null;
  }

  getStartingBackendId(): BackendId | null {
    return this.startingBackendId;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getSession(id: string): AgentSession | null {
    return this.sessions.get(id) ?? null;
  }

  getSessionByBackendId(backendSessionId: string): AgentSession | null {
    for (const session of this.sessions.values()) {
      if (session.getBackendSessionId() === backendSessionId) return session;
    }
    return null;
  }

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

  getSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Prune composer drafts against this rather than `getSessions()`, which omits tabs
   * mid-replacement during a backend restart.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/473
   */
  getLiveChatInputIds(): readonly string[] {
    const ids = new Set(this.retainedChatInputIds);
    for (const session of this.sessions.values()) ids.add(session.chatInputId);
    return ids.size === 0 ? EMPTY_CHAT_INPUT_IDS : Array.from(ids);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.drafts.prune();
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logError("[AgentMode] manager listener threw", e);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.settingsUnsub();
    this.projectRecordsUnsubscriber?.();
    this.projectRecordsUnsubscriber = undefined;
    this.contentTrackerUnsubscribe?.();
    this.contentTrackerUnsubscribe = undefined;
    this.contentTracker.dispose();
    logInfo(
      `[AgentMode] shutdown (pool size=${this.sessions.size}, backends=${this.backends.size})`
    );

    const allSessions = Array.from(this.sessions.values());
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
    await this.opts.sessionIndex?.flush();
  }

  async loadSessionFromHistory(file: TFile): Promise<AgentSession> {
    if (!this.opts.persistenceManager) {
      throw new Error("Agent chat persistence is not configured.");
    }
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const requestId = ++this.latestHistoryLoadRequestId;

    for (const [internalId, state] of this.sessionState.entries()) {
      if (this.getSessionSourcePath(internalId) !== file.path) continue;
      const existing = this.sessions.get(internalId);
      if (existing && existing.getStatus() !== "closed") {
        this.setActiveSession(internalId);
        return existing;
      }
      state.source = undefined;
    }

    const previousActiveId = this.activeSessionId;

    const loaded = await this.opts.persistenceManager.loadFile(file);
    const projectId = loaded.projectId;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice("This chat belongs to a project that no longer exists.");
      throw new OrphanedProjectError(projectId);
    }
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);

    const agent = await this.resolveSessionAgent(loaded.agentSlug);
    let session: AgentSession;
    try {
      const resumed = loaded.sessionId
        ? await this.tryResumeSessionFromHistory(loaded.backendId, loaded.sessionId, projectId)
        : null;
      session =
        resumed ??
        (await this.createSession(loaded.backendId, projectId, undefined, undefined, agent));
    } catch (err) {
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw err;
    }

    session.setAgent(agent);
    session.loadDisplayMessages(loaded.messages);
    session.seedSessionUsage(loaded.usage);
    if (loaded.label) session.setLabel(loaded.label);
    this.getSessionState(session.internalId).source = file;
    if (loaded.sessionId) {
      void this.opts.sessionIndex?.touch(loaded.backendId, loaded.sessionId);
    }
    if (requestId === this.latestHistoryLoadRequestId) {
      this.setActiveSession(session.internalId);
      this.absorbIntoEmptyActiveTab(session, previousActiveId);
      this.notify();
    }
    return session;
  }

  private absorbIntoEmptyActiveTab(loaded: AgentSession, previousActiveId: string | null): void {
    if (!previousActiveId || previousActiveId === loaded.internalId) return;
    const previous = this.sessions.get(previousActiveId);
    if (!previous || previous.hasUserVisibleMessages()) return;
    const oldIdx = Array.from(this.sessions.keys()).indexOf(previousActiveId);
    if (oldIdx >= 0) {
      this.moveMapEntry(this.sessions, loaded.internalId, oldIdx);
      this.moveMapEntry(this.chatUIStates, loaded.internalId, oldIdx);
    }
    void this.closeSession(previousActiveId).catch((e) =>
      logWarn(`[AgentMode] closing empty tab during history load failed`, e)
    );
  }

  async loadNativeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const requestId = ++this.latestHistoryLoadRequestId;
    const existing = this.findLiveSession(backendId, sessionId);
    if (existing) {
      this.setActiveSession(existing.internalId);
      return existing;
    }
    const previousActiveId = this.activeSessionId;
    const index = this.opts.sessionIndex;
    const entry = index ? await index.getEntry(backendId, sessionId) : null;
    const projectId: ProjectScopeId = entry?.projectId ?? GLOBAL_SCOPE;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice("This chat belongs to a project that no longer exists.");
      throw new OrphanedProjectError(projectId);
    }
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);
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
    await this.hydrateResumedTranscript(session, backendId, sessionId);
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

  private async hydrateResumedTranscript(
    session: AgentSession,
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<void> {
    const proc = this.backends.get(backendId);
    if (!proc?.readPersistedTranscript) return;
    if (session.store.getDisplayMessages().length > 0) return;
    try {
      const transcript = await proc.readPersistedTranscript({
        sessionId,
        cwd: this.resolveSessionCwd(session.projectId),
      });
      if (transcript.length > 0) session.loadDisplayMessages(transcript);
    } catch (e) {
      logWarn(`[AgentMode] could not hydrate transcript for ${sessionId}`, e);
    }
  }

  private async tryResumeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId,
    projectId: ProjectScopeId,
    chatInputId?: string,
    seedSelection?: ModelSelection
  ): Promise<AgentSession | null> {
    const existing = this.findLiveSession(backendId, sessionId);
    if (existing) return existing;

    const key = buildNativeChatId(backendId, sessionId);
    const inFlight = this.resumedSessionPromiseById.get(key);
    if (inFlight) return inFlight;

    const resume = this.resumeSessionFromHistory(
      backendId,
      sessionId,
      projectId,
      chatInputId,
      seedSelection
    ).finally(() => {
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
    projectId: ProjectScopeId,
    chatInputId?: string,
    seedSelection?: ModelSelection
  ): Promise<AgentSession | null> {
    await this.ensureScopeInstructions(
      projectId,
      projectId === GLOBAL_SCOPE ? undefined : getCachedProjectRecordById(projectId)
    );
    const cwd = this.resolveSessionCwd(projectId);
    if (projectId !== GLOBAL_SCOPE) this.contentTracker.flushNow();
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

    const additionalDirectories = contextReady
      ? (await contextReady).additionalDirectories
      : undefined;
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
      chatInputId,
      backendId,
      projectId,
      initialState: resumeResult.state,
      defaultModelSelection: seedSelection,
      defaultMode: this.getDefaultMode(backendId),
      cwd,
      getDescriptor: () => this.opts.resolveDescriptor(backendId),
      runFanoutTurn: (input) => this.runFanoutTurn(input),
      getDisplayName: (id) => this.resolveDescriptor(id).displayName,
      getApp: () => this.app,
      ...(projectId !== GLOBAL_SCOPE
        ? {
            getProjectContextUpdates: () => this.getProjectContextUpdates(internalId, projectId),
            markProjectContextUpdatesDelivered: (epoch: number) =>
              this.markProjectContextUpdatesDelivered(internalId, epoch),
          }
        : {}),
    });

    // Apply the seed before replaying backend-specific startup config.
    // https://github.com/logancyang/obsidian-copilot/issues/3319
    await session.ready;

    if (resumeResult.transcript?.length) {
      session.loadDisplayMessages(resumeResult.transcript);
    }

    if (descriptor.applyInitialSessionConfig) {
      try {
        await descriptor.applyInitialSessionConfig(session, getSettings(), seedSelection);
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
    const state = this.getSessionState(session.internalId);
    // Manual Save opts this chat into keeping its note current.
    // https://github.com/logancyang/obsidian-copilot/issues/3225
    if (!getSettings().autosaveChat && !state.source) return;
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

  private async flushIndexTouch(session: AgentSession): Promise<void> {
    const index = this.opts.sessionIndex;
    if (!index) return;
    if (!this.sessions.has(session.internalId)) return;
    const sessionId = session.getBackendSessionId();
    if (!sessionId) return;
    const messages = session.store.getDisplayMessages();
    if (messages.length === 0) return;
    const now = Date.now();
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
      projectId: session.projectId === GLOBAL_SCOPE ? undefined : session.projectId,
    });
  }

  async saveActiveSession(): Promise<{ path: string } | null> {
    const session = this.getActiveSession();
    if (!session) return null;
    const state = this.sessionState.get(session.internalId);
    if (state?.timer) {
      window.clearTimeout(state.timer);
      state.timer = undefined;
    }
    const result = await this.flushAutoSave(session);
    this.scheduleAutoSave(session);
    return result;
  }

  getSessionSourcePath(internalId: string): string {
    const state = this.sessionState.get(internalId);
    return state?.source?.path ?? "";
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
    const last = messages[messages.length - 1];
    const fanoutSig = last?.fanout
      ? Object.values(last.fanout.answers)
          .map((a) => `${a.status}:${a.text.length}`)
          .join(",") + `|${last.fanout.summary.status}:${last.fanout.summary.text.length}`
      : "";
    const signature = `${label ?? ""}-${sessionId ?? ""}-${messages.length}-${
      last?.message ?? ""
    }-${fanoutSig}-${usage?.updatedAt ?? ""}`;
    const state = this.getSessionState(session.internalId);
    if (state.signature === signature) {
      return state.source ?? null;
    }

    const previousSourcePath = this.getSessionSourcePath(session.internalId);
    const result = await persistence.saveSession(messages, session.backendId, {
      label,
      existingPath: this.getSessionSourcePath(session.internalId) || undefined,
      sessionId,
      projectId: session.projectId,
      usage: usage ?? undefined,
      // Null for the built-in Copilot, which writes no frontmatter field.
      agentSlug: session.getAgent().slug,
    });
    if (result) {
      state.source = this.app.vault.getAbstractFileByPath(result.path) ?? result;
      state.signature = signature;
      // The first successful save changes relative-link resolution in the mounted chat.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/539
      if (previousSourcePath !== result.path) this.notify();
    }
    return result;
  }

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
        if (wasRunning !== isRunning) this.notify();
      },
    });
    this.getSessionState(session.internalId).attentionUnsub = unsubscribe;
  }

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

  private signalSessionNeedsAttention(session: AgentSession): void {
    // The dot identifies a different Agent tab that wants the user; keyboard
    // focus does not change which tab is selected. https://github.com/logancyang/obsidian-copilot/issues/2987
    if (this.activeSessionId !== session.internalId) session.markNeedsAttention();
    // Sound follows real focus so a selected but unattended chat can still
    // call the user back. https://github.com/logancyang/obsidian-copilot/issues/2987
    if (this.isSessionFocused(session)) return;
    this.playConfiguredNotificationSound();
  }

  private playConfiguredNotificationSound(): void {
    const { notificationSound, notificationSoundId } = getSettings().agentMode;
    if (!notificationSound) return;
    playNotificationSound(notificationSoundId);
  }

  private wireProcessCallbacks(backendId: BackendId, proc: BackendProcess): void {
    proc.setPermissionPrompter(this.opts.permissionPrompter);
    proc.setUnhealthyHandler?.(() => {
      if (this.disposed || this.backends.get(backendId) !== proc) return;
      // The rejected turn must finish writing its error before replacement.
      // restartBackend defers while that session is running.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/561
      void this.restartBackend(backendId, "internal service stopped").catch((err) => {
        this.setLastError(err2String(err));
        logError(`[AgentMode] ${backendId} internal service restart failed`, err);
      });
    });
    if (this.opts.askUserQuestionPrompter) {
      proc.setAskUserQuestionPrompter?.(this.opts.askUserQuestionPrompter);
    }
    proc.setReadOnlySessionPredicate?.((sessionId) => this.isReadOnlyFanoutSession(sessionId));
  }

  private async ensureBackend(
    backendId: BackendId,
    descriptor: BackendDescriptor
  ): Promise<BackendProcess> {
    await this.opts.beforeBackendStart?.(backendId);
    if (this.disposed) throw new Error("AgentSessionManager has been shut down");
    const existing = this.backends.get(backendId);
    if (existing && existing.isRunning()) return existing;
    const inflight = this.starting.get(backendId);
    if (inflight) return inflight;
    const startPromise = (async () => {
      if (!this.isPreloadReady(backendId)) {
        await this.preloader.preload(backendId);
      }

      const warm = this.preloader.takeWarm(backendId);
      if (warm) {
        this.wireProcessCallbacks(backendId, warm.proc);
        this.installBackendExitHandler(backendId, warm.proc, descriptor);
        this.backends.set(backendId, warm.proc);
        return warm.proc;
      }

      // Validate the selected installation only when launching it. A running
      // process keeps its version when settings select a different executable.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/531
      const installState = descriptor.getInstallState(getSettings());
      if (installState.kind === "incompatible") throw new Error(installState.message);

      const proc = descriptor.createBackendProcess({
        plugin: this.plugin,
        app: this.app,
        clientVersion: this.plugin.manifest.version,
        descriptor,
      });
      if (proc.start) await proc.start();
      this.wireProcessCallbacks(backendId, proc);
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

  private installBackendExitHandler(
    backendId: BackendId,
    proc: BackendProcess,
    descriptor: BackendDescriptor
  ): void {
    proc.onExit(() => {
      if (this.backends.get(backendId) === proc) {
        this.backends.delete(backendId);
        // Retry spawns from current settings; a dead generation has no config left to apply.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
        this.heldConfigChanges.delete(backendId);
      }
      const dead = Array.from(this.sessions.values()).filter((s) => s.backendId === backendId);
      if (dead.length === 0) return;
      for (const s of dead) {
        this.detachAutoSave(s.internalId);
        this.sessions.delete(s.internalId);
        this.chatUIStates.delete(s.internalId);
        this.landingCaptureSignatures.delete(s.internalId);
        this.lastSeenProjectContentEpochBySession.delete(s.internalId);
        this.detachedFromTabIds.delete(s.internalId);
        if (this.lastActiveByScope.get(s.projectId) === s.internalId) {
          this.lastActiveByScope.delete(s.projectId);
        }
        s.cancel().catch(() => {});
        s.dispose().catch(() => {});
      }
      if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) {
        let next: AgentSession | undefined;
        for (const s of this.sessions.values()) {
          if (!this.detachedFromTabIds.has(s.internalId)) {
            next = s;
            break;
          }
        }
        this.activeSessionId = next?.internalId ?? null;
        if (next) {
          this.activeProjectId = next.projectId;
          this.scopeSeq++;
        }
      }
      this.setLastError(`${descriptor.displayName} backend exited unexpectedly.`);
      this.notify();
    });
  }

  private hasBusySession(backendId: BackendId): boolean {
    return Array.from(this.sessions.values()).some((session) => {
      if (session.backendId !== backendId) return false;
      const status = session.getStatus();
      return status === "starting" || status === "running" || status === "awaiting_permission";
    });
  }

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

  /**
   * A restart kills the process, not the conversation: resume through the backend's own store,
   * falling back to a fresh session when there is nothing to resume.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/475
   */
  private async rebuildReplacedSession(
    backendId: BackendId,
    projectId: ProjectScopeId,
    chatInputId: string | undefined,
    resumableSessionId: SessionId | undefined,
    label: string | null,
    labelSource: "user" | "agent" | null,
    agent: SessionAgent,
    carriedSelection?: ModelSelection
  ): Promise<AgentSession> {
    // A model-setting change can trigger this restart, so validate the carried
    // selection before seeding either the resumed or the fallback session.
    // https://github.com/logancyang/obsidian-copilot/issues/3319
    const seedSelection = carriedSelection
      ? (this.getSeedSelection(backendId, carriedSelection) ?? undefined)
      : undefined;
    if (resumableSessionId) {
      const resumed = await this.tryResumeSessionFromHistory(
        backendId,
        resumableSessionId,
        projectId,
        chatInputId,
        seedSelection
      ).catch((e) => {
        logWarn(`[AgentMode] resume after ${backendId} restart failed`, e);
        return null;
      });
      if (resumed) {
        resumed.setAgent(agent);
        await this.hydrateResumedTranscript(resumed, backendId, resumableSessionId);
        if (label && !resumed.getLabel()) resumed.restoreLabel(label, labelSource ?? "agent");
        this.setActiveSession(resumed.internalId);
        return resumed;
      }
    }
    return this.createSession(backendId, projectId, seedSelection, chatInputId, agent);
  }

  private async restartBackendNow(
    backendId: BackendId,
    reason: string,
    immediate = false
  ): Promise<void> {
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
    // Every restart rebuilds spawn config from current settings, so nothing is
    // held once one runs — including restarts this hold never asked for, such
    // as a tightened privacy boundary or a binary that changed underneath.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
    this.heldConfigChanges.delete(backendId);
    logInfo(`[AgentMode] restarting ${backendId} backend: ${reason}`);
    const retainedChatInputIds: string[] = [];
    try {
      const affected = Array.from(this.sessions.values()).filter((s) => s.backendId === backendId);
      const activeSessionId = this.activeSessionId;
      const activeProjectId = this.activeProjectId;
      // Every affected composer must stay owned across the gap, including tabs
      // outside the active scope, or the draft store prunes their unsent text.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
      const replacements = this.isBackendInstalled(backendId)
        ? affected.map((session) => ({
            internalId: session.internalId,
            projectId: session.projectId,
            chatInputId: session.chatInputId,
            resumableSessionId: session.getBackendSessionId() ?? undefined,
            label: session.getLabel(),
            labelSource: session.getLabelSource(),
            // The displayed selection is otherwise lost when the process restarts.
            // https://github.com/logancyang/obsidian-copilot/issues/3319
            seedSelection: session.getState()?.model?.current,
            agent: session.getAgent(),
            detached: this.detachedFromTabIds.has(session.internalId),
            recoveryMessages:
              session.getStatus() === "error" ? session.store.getDisplayMessages() : undefined,
          }))
        : [];
      for (const replacement of replacements) {
        retainedChatInputIds.push(replacement.chatInputId);
        this.retainedChatInputIds.add(replacement.chatInputId);
      }
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
        const probe = this.preloader.preload(backendId);
        this.registerPreload(backendId, probe);
        if (replacements.length > 0 && !this.disposed) {
          await probe;
          let selectedId = activeSessionId;
          for (const replacement of replacements) {
            const rebuilt = await this.rebuildReplacedSession(
              backendId,
              replacement.projectId,
              replacement.chatInputId,
              replacement.resumableSessionId,
              replacement.label,
              replacement.labelSource,
              replacement.agent,
              replacement.seedSelection
            );
            // A fresh fallback has no backend history for these messages;
            // displaying them there would imply the agent can see that context.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/561
            if (
              rebuilt.getBackendSessionId() === replacement.resumableSessionId &&
              replacement.recoveryMessages?.length
            ) {
              rebuilt.loadDisplayMessages(replacement.recoveryMessages);
            }
            if (replacement.detached) this.detachedFromTabIds.add(rebuilt.internalId);
            if (replacement.internalId === activeSessionId) selectedId = rebuilt.internalId;
          }
          if (selectedId) this.setActiveSession(selectedId);
          else {
            this.activeSessionId = null;
            this.activeProjectId = activeProjectId;
          }
        }
      }
    } finally {
      this.restartingBackends.delete(backendId);
      for (const id of retainedChatInputIds) this.retainedChatInputIds.delete(id);
      this.notify();
    }
    const queued = this.pendingBackendRestarts.get(backendId);
    if (queued !== undefined && !this.disposed) {
      this.pendingBackendRestarts.delete(backendId);
      if (!queued.immediate && this.hasBusySession(backendId)) {
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
