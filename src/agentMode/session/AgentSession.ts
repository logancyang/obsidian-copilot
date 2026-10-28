import { AI_SENDER, USER_SENDER } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import {
  AgentChatMessage,
  AgentMcpServer,
  AgentMessagePart,
  AgentToolKind,
  AgentQuestionAnswers,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  CopilotMode,
  CurrentPlan,
  EnabledModelEntry,
  ModelSelection,
  PermissionDecision,
  PermissionPrompt,
  PermissionRequester,
  PlanDecisionAction,
  PromptContent,
  QueuedPrompt,
  SessionEvent,
  SessionId,
  PlanUsage,
  SessionUsage,
  StopReason,
  AgentToolStatus,
  TaskEndStatus,
  TaskStart,
  ToolCallDelta,
  ToolCallSnapshot,
  TurnDiff,
  TurnFileChange,
} from "@/agentMode/session/types";
import { MessageContext } from "@/types/message";
import { err2String, formatDateTime } from "@/utils";
import { ensureMultiAgentEntitlement, showMultiAgentUpgradePrompt } from "@/plusUtils";
import type { App, DataAdapter } from "obsidian";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import {
  diffTargetPaths,
  editTargetPaths,
  isCapturableVaultPath,
  toVaultTargetPath,
  type EditTargetSource,
} from "@/agentMode/session/editTargets";
import {
  buildTurnFileChange,
  filePatchesByVaultPath,
  revertFilePatch,
  type FileCaptures,
} from "@/agentMode/session/turnFileChanges";
import { TurnTracker, type TurnOutcome, type TurnSend } from "@/agentMode/session/TurnTracker";
import { getVaultBase } from "@/utils/vaultPath";
import { deriveChatTitleFromMessages } from "@/agentMode/session/chatHistoryMerge";
import { isCompactCommand } from "@/commands/compactCommand";
import type { FanoutRunInput } from "@/agentMode/session/fanout/FanoutOrchestrator";
import { isFanout } from "@/agentMode/session/fanout/answerers";
import {
  buildConversationHistoryBlock,
  CONVERSATION_HISTORY_MAX_CHARS,
} from "@/agentMode/session/conversationHistory";
import {
  buildPriorFanoutContextBlock,
  isDirectAnswerTurn,
  renderFanoutComposite,
  serializeFanoutComposite,
  type FanoutTurn,
  type PendingFanoutContext,
} from "@/agentMode/session/fanout/fanoutTypes";
import { v4 as uuidv4 } from "uuid";
import { getSettings } from "@/settings/model";
import {
  EMPTY_ENABLED_MODELS,
  ENABLED_MODEL_WAIT_MS,
  noEnabledModelError,
  pickEnabledModel,
} from "@/agentMode/session/enabledModelSelection";
import {
  buildPromptBlocks,
  buildUserMessage,
  extractText,
  OUTPUT_LIMIT_CONTINUATION_PROMPT,
  serializeWebTabContext,
  withReadOnlyPreamble,
} from "@/agentMode/session/promptEnvelope";
import {
  findToolCallPart,
  mergeToolCallUpdate,
  planToPart,
  toolCallToPart,
  tryReadExitPlanModeCall,
  upsertCompactionPart,
} from "@/agentMode/session/messageParts";
import { SessionHistoryReplay } from "@/agentMode/session/SessionHistoryReplay";
import { InteractiveRequests } from "@/agentMode/session/InteractiveRequests";
import { UsageTracker } from "@/agentMode/session/UsageTracker";
import { replayPersistedMode } from "@/agentMode/session/replayPersistedMode";
import type { FeedbackDraft, FeedbackOfferResult } from "@/agentMode/session/copilotMcpServer";
import type {
  FeedbackEvidence,
  FeedbackOffer,
  FeedbackOfferTrigger,
} from "@/agentMode/session/feedback/feedbackOffer";

export type RunFanoutTurn = (input: FanoutRunInput) => Promise<FanoutTurn>;

export const DEFAULT_TITLE_PREFIX = "New session";
const EMPTY_BACKEND_IDS: ReadonlyArray<BackendId> = Object.freeze([]);
const EMPTY_TASKS: readonly AgentTask[] = Object.freeze([]);
const EMPTY_MESSAGES: readonly AgentChatMessage[] = Object.freeze([]);
const EMPTY_TOOL_CALL_IDS: ReadonlySet<string> = new Set();
const LAUNCH_CARD_STATUS: Record<TaskEndStatus, AgentToolStatus> = {
  completed: "completed",
  failed: "failed",
  stopped: "cancelled",
};
const UNSTARTED_TASK_END: Partial<Record<AgentToolStatus, TaskEndStatus>> = {
  completed: "completed",
  failed: "failed",
  cancelled: "stopped",
};

export interface AgentTask extends TaskStart {
  status: "running" | TaskEndStatus;
  model?: string;
  outputFile?: string;
  summary?: string;
}

function isTaskLifecycleUpdate(update: SessionEvent["update"]): boolean {
  return (
    update.sessionUpdate === "task_started" ||
    update.sessionUpdate === "task_progress" ||
    update.sessionUpdate === "task_ended"
  );
}

function toolCallTarget(call: ToolCallSnapshot | ToolCallDelta): EditTargetSource {
  return {
    locations: call.locations,
    input: call.rawInput,
    diffPaths: diffTargetPaths(call.content),
  };
}

async function readVaultText(adapter: DataAdapter, path: string): Promise<string | null> {
  try {
    return await adapter.read(path);
  } catch {
    return null;
  }
}

export type AgentSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

export const ATTENTION_TRIGGER_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "idle",
  "error",
  "awaiting_permission",
]);

export interface AgentSessionListener {
  onMessagesChanged(): void;
  onStatusChanged(status: AgentSessionStatus): void;
  onModelChanged?(): void;
  onLabelChanged?(): void;
  onCurrentPlanChanged?(): void;
  onCurrentTodoListChanged?(): void;
  onNeedsAttentionChanged?(needsAttention: boolean): void;
  onTasksChanged?(): void;
  onQueuedPromptsChanged?(): void;
  onDisconnected?(): void;
}

export interface ProjectContextUpdates {
  epoch: number;
  block: string;
}

export interface ProjectContextUpdatesHooks {
  getProjectContextUpdates?: () => ProjectContextUpdates | null;
  markProjectContextUpdatesDelivered?: (epoch: number) => void;
}

export interface AgentSessionStartOptions extends ProjectContextUpdatesHooks {
  backend: BackendProcess;
  cwd: string;
  internalId: string;
  chatInputId?: string;
  backendId: BackendId;
  projectId?: ProjectScopeId;
  defaultModelSelection?: ModelSelection;
  defaultMode?: CopilotMode | null;
  getDescriptor?: () => BackendDescriptor | undefined;
  runFanoutTurn?: RunFanoutTurn;
  getDisplayName?: (backendId: BackendId) => string;
  getApp?: () => App;
  getProjectContextBlock?: () => string;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
}

export interface AgentSessionStateOptions extends ProjectContextUpdatesHooks {
  backend: BackendProcess;
  backendSessionId: SessionId;
  internalId: string;
  chatInputId?: string;
  backendId: BackendId;
  projectId?: ProjectScopeId;
  defaultModelSelection?: ModelSelection;
  defaultMode?: CopilotMode | null;
  cwd?: string | null;
  getDescriptor?: () => BackendDescriptor | undefined;
  runFanoutTurn?: RunFanoutTurn;
  getDisplayName?: (backendId: BackendId) => string;
  getApp?: () => App;
}

export class AgentSession {
  readonly store = new AgentMessageStore();
  readonly internalId: string;
  readonly chatInputId: string;
  readonly backendId: BackendId;
  readonly planFeedbackDelivery: "permission" | "next_turn";
  readonly projectId: ProjectScopeId;
  readonly ready: Promise<void>;
  private backendSessionId: SessionId | null = null;
  private readonly backend: BackendProcess;
  readonly cwd: string | null;
  private readonly getProjectContextBlockFn: (() => string) | null;
  private firstPromptSent = false;
  private lastSentWebTabBlock: string | null = null;
  private readonly getDescriptor: (() => BackendDescriptor | undefined) | null;
  private readonly runFanoutTurn: RunFanoutTurn | null;
  private readonly getDisplayName: ((backendId: BackendId) => string) | null;
  private readonly getApp: (() => App) | null;
  private readonly getProjectContextUpdatesFn: (() => ProjectContextUpdates | null) | null;
  private readonly markProjectContextUpdatesDeliveredFn: ((epoch: number) => void) | null;
  private cachedStatus: AgentSessionStatus = "starting";
  private startupFailed = false;
  private startupSettled = false;
  private agentBusy = false;
  private lastMentionedAgents: ReadonlyArray<BackendId> = EMPTY_BACKEND_IDS;
  private pendingFanoutContext: PendingFanoutContext[] = [];
  private resendSavedHistory = false;
  private readonly turns: TurnTracker;
  private readonly taskFiles = new Map<string, FileCaptures>();
  private readonly tasks = new Map<string, AgentTask>();
  private taskList: readonly AgentTask[] = EMPTY_TASKS;
  private readonly taskContent = new Map<string, AgentMessageStore>();
  private listeners = new Set<AgentSessionListener>();
  private unregisterSessionHandler: (() => void) | null = null;
  private currentState: BackendState | null = null;
  private label: string | null = null;
  private labelSource: "user" | "agent" | null = null;
  private disposed = false;
  private resumeSelection: ModelSelection | undefined;
  private resumeMode: CopilotMode | null | undefined;
  private settleReady: () => void = () => {};
  private readonly historyReplay = new SessionHistoryReplay({
    store: this.store,
    scheduleNotifyMessages: () => this.scheduleNotifyMessages(),
    applyTodoList: (entries) => this.requests.applyTodoList(entries),
  });
  private readonly requests: InteractiveRequests;
  private readonly usageTracker: UsageTracker;
  private feedbackOffer: FeedbackOffer | null = null;

  private needsAttention = false;
  private notifyScheduled = false;
  private notifyHandle: ReturnType<typeof setTimeout> | number | null = null;

  constructor(opts: AgentSessionStateOptions | AgentSessionStartOptions) {
    this.backend = opts.backend;
    this.internalId = opts.internalId;
    this.chatInputId = opts.chatInputId ?? uuidv4();
    this.backendId = opts.backendId;
    this.turns = new TurnTracker({
      store: this.store,
      backendId: this.backendId,
      prompt: (input) => this.backend.prompt({ sessionId: this.backendSessionId!, ...input }),
      notifyMessages: () => this.notifyMessages(),
      notifyQueuedPrompts: () => this.notifyQueuedPromptsChanged(),
      promptsWithdrawn: (prompts) => {
        // A web page that rode only on a withdrawn message never reached the agent, so it goes in full next time. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
        if (prompts.some((p) => (p.context?.webTabs?.length ?? 0) > 0)) {
          this.lastSentWebTabBlock = null;
        }
      },
      notifyStatus: () => this.recomputeStatusIfChanged(),
      runningTaskToolCallIds: () =>
        new Set(
          [...this.tasks.values()]
            .filter((task) => task.status === "running" && task.taskId !== undefined)
            .map((task) => task.toolCallId)
        ),
      endLaunches: (status) => this.endLaunchesOfEndedTurn(status),
      captureFileChanges: (files, messageId, turnDiff) =>
        this.finalizeFileChanges(files, this.store, messageId, turnDiff),
      onTurnCompleted: () => void this.pollSessionTitle(),
      onTurnFailed: (errorText) => this.offerTurnErrorReport(errorText),
    });
    this.planFeedbackDelivery = opts.getDescriptor?.()?.planFeedbackDelivery ?? "permission";
    this.projectId = opts.projectId ?? GLOBAL_SCOPE;
    this.cwd = opts.cwd ?? null;
    this.getDescriptor = opts.getDescriptor ?? null;
    this.runFanoutTurn = opts.runFanoutTurn ?? null;
    this.getDisplayName = opts.getDisplayName ?? null;
    this.getApp = opts.getApp ?? null;
    this.getProjectContextUpdatesFn = opts.getProjectContextUpdates ?? null;
    this.markProjectContextUpdatesDeliveredFn = opts.markProjectContextUpdatesDelivered ?? null;
    this.getProjectContextBlockFn =
      "getProjectContextBlock" in opts ? (opts.getProjectContextBlock ?? null) : null;
    this.requests = new InteractiveRequests({
      store: this.store,
      internalId: this.internalId,
      getReplyId: () => this.turns.getReplyId(),
      hasLeftPlanMode: () => this.hasLeftPlanMode(),
      recomputeStatus: () => this.recomputeStatusIfChanged(),
      notifyMessages: () => this.notifyMessages(),
      notifyPlanChanged: () => this.notifyCurrentPlanChanged(),
      notifyTodoListChanged: () => this.notifyCurrentTodoListChanged(),
    });
    this.usageTracker = new UsageTracker({
      backend: this.backend,
      getModelId: () => this.currentState?.model?.current.baseModelId,
      whenReady: () => this.ready,
      notifyMessages: () => this.notifyMessages(),
    });
    if ("backendSessionId" in opts) {
      this.backendSessionId = opts.backendSessionId;
      this.resumeSelection = opts.defaultModelSelection;
      this.resumeMode = opts.defaultMode;
      // The backend replays the chat as live-shaped updates until its load response; collect them from the first frame. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
      this.historyReplay.start();
      this.unregisterSessionHandler = this.backend.registerSessionHandler(
        opts.backendSessionId,
        (event) => this.handleSessionEvent(event)
      );
      this.ready = new Promise<void>((resolve) => {
        this.settleReady = resolve;
      });
    } else {
      this.currentState = null;
      this.ready = this.initialize(opts);
    }
  }

  completeResume(state: BackendState | null): void {
    this.historyReplay.end();
    this.currentState = state;
    const settle = () => {
      this.startupSettled = true;
      this.recomputeStatusIfChanged();
      this.settleReady();
    };
    const selection = this.resumeSelection ?? state?.model?.current;
    if (!selection || !state) return settle();
    void this.applyStartupSelection(selection, this.resumeMode)
      // A resumed chat stays open to pick an enabled model; sends on any other model are refused.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/625
      .catch((e) => logWarn(`[AgentMode] resumed ${this.backendId} session kept its model`, e))
      .finally(settle);
  }

  static start(opts: AgentSessionStartOptions): AgentSession {
    return new AgentSession(opts);
  }

  getBackendSessionId(): SessionId | null {
    return this.backendSessionId;
  }

  private async initialize(opts: AgentSessionStartOptions): Promise<void> {
    const { backend, cwd, defaultModelSelection } = opts;
    try {
      const resp = await backend.newSession({
        cwd,
        projectId: this.projectId,
        mcpServers: opts.mcpServers,
      });
      if (this.disposed) return;
      const modelLog = resp.state.model
        ? `model=${resp.state.model.current.baseModelId} (available: ${resp.state.model.availableModels
            .map((m) => m.baseModelId)
            .join(", ")})`
        : "agent did not report model state";
      logInfo(`[AgentMode] session ${resp.sessionId} ${modelLog}`);
      this.backendSessionId = resp.sessionId;
      this.currentState = resp.state;
      this.unregisterSessionHandler = this.backend.registerSessionHandler(resp.sessionId, (event) =>
        this.handleSessionEvent(event)
      );
      if (this.disposed) {
        this.unregisterSessionHandler();
        this.unregisterSessionHandler = null;
        return;
      }
      this.recomputeStatusIfChanged();
      this.notifyModelChanged();

      const selection = defaultModelSelection ?? resp.state.model?.current;
      if (selection) await this.applyStartupSelection(selection, opts.defaultMode);
      this.startupSettled = true;
      this.recomputeStatusIfChanged();
    } catch (err) {
      if (this.disposed) return;
      logWarn(`[AgentMode] session/new failed for ${this.internalId}`, err);
      this.startupFailed = true;
      this.recomputeStatusIfChanged();
      throw err instanceof Error ? err : new Error(err2String(err));
    }
  }

  getState(): BackendState | null {
    return this.currentState;
  }

  async setModel(modelId: string): Promise<void> {
    if (this.getStatus() === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionModel({
      sessionId: this.backendSessionId,
      modelId,
    });
    void this.usageTracker.dropUsageWindowOnModelChange(next);
    this.currentState = next;
    this.notifyModelChanged();
  }

  async applyModelWireId(wireId: string): Promise<void> {
    const apply = this.currentState?.model?.apply;
    if (apply?.kind === "setConfigOption") {
      await this.setConfigOption(apply.configId, wireId);
      return;
    }
    await this.setModel(wireId);
  }

  private async applyStartupSelection(
    selection: ModelSelection,
    mode: CopilotMode | null = null
  ): Promise<void> {
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return;
    if (this.runsOnlyEnabledModels()) {
      await this.settleOnEnabledModel(descriptor, selection, mode);
      return;
    }
    try {
      await descriptor.applySelection(this, selection);
    } catch (e) {
      logWarn(
        `[AgentMode] could not apply startup selection ${selection.baseModelId}; keeping the agent's model`,
        e
      );
    }
  }

  // OpenCode answers session/new before Copilot's models and modes load and lists them in a later
  // update, so wait for them; a chat must never show or run a model the user did not enable.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/625
  private async settleOnEnabledModel(
    descriptor: BackendDescriptor,
    seed: ModelSelection,
    mode: CopilotMode | null
  ): Promise<void> {
    const enabled = this.enabledModels();
    const pick = () => pickEnabledModel(enabled, this.currentState?.model, seed);
    await this.waitForState(
      () => pick().settled && (!mode || this.currentState?.mode?.apply[mode] !== undefined)
    );
    if (this.disposed) return;
    const { target } = pick();
    if (!target) throw noEnabledModelError(descriptor.displayName);
    await descriptor.applySelection(this, target);
    await replayPersistedMode(this, mode);
  }

  private waitForState(isReady: () => boolean): Promise<void> {
    if (isReady()) return Promise.resolve();
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe({
        onMessagesChanged: () => {},
        onStatusChanged: (status) => {
          if (status === "closed") finish();
        },
        onModelChanged: () => {
          if (isReady()) finish();
        },
      });
      const timer = window.setTimeout(() => finish(), ENABLED_MODEL_WAIT_MS);
      const finish = (): void => {
        window.clearTimeout(timer);
        unsubscribe();
        resolve();
      };
    });
  }

  private isOnModelNotEnabled(): boolean {
    const current = this.currentState?.model?.current.baseModelId;
    return (
      this.runsOnlyEnabledModels() &&
      current !== undefined &&
      !this.enabledModels().some((entry) => entry.baseModelId === current)
    );
  }

  private runsOnlyEnabledModels(): boolean {
    return this.getDescriptor?.()?.routesCopilotModels === true;
  }

  private enabledModels(): readonly EnabledModelEntry[] {
    return this.getDescriptor?.()?.getEnabledModelEntries?.(getSettings()) ?? EMPTY_ENABLED_MODELS;
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (this.getStatus() === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionConfigOption({
      sessionId: this.backendSessionId,
      configId,
      value,
    });
    void this.usageTracker.dropUsageWindowOnModelChange(next);
    this.currentState = next;
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  async setMode(modeId: string): Promise<void> {
    if (this.getStatus() === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionMode({
      sessionId: this.backendSessionId,
      modeId,
    });
    this.currentState = next;
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  canSwitchModel(): boolean | null {
    if (this.getStatus() === "starting") return false;
    return this.currentState?.model?.apply.kind === "setConfigOption"
      ? this.backend.isSetSessionConfigOptionSupported()
      : this.backend.isSetSessionModelSupported();
  }

  canSwitchEffort(): boolean | null {
    if (this.getStatus() === "starting") return false;
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return null;
    if (descriptor.wire.effortConfigFor) return this.backend.isSetSessionConfigOptionSupported();
    return this.currentState?.model?.apply.kind === "setConfigOption"
      ? this.backend.isSetSessionConfigOptionSupported()
      : this.backend.isSetSessionModelSupported();
  }

  canSwitchMode(): boolean | null {
    if (this.getStatus() === "starting") return false;
    const mode = this.currentState?.mode;
    if (!mode) return null;
    const sample = mode.options[0];
    if (!sample) return null;
    const spec = mode.apply[sample.value];
    if (!spec) return null;
    // One picker choice may need both Codex collaboration and approval settings.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
    const steps = spec.kind === "sequence" ? spec.steps : [spec];
    const capabilities = steps.map((step) =>
      step.kind === "setConfigOption"
        ? this.backend.isSetSessionConfigOptionSupported()
        : this.backend.isSetSessionModeSupported()
    );
    if (capabilities.includes(false)) return false;
    if (capabilities.includes(null)) return null;
    return true;
  }

  getStatus(): AgentSessionStatus {
    if (this.disposed) return "closed";
    if (this.startupFailed) return "error";
    if (this.backendSessionId === null || !this.startupSettled) return "starting";
    // The chat is not finished while its subagents work, although the agent's replies end between them. https://github.com/Brevilabs/obsidian-copilot-private/issues/757
    const working = this.turns.isMainTurnRunning() || this.agentBusy;
    // A background task can ask while the agent is idle; its request must not hold the composer or show Stop. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    if (working && this.requests.hasPending()) {
      return "awaiting_permission";
    }
    if (working) return "running";
    if (this.turns.hasLastTurnFailed()) return "error";
    return "idle";
  }

  getNeedsAttention(): boolean {
    return this.needsAttention;
  }

  markNeedsAttention(): void {
    if (this.needsAttention) return;
    this.needsAttention = true;
    this.notifyNeedsAttentionChanged();
  }

  clearNeedsAttention(): void {
    if (!this.needsAttention) return;
    this.needsAttention = false;
    this.notifyNeedsAttentionChanged();
  }

  private notifyNeedsAttentionChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onNeedsAttentionChanged?.(this.needsAttention);
      } catch (e) {
        logWarn(`[AgentMode] needs-attention listener threw`, e);
      }
    }
  }

  hasUserVisibleMessages(): boolean {
    return this.store.getDisplayMessages().length > 0;
  }

  loadDisplayMessages(messages: AgentChatMessage[]): void {
    this.store.loadMessages(messages);
    this.notifyMessages();
  }

  resendSavedHistoryOnNextTurn(): void {
    this.resendSavedHistory = true;
  }

  getLabel(): string | null {
    return this.label;
  }

  getLabelSource(): "user" | "agent" | null {
    return this.labelSource;
  }

  setLabel(label: string | null): void {
    const next = label?.trim() ? label.trim() : null;
    if (next === this.label) return;
    this.label = next;
    this.labelSource = next ? "user" : null;
    this.notifyLabelChanged();
  }

  restoreLabel(label: string, source: "user" | "agent"): void {
    if (source === "user") this.setLabel(label);
    else this.applyAgentLabel(label);
  }

  private backendSummarizesTitle(): boolean {
    return this.getDescriptor?.()?.summarizesSessionTitle ?? true;
  }

  private applyAgentLabel(label: string | null | undefined): void {
    if (this.labelSource === "user") return;
    const next = label?.trim() ? label.trim() : null;
    if (next === this.label) return;
    this.label = next;
    this.labelSource = next ? "agent" : null;
    this.notifyLabelChanged();
  }

  private notifyLabelChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onLabelChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] label listener threw`, e);
      }
    }
  }

  subscribe(listener: AgentSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendPrompt(
    displayText: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>,
    options: { interrupt?: boolean } = {}
  ): { userMessageId: string; turn: Promise<StopReason> } {
    // Agents only compact when /compact is the whole prompt, so nothing rides along with it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
    const sendsCompact = isCompactCommand(displayText);
    if (sendsCompact) {
      displayText = displayText.trim();
      context = undefined;
      promptContent = undefined;
      mentionedAgents = undefined;
    }
    const status = this.getStatus();
    if (status === "starting") {
      throw new Error("Session is still starting");
    }
    if (status === "closed") {
      throw new Error("Session is closed");
    }
    // Compaction and multi-agent questions are whole turns of their own, so they wait for the agent to finish. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
    const busy =
      status === "running" ||
      status === "awaiting_permission" ||
      this.turns.getQueuedPrompts().length > 0;
    if (busy) {
      if (
        !this.acceptsMidTurnPrompts() ||
        sendsCompact ||
        isFanout(mentionedAgents ?? EMPTY_BACKEND_IDS, this.backendId)
      ) {
        throw new Error("Session already has a turn in flight");
      }
      return this.queuePrompt(displayText, context, promptContent, options.interrupt === true);
    }

    const promptId = uuidv4();
    const userMessageId = this.store.addMessage(
      buildUserMessage(promptId, displayText, context, promptContent)
    );
    this.turns.openReply();

    if (this.label === null && !this.backendSummarizesTitle()) {
      this.applyAgentLabel(deriveChatTitleFromMessages(this.store.getDisplayMessages()));
    }

    this.lastMentionedAgents =
      mentionedAgents && mentionedAgents.length > 0 ? mentionedAgents : EMPTY_BACKEND_IDS;

    const send = this.turns.startSend();
    const turn = this.runTurn(
      displayText,
      userMessageId,
      context,
      promptContent,
      sendsCompact,
      send
    );
    return { userMessageId, turn };
  }

  acceptsMidTurnPrompts(): boolean {
    // A follow-up to a multi-agent question waits for the agents' answers, which ride the next normal turn. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
    const fanoutRunning =
      this.turns.isSending() &&
      this.runFanoutTurn !== null &&
      isFanout(this.lastMentionedAgents, this.backendId);
    return !fanoutRunning && this.getDescriptor?.()?.midTurnDelivery === true;
  }

  getQueuedPrompts(): readonly QueuedPrompt[] {
    return this.turns.getQueuedPrompts();
  }

  canWithdrawPrompts(): boolean {
    return this.getDescriptor?.()?.withdraw === true;
  }

  takeWithdrawnPrompts(): readonly QueuedPrompt[] {
    return this.turns.takeWithdrawnPrompts();
  }

  withdrawPrompt(promptId: string): Promise<void> {
    return this.turns.withdrawQueued(promptId, () =>
      this.backend.withdraw?.({ sessionId: this.backendSessionId!, promptId })
    );
  }

  canStopTasks(): boolean {
    return this.getDescriptor?.()?.stopTask === true;
  }

  async stopTask(taskId: string): Promise<void> {
    await this.backend.stopTask?.({ sessionId: this.backendSessionId!, taskId });
  }

  private queuePrompt(
    text: string,
    context: MessageContext | undefined,
    promptContent: PromptContent[] | undefined,
    interrupt: boolean
  ): { userMessageId: string; turn: Promise<StopReason> } {
    const prompt: QueuedPrompt = { id: uuidv4(), text, context, promptContent };
    const turn = this.turns.queue(prompt, interrupt, async () => {
      const webTabBlock =
        (context?.webTabs?.length ?? 0) > 0 ? await serializeWebTabContext(context) : "";
      return () => {
        const blocks = buildPromptBlocks(
          text,
          context,
          promptContent,
          webTabBlock === this.lastSentWebTabBlock ? "" : webTabBlock,
          null,
          null,
          null
        );
        if (webTabBlock) this.lastSentWebTabBlock = webTabBlock;
        return blocks;
      };
    });
    return { userMessageId: prompt.id, turn };
  }

  private notifyQueuedPromptsChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onQueuedPromptsChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] queued prompts listener threw`, e);
      }
    }
  }

  private async runTurn(
    displayText: string,
    userMessageId: string,
    context: MessageContext | undefined,
    promptContent: PromptContent[] | undefined,
    sendsCompact: boolean,
    send: TurnSend
  ): Promise<StopReason> {
    const outcome = await this.runPrompt(
      displayText,
      userMessageId,
      context,
      promptContent,
      sendsCompact,
      send
    );
    if (outcome.error !== undefined) throw outcome.error;
    return outcome.stopReason;
  }

  private async runPrompt(
    displayText: string,
    userMessageId: string,
    context: MessageContext | undefined,
    promptContent: PromptContent[] | undefined,
    sendsCompact: boolean,
    { signal, pushed: onPushed }: TurnSend
  ): Promise<TurnOutcome> {
    try {
      const stoppedTurnEnded = this.turns.whenStoppedTurnEnds(signal);
      if (stoppedTurnEnded) await stoppedTurnEnded;

      const hasWebTabs = (context?.webTabs?.length ?? 0) > 0;
      const webTabBlock = hasWebTabs ? await serializeWebTabContext(context) : "";
      // Stop already closed this prompt's reply, so nothing after it may run or open another. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
      if (signal.aborted || this.disposed) return { stopReason: "cancelled" };
      if (this.isOnModelNotEnabled()) {
        return this.turns.refuse(
          `This chat's model isn't enabled for ${this.displayNameFor(this.backendId)}. Pick an enabled model to continue.`
        );
      }
      // Project context, its updates and fanout history ride the next normal turn.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
      const isFirstTurn = !this.firstPromptSent && !sendsCompact;
      const projectContextBlock = isFirstTurn ? (this.getProjectContextBlockFn?.() ?? null) : null;
      const projectContextUpdates = sendsCompact
        ? null
        : (this.getProjectContextUpdatesFn?.() ?? null);
      const projectContextUpdatesBlock = projectContextUpdates?.block ?? null;

      if (this.runFanoutTurn && isFanout(this.lastMentionedAgents, this.backendId)) {
        const entitled = await this.ensureMultiAgentEntitlement();
        if (signal.aborted || this.disposed) return { stopReason: "cancelled" };
        if (!entitled) {
          showMultiAgentUpgradePrompt();
          return this.turns.refuse(
            "Multi-agent answers are a Copilot Plus feature. Upgrade to mention more than one agent in a message."
          );
        }

        const historyBlock = buildConversationHistoryBlock(
          this.priorDisplayMessages(userMessageId),
          CONVERSATION_HISTORY_MAX_CHARS
        );
        const promptBlocks = buildPromptBlocks(
          displayText,
          context,
          promptContent,
          webTabBlock,
          projectContextBlock,
          historyBlock,
          projectContextUpdatesBlock
        );
        return { stopReason: await this.runFanoutPath(displayText, promptBlocks, signal) };
      }

      // A reopened chat whose agent session is gone from this device sends its saved turns once.
      // https://github.com/logancyang/obsidian-copilot/issues/3643
      const sendsSavedHistory = this.resendSavedHistory && !sendsCompact;
      const historyBlock = sendsSavedHistory
        ? buildConversationHistoryBlock(
            this.priorDisplayMessages(userMessageId),
            CONVERSATION_HISTORY_MAX_CHARS
          )
        : null;
      const leadingContextBlock = sendsCompact
        ? null
        : [historyBlock, buildPriorFanoutContextBlock(this.pendingFanoutContext)]
            .filter(Boolean)
            .join("\n\n") || null;
      // The agent keeps every earlier turn, so resending an unchanged page fills its context
      // window with copies. https://github.com/Brevilabs/obsidian-copilot-private/issues/667
      const webTabPromptBlock = webTabBlock === this.lastSentWebTabBlock ? "" : webTabBlock;
      const promptBlocks = buildPromptBlocks(
        displayText,
        context,
        promptContent,
        webTabPromptBlock,
        projectContextBlock,
        leadingContextBlock,
        projectContextUpdatesBlock
      );

      const outcome = await this.turns.submit(
        { promptId: userMessageId, prompt: promptBlocks },
        true,
        onPushed
      );
      if (outcome.error !== undefined) return outcome;
      if (leadingContextBlock !== null && outcome.stopReason !== "cancelled") {
        this.pendingFanoutContext = [];
      }
      if (sendsSavedHistory && outcome.stopReason !== "cancelled") {
        this.resendSavedHistory = false;
      }
      if (isFirstTurn) this.firstPromptSent = true;
      if (webTabBlock) this.lastSentWebTabBlock = webTabBlock;
      if (projectContextUpdates) {
        this.markProjectContextUpdatesDeliveredFn?.(projectContextUpdates.epoch);
      }
      if (outcome.stopReason === "max_tokens" && !signal.aborted) {
        return await this.turns.submit(
          {
            promptId: uuidv4(),
            prompt: [{ type: "text", text: OUTPUT_LIMIT_CONTINUATION_PROMPT }],
          },
          false
        );
      }
      return outcome;
    } catch (err) {
      this.turns.failReply(err);
      throw err;
    } finally {
      onPushed();
      this.turns.endSend(signal);
    }
  }

  private ensureMultiAgentEntitlement(): Promise<boolean> {
    return ensureMultiAgentEntitlement(this.getApp?.());
  }

  private async runFanoutPath(
    originalPromptText: string,
    promptBlocks: PromptContent[],
    signal: AbortSignal
  ): Promise<StopReason> {
    const placeholderId = this.turns.getReplyId()!;
    const turnStartedAtMs = this.turns.getReplyStartedAtMs();
    const input: FanoutRunInput = {
      agents: this.lastMentionedAgents,
      mainAgent: this.backendId,
      prompt: withReadOnlyPreamble(promptBlocks),
      originalPromptText,
      signal,
      onChange: (turn) => {
        this.store.setFanout(placeholderId, turn);
        this.scheduleNotifyMessages();
      },
    };
    const turn = await this.runFanoutTurn!(input);
    this.store.setFanout(placeholderId, turn);

    const stopReason: StopReason = signal.aborted ? "cancelled" : "end_turn";
    // Persist the FULL composite as the message body so the dropdown reconstructs
    // on reload. Any non-empty slot text counts (including a terminal slot's
    // partial text), so a turn cancelled mid-stream is saved, not dropped blank.
    // A sole agent's empty terminal slot also carries the only visible outcome
    // and must survive reload with its error/cancel status.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/481
    const hasAnswerText = Object.values(turn.answers).some((a) => a.text.trim().length > 0);
    const hasContent =
      turn.summary.text.trim().length > 0 || hasAnswerText || isDirectAnswerTurn(turn);
    if (hasContent) {
      const composite = serializeFanoutComposite(turn, (id) => this.displayNameFor(id));
      this.store.appendAgentText(placeholderId, composite);
      const summaryText = turn.summary.text.trim();
      const replay =
        turn.summary.complete && summaryText.length > 0
          ? summaryText
          : hasAnswerText
            ? renderFanoutComposite(turn, (id) => this.displayNameFor(id))
            : "";
      if (replay) {
        this.pendingFanoutContext.push({ question: originalPromptText, summary: replay });
      }
    }
    if (this.store.markTurnComplete(placeholderId, stopReason, Date.now() - turnStartedAtMs)) {
      this.notifyMessages();
    }
    this.turns.releaseReply(placeholderId);
    return stopReason;
  }

  private priorDisplayMessages(userMessageId: string): readonly AgentChatMessage[] {
    return this.store.getDisplayMessages().filter((m) => m.id !== userMessageId);
  }

  private displayNameFor(backendId: BackendId): string {
    return this.getDisplayName?.(backendId) ?? backendId;
  }

  async cancel(): Promise<void> {
    const status = this.getStatus();
    if (status !== "running" && status !== "awaiting_permission") return;
    if (!this.backendSessionId) return;
    this.turns.stop(this.canWithdrawPrompts());
    // A subagent's requests close when Stop ends its task. https://github.com/Brevilabs/obsidian-copilot-private/issues/757
    this.requests.rejectToolRequestsFrom("main");
    this.requests.withdrawQuestions();
    const sessionId = this.backendSessionId;
    // The chat shows Stop until its subagents finish, so Stop ends them too; a background command such as a server keeps running. https://github.com/Brevilabs/obsidian-copilot-private/issues/757
    const subagentIds = this.taskList.flatMap((task) =>
      task.kind === "subagent" && task.status === "running" && task.taskId !== undefined
        ? [task.taskId]
        : []
    );
    await Promise.all([
      this.backend.cancel({ sessionId }).catch((e: unknown) => {
        logWarn(`[AgentMode] cancel notification failed`, e);
      }),
      ...subagentIds.map((taskId) =>
        this.stopTask(taskId).catch((e: unknown) => {
          logWarn(`[AgentMode] stopping subagent ${taskId} at Stop failed`, e);
        })
      ),
    ]);
  }

  async releaseBackendSession(): Promise<void> {
    const backendSessionId = this.backendSessionId;
    if (!backendSessionId || !this.backend.closeSession) {
      throw new Error("This agent does not support closing individual sessions.");
    }
    try {
      await this.backend.closeSession({ sessionId: backendSessionId });
    } catch (error) {
      if (error instanceof MethodUnsupportedError) {
        throw new Error("This agent does not support closing individual sessions.");
      }
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.unregisterSessionHandler?.();
    this.unregisterSessionHandler = null;
    this.requests.dispose();
    this.turns.dispose();
    this.recomputeStatusIfChanged();
    this.cancelScheduledNotify();
    this.listeners.clear();
  }

  handlePlanProposalPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    return this.requests.handlePlanProposalPermission(request);
  }

  resolvePlanProposalPermission(toolCallId: string, allow: boolean, denyMessage?: string): void {
    this.requests.resolvePlanProposalPermission(toolCallId, allow, denyMessage);
  }

  getCurrentPlan(): CurrentPlan | null {
    return this.requests.getCurrentPlan();
  }

  getCurrentTodoList(): AgentTodoListEntry[] | null {
    return this.requests.getCurrentTodoList();
  }

  getTasks(): readonly AgentTask[] {
    return this.taskList;
  }

  getTaskMessages(toolCallId: string): readonly AgentChatMessage[] {
    return this.taskContent.get(toolCallId)?.getDisplayMessages() ?? EMPTY_MESSAGES;
  }

  getReportEvidence(): FeedbackEvidence {
    return {
      backendId: this.backendId,
      model: this.currentState?.model?.current.baseModelId ?? null,
      sessionId: this.backendSessionId,
      raisedAt: new Date().toISOString(),
    };
  }

  getFeedbackOffer(): FeedbackOffer | null {
    return this.feedbackOffer;
  }

  // One card per session, whatever became of it, so a frustrated user is never nagged.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  offerFeedback(draft: FeedbackDraft): FeedbackOfferResult {
    if (this.feedbackOffer) return "already_offered";
    this.feedbackOffer = this.openFeedbackOffer("agent", draft);
    this.notifyMessages();
    return "shown";
  }

  // A failed reply leaves no agent turn to raise the card, so the session raises it with the error.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/762
  private offerTurnErrorReport(errorText: string): void {
    if (this.feedbackOffer || !getSettings().agentMode.offerFeedbackCards) return;
    this.feedbackOffer = this.openFeedbackOffer("turn_error", {
      title: `Agent Chat reply failed on ${this.backendId}`,
      whatHappened: errorText,
      userSaid: "",
      repro: "",
    });
  }

  private openFeedbackOffer(trigger: FeedbackOfferTrigger, draft: FeedbackDraft): FeedbackOffer {
    const userMessages = this.store
      .getDisplayMessages()
      .filter((message) => message.sender === USER_SENDER);
    return {
      trigger,
      draft,
      evidence: this.getReportEvidence(),
      afterUserMessageId: userMessages[userMessages.length - 1]?.id ?? null,
      status: "open",
    };
  }

  dismissFeedbackOffer(): void {
    if (this.feedbackOffer?.status !== "open") return;
    this.feedbackOffer = { ...this.feedbackOffer, status: "dismissed" };
    this.notifyMessages();
  }

  markFeedbackReported(report: { reportId: string; issueUrl: string }): void {
    // An upload can land after the user closed the dialog and dismissed the card, which must stay dismissed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
    if (this.feedbackOffer?.status !== "open") return;
    this.feedbackOffer = { ...this.feedbackOffer, status: "reported", report };
    this.notifyMessages();
  }

  getSessionUsage(): SessionUsage | null {
    return this.usageTracker.getSessionUsage();
  }

  getPlanUsage(): PlanUsage | null {
    return this.usageTracker.getPlanUsage();
  }

  seedSessionUsage(usage: SessionUsage | undefined): void {
    void this.usageTracker.seedSessionUsage(usage);
  }

  finalizePlanDecision(
    proposalId: string,
    decision?: PlanDecisionAction,
    feedbackText?: string
  ): boolean {
    return this.requests.finalizePlanDecision(proposalId, decision, feedbackText);
  }

  clearCurrentPlanIfModeLeft(): void {
    this.requests.clearCurrentPlanIfModeLeft();
  }

  hasPendingPlanPermission(): boolean {
    return this.requests.hasPendingPlanPermission();
  }

  handleToolPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    const files = this.filesOf(request.requester ?? "main");
    if (files) this.observeToolCall(files, request.toolCall.kind, toolCallTarget(request.toolCall));
    return this.requests.handleToolPermission(request);
  }

  resolveToolPermission(toolCallId: string, optionId: string): void {
    this.requests.resolveToolPermission(toolCallId, optionId);
  }

  getPendingToolPermissions(): PermissionPrompt[] {
    return this.requests.getPendingToolPermissions();
  }

  handleAskUserQuestion(request: AskUserQuestionPrompt): Promise<AgentQuestionAnswers> {
    return this.requests.handleAskUserQuestion(request);
  }

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void {
    this.requests.resolveAskUserQuestion(requestId, answers);
  }

  getPendingAskUserQuestions(): AskUserQuestionPrompt[] {
    return this.requests.getPendingAskUserQuestions();
  }

  private handleSessionEvent(event: SessionEvent): void {
    const update = event.update;
    // Task lifecycle updates describe the task itself, even when reported from inside a task. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
    if (event.taskToolCallId !== undefined && !isTaskLifecycleUpdate(update)) {
      this.applyTaskContent(event.taskToolCallId, update);
      return;
    }
    // A user message echoed outside the replay is already shown from the prompt that sent it. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
    if (update.sessionUpdate === "user_message_chunk" && !this.historyReplay.isOpen()) return;
    if (this.historyReplay.append(update, event.occurredAt)) {
      return;
    }
    switch (update.sessionUpdate) {
      case "message_delivered":
        this.turns.deliverPrompt(update.promptId);
        return;
      case "messages_withdrawn":
        this.turns.withdrawPrompts(update.promptIds);
        return;
      case "session_disconnected":
        this.handleDisconnect(update.error);
        return;
      case "task_started":
        // A launch from the stopped turn has no card left to settle it, so only a task the agent actually starts is listed. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
        if (
          update.taskId === undefined &&
          event.taskToolCallId === undefined &&
          this.turns.isStopping()
        ) {
          return;
        }
        this.applyTaskUpdate(update);
        return;
      case "task_progress":
      case "task_ended":
        this.applyTaskUpdate(update);
        return;
      case "turn_started":
        this.turns.startTurn(update.turnId, update.startedAt);
        return;
      case "turn_ended":
        this.turns.endTurn(update);
        return;
      case "busy_changed":
        this.agentBusy = update.busy;
        this.recomputeStatusIfChanged();
        return;
    }
    const toolOwnerMessageId =
      update.sessionUpdate === "tool_call_update"
        ? this.store.findMessageIdWithToolCall(update.toolCallId)
        : undefined;
    const toolOwnerStopReason = toolOwnerMessageId
      ? this.store.getMessage(toolOwnerMessageId)?.turnStopReason
      : undefined;
    const isPriorToolUpdate =
      toolOwnerMessageId !== undefined &&
      toolOwnerStopReason !== undefined &&
      toolOwnerStopReason !== "cancelled";

    if (this.turns.isStopping()) {
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
        case "agent_thought_chunk":
          this.turns.dropStoppedContent(update.messageId);
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
        case "tool_call":
        case "plan":
        case "compaction":
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
        case "tool_call_update":
          if (isPriorToolUpdate) break;
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
      }
    }

    if (update.sessionUpdate === "plan") this.requests.applyTodoList(update.entries);

    if (update.sessionUpdate === "session_info_update") {
      // An update that omits `title` (opencode's compaction and retry markers) leaves the title alone; only an explicit null clears it. https://github.com/Brevilabs/obsidian-copilot-private/issues/632
      if (update.title !== undefined && this.backendSummarizesTitle()) {
        this.applyAgentLabel(update.title);
      }
      return;
    }
    if (update.sessionUpdate === "state_changed") {
      void this.usageTracker.dropUsageWindowOnModelChange(update.state);
      this.currentState = update.state;
      this.notifyModelChanged();
      this.clearCurrentPlanIfModeLeft();
      return;
    }
    if (update.sessionUpdate === "current_mode_update") {
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      return;
    }
    if (update.sessionUpdate === "usage_update") {
      this.usageTracker.applyUsageUpdate(update.usage);
      return;
    }
    if (update.sessionUpdate === "plan_usage_update") {
      this.usageTracker.applyPlanUsage(update.planUsage);
      return;
    }

    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      const text = extractText(update.content);
      if (!text) return;
      const target = this.turns.resolveContentTarget(update.messageId);
      if (!target) {
        logWarn(`[AgentMode] dropping ${update.sessionUpdate} — no target for ${this.internalId}`);
        return;
      }
      const appended =
        update.sessionUpdate === "agent_message_chunk"
          ? this.store.appendAgentText(target, text)
          : this.store.appendAgentThought(target, text);
      if (appended) {
        this.turns.extendSettledTurn(target);
        this.scheduleNotifyMessages();
      }
      return;
    }

    const targetMessageId = this.turns.resolveToolTarget(
      isPriorToolUpdate ? toolOwnerMessageId : undefined
    );
    if (!targetMessageId) {
      logWarn(`[AgentMode] dropping session/update — no placeholder for ${this.internalId}`);
      return;
    }

    switch (update.sessionUpdate) {
      case "tool_call": {
        this.observeToolCall(this.turns.getTurnFiles(), update.kind, toolCallTarget(update));
        const exitPlan = tryReadExitPlanModeCall({
          kind: update.kind,
          rawInput: update.rawInput,
          isPlanProposal: update.isPlanProposal,
        });
        if (exitPlan) {
          this.requests.publishGatedPlan(update.toolCallId, exitPlan);
          if (this.store.upsertAgentPart(targetMessageId, toolCallToPart(update))) {
            this.scheduleNotifyMessages();
          }
          return;
        }
        if (this.store.upsertAgentPart(targetMessageId, toolCallToPart(update))) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "tool_call_update": {
        const existing = this.findToolCallPart(targetMessageId, update.toolCallId);
        const merged = mergeToolCallUpdate(existing, this.withEndedTaskStatus(update));
        // A late update to an earlier turn's call must not count as this turn's edit.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/347
        if (!isPriorToolUpdate) this.observeToolResult(this.turns.getTurnFiles(), merged, update);
        if (merged.kind === "tool_call") {
          const exitPlan = tryReadExitPlanModeCall({
            kind: update.kind ?? merged.toolKind,
            rawInput: merged.input,
            isPlanProposal: update.isPlanProposal,
          });
          if (exitPlan) {
            this.requests.publishGatedPlan(merged.id, exitPlan);
          }
        }
        if (this.store.upsertAgentPart(targetMessageId, merged)) {
          this.scheduleNotifyMessages();
        }
        this.endUnstartedTasks();
        return;
      }
      case "plan": {
        if (this.store.upsertAgentPart(targetMessageId, planToPart(update))) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "compaction": {
        const upserted = upsertCompactionPart(this.store, targetMessageId, update);
        const metered = this.usageTracker.applyCompactedUsage(update);
        if (upserted || metered) this.scheduleNotifyMessages();
        return;
      }
      default:
        logInfo(
          `[AgentMode] ignoring session/update kind=${(update as { sessionUpdate: string }).sessionUpdate}`
        );
        return;
    }
  }

  private handleDisconnect(error: Error): void {
    // A launch the agent never started cannot start after the connection is gone. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
    for (const task of this.tasks.values()) {
      if (task.taskId === undefined && task.status === "running") this.endTask(task, "stopped");
    }
    this.agentBusy = false;
    this.turns.disconnect(error);
    for (const l of this.listeners) {
      try {
        l.onDisconnected?.();
      } catch (e) {
        logWarn(`[AgentMode] disconnect listener threw`, e);
      }
    }
  }

  private applyTaskUpdate(
    update: Extract<
      SessionEvent["update"],
      { sessionUpdate: "task_started" | "task_progress" | "task_ended" }
    >
  ): void {
    if (update.sessionUpdate === "task_started") return this.startTask(update);
    const task = this.taskWithId(update.taskId);
    if (!task) return;
    if (update.sessionUpdate === "task_progress") {
      // Usage counts show only on the launching card, so a usage-only frame leaves task cards alone. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
      if (update.progress) {
        this.updateLaunchCard({ toolCallId: task.toolCallId, progress: update.progress });
      }
      const model = update.model ?? task.model;
      const outputFile = update.outputFile ?? task.outputFile;
      if (model === task.model && outputFile === task.outputFile) return;
      this.tasks.set(task.toolCallId, { ...task, model, outputFile });
      return this.publishTasks();
    }
    this.endTask(task, update.status, update.summary, update.outputFile);
  }

  // One entry per launching tool call, so a task's card, row and open view keep their identity when its id arrives. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  private startTask(start: TaskStart): void {
    const existing = this.tasks.get(start.toolCallId);
    if (existing?.taskId !== undefined) return;
    if (start.taskId === undefined && existing && existing.status !== "running") return;
    this.tasks.set(start.toolCallId, {
      ...existing,
      toolCallId: start.toolCallId,
      kind: start.kind,
      taskId: start.taskId ?? existing?.taskId,
      description: start.description || existing?.description || "",
      prompt: start.prompt ?? existing?.prompt,
      subagentType: start.subagentType ?? existing?.subagentType,
      command: start.command ?? existing?.command,
      status: "running",
    });
    this.publishTasks();
  }

  private taskWithId(taskId: string): AgentTask | undefined {
    for (const task of this.tasks.values()) if (task.taskId === taskId) return task;
    return undefined;
  }

  // A launch that settles before the agent names its task never became one: it was denied, failed or stopped. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  private endUnstartedTasks(): void {
    for (const task of this.tasks.values()) {
      if (task.taskId !== undefined || task.status !== "running") continue;
      const card = this.findLaunchCard(task.toolCallId)?.card;
      const status = card?.kind === "tool_call" ? UNSTARTED_TASK_END[card.status] : undefined;
      if (status) this.endTask(task, status);
    }
  }

  // The agent names every task its turn launched before the turn ends, so a launch still unnamed then, such as a call cut off mid-stream, never starts. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  private endLaunchesOfEndedTurn(status: TaskEndStatus): void {
    for (const task of this.tasks.values()) {
      if (task.taskId !== undefined || task.status !== "running") continue;
      if (this.store.findMessageIdWithToolCall(task.toolCallId)) this.endTask(task, status);
    }
  }

  private findLaunchCard(
    toolCallId: string
  ): { store: AgentMessageStore; messageId: string; card?: AgentMessagePart } | undefined {
    for (const store of [this.store, ...this.taskContent.values()]) {
      const messageId = store.findMessageIdWithToolCall(toolCallId);
      if (!messageId) continue;
      const card = store
        .getMessage(messageId)
        ?.parts?.find((part) => part.kind === "tool_call" && part.id === toolCallId);
      return { store, messageId, card };
    }
    return undefined;
  }

  private endTask(
    task: AgentTask,
    status: TaskEndStatus,
    summary?: string,
    outputFile?: string
  ): void {
    this.tasks.set(task.toolCallId, {
      ...task,
      status,
      summary,
      outputFile: outputFile ?? task.outputFile,
    });
    // The launching card follows its task. A summary is not a result: a subagent's is boilerplate about its hand-back. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
    this.updateLaunchCard({ toolCallId: task.toolCallId, status: LAUNCH_CARD_STATUS[status] });
    // A request from a task that has ended can no longer be answered, so its card must not stay open. https://github.com/Brevilabs/obsidian-copilot-private/issues/748
    if (task.taskId !== undefined) this.requests.rejectToolRequestsFrom({ taskId: task.taskId });
    // A tool call cut short by its task's end would otherwise spin in the task's view forever. https://github.com/Brevilabs/obsidian-copilot-private/issues/748
    const content = this.taskContent.get(task.toolCallId);
    const contentId = content?.getDisplayMessages()[0]?.id;
    if (contentId) content?.stopToolCalls(contentId, EMPTY_TOOL_CALL_IDS);
    this.endUnstartedTasks();
    this.publishTasks();
    void this.finalizeTaskFileChanges(task.toolCallId);
  }

  private async finalizeTaskFileChanges(toolCallId: string): Promise<void> {
    const files = this.taskFiles.get(toolCallId);
    this.taskFiles.delete(toolCallId);
    const store = this.taskContent.get(toolCallId);
    const messageId = store?.getDisplayMessages()[0]?.id;
    if (!files || !store || !messageId) return;
    try {
      if (await this.finalizeFileChanges(files, store, messageId)) this.notifyTasks();
    } catch (err) {
      logWarn(`[AgentMode] could not capture a task's file changes`, err);
    }
  }

  // A task's end decides its launching card's status; the tool's result can arrive after a stop and must not turn it into a failure. https://github.com/Brevilabs/obsidian-copilot-private/issues/748
  private withEndedTaskStatus<T extends { toolCallId: string }>(
    update: T
  ): T | (T & { status: AgentToolStatus }) {
    const taskStatus = this.tasks.get(update.toolCallId)?.status;
    return taskStatus && taskStatus !== "running"
      ? { ...update, status: LAUNCH_CARD_STATUS[taskStatus] }
      : update;
  }

  private updateLaunchCard(delta: ToolCallDelta): void {
    const launch = this.findLaunchCard(delta.toolCallId);
    if (!launch) return;
    const { store, messageId, card } = launch;
    if (store.upsertAgentPart(messageId, mergeToolCallUpdate(card, delta))) {
      if (store === this.store) this.scheduleNotifyMessages();
    }
  }

  private applyTaskContent(toolCallId: string, update: SessionEvent["update"]): void {
    let store = this.taskContent.get(toolCallId);
    if (!store) {
      store = new AgentMessageStore();
      this.taskContent.set(toolCallId, store);
    }
    const messageId =
      store.getDisplayMessages()[0]?.id ??
      store.addMessage({
        message: "",
        sender: AI_SENDER,
        timestamp: formatDateTime(new Date()),
        isVisible: true,
        parts: [],
      });
    let changed: boolean;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        changed = store.appendAgentText(messageId, extractText(update.content));
        break;
      case "agent_thought_chunk":
        changed = store.appendAgentThought(messageId, extractText(update.content));
        break;
      case "tool_call":
        this.observeToolCall(this.filesOfTask(toolCallId), update.kind, toolCallTarget(update));
        changed = store.upsertAgentPart(messageId, toolCallToPart(update));
        break;
      case "tool_call_update": {
        const existing = store
          .getMessage(messageId)
          ?.parts?.find((part) => part.kind === "tool_call" && part.id === update.toolCallId);
        // A call cut short by its task's end fails afterwards on a disconnect; it reads stopped, as after Stop. https://github.com/Brevilabs/obsidian-copilot-private/issues/748
        const cutShort =
          existing?.kind === "tool_call" &&
          existing.status === "cancelled" &&
          update.status === "failed";
        const merged = mergeToolCallUpdate(
          existing,
          cutShort ? { ...update, status: "cancelled" } : this.withEndedTaskStatus(update)
        );
        this.observeToolResult(this.filesOfTask(toolCallId), merged, update);
        changed = store.upsertAgentPart(messageId, merged);
        this.endUnstartedTasks();
        break;
      }
      default:
        return;
    }
    // A task's own messages change on every step it takes; the task list keeps its identity so the chat's cards do not re-render. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
    if (changed) this.notifyTasks();
  }

  private publishTasks(): void {
    this.taskList = this.tasks.size === 0 ? EMPTY_TASKS : Object.freeze([...this.tasks.values()]);
    this.notifyTasks();
  }

  private notifyTasks(): void {
    for (const l of this.listeners) {
      try {
        l.onTasksChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] tasks listener threw`, e);
      }
    }
  }

  // A subagent's edits belong to its own capture, never to the card of the main-agent run open beside it. https://github.com/Brevilabs/obsidian-copilot-private/issues/669
  private filesOf(requester: PermissionRequester): FileCaptures | undefined {
    if (requester === "main") return this.turns.getTurnFiles();
    const toolCallId = this.taskWithId(requester.taskId)?.toolCallId;
    return toolCallId === undefined ? undefined : this.filesOfTask(toolCallId);
  }

  private filesOfTask(toolCallId: string): FileCaptures {
    let files = this.taskFiles.get(toolCallId);
    if (!files) {
      files = new Map();
      this.taskFiles.set(toolCallId, files);
    }
    return files;
  }

  private observeToolResult(
    files: FileCaptures,
    part: AgentMessagePart,
    update: ToolCallDelta
  ): void {
    if (part.kind !== "tool_call") return;
    this.observeToolCall(
      files,
      part.toolKind,
      { locations: part.locations, input: part.input, diffPaths: diffTargetPaths(part.output) },
      update.originalFiles
    );
  }

  private observeToolCall(
    files: FileCaptures,
    kind: AgentToolKind | undefined,
    target: EditTargetSource,
    originalFiles?: Readonly<Record<string, string | null>>
  ): void {
    const changes = kind === "edit" || kind === "delete";
    if (!changes && kind !== "read") return;
    const app = this.getApp?.();
    const adapter = app?.vault?.adapter;
    if (!app || !adapter) return;
    const vaultBase = getVaultBase(app);
    const originals = new Map(
      Object.entries(originalFiles ?? {}).map(([path, text]) => [
        toVaultTargetPath(path, vaultBase),
        text,
      ])
    );
    for (const path of editTargetPaths(target, vaultBase)) {
      if (!isCapturableVaultPath(path)) continue;
      let capture = files.get(path);
      if (!capture) {
        // Read as the call is announced; an Auto-mode write can land first, so a write-time original wins.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/687
        capture = { edited: false, snapshot: readVaultText(adapter, path) };
        files.set(path, capture);
      }
      if (!changes) continue;
      capture.edited = true;
      // Later results report text this turn already changed; the first is the turn's starting file.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/347
      if (capture.writeTimeBefore === undefined) capture.writeTimeBefore = originals.get(path);
    }
  }

  // Before text comes from a source that saw the file at write time; the first-mention snapshot
  // is only the fallback. https://github.com/Brevilabs/obsidian-copilot-private/issues/347
  private async finalizeFileChanges(
    files: FileCaptures,
    store: AgentMessageStore,
    messageId: string,
    turnDiff?: TurnDiff
  ): Promise<boolean> {
    const edited = [...files].filter(([, capture]) => capture.edited);
    const app = this.getApp?.();
    const adapter = app?.vault?.adapter;
    if (edited.length === 0 || !app || !adapter) return false;
    const turnPatches = turnDiff ? filePatchesByVaultPath(turnDiff, getVaultBase(app)) : undefined;
    const changes = (
      await Promise.all(
        edited.map(async ([path, capture]) => {
          const after = await readVaultText(adapter, path);
          const patch = turnPatches?.get(path);
          if (capture.writeTimeBefore === undefined && patch) {
            capture.writeTimeBefore = revertFilePatch(patch, after);
          }
          const before =
            capture.writeTimeBefore === undefined
              ? await capture.snapshot
              : capture.writeTimeBefore;
          return buildTurnFileChange(path, before, after);
        })
      )
    ).filter((change): change is TurnFileChange => change !== null);
    return changes.length > 0 && store.setFileChanges(messageId, changes);
  }

  private findToolCallPart(messageId: string, toolCallId: string): AgentMessagePart | undefined {
    return findToolCallPart(this.store, messageId, toolCallId);
  }

  private hasLeftPlanMode(): boolean {
    if (!this.getDescriptor?.()?.getModeMapping) return false;
    return this.currentState?.mode?.current !== "plan";
  }

  private recomputeStatusIfChanged(): void {
    const next = this.getStatus();
    if (next === this.cachedStatus) return;
    this.cachedStatus = next;
    for (const l of this.listeners) {
      try {
        l.onStatusChanged(next);
      } catch (e) {
        logWarn(`[AgentMode] status listener threw`, e);
      }
    }
  }

  private notifyMessages(): void {
    this.cancelScheduledNotify();
    for (const l of this.listeners) {
      try {
        l.onMessagesChanged();
      } catch (e) {
        logWarn(`[AgentMode] messages listener threw`, e);
      }
    }
  }

  private scheduleNotifyMessages(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    const fire = (): void => {
      this.notifyHandle = null;
      this.notifyScheduled = false;
      this.notifyMessages();
    };
    if (typeof requestAnimationFrame !== "undefined") {
      this.notifyHandle = window.requestAnimationFrame(fire);
    } else {
      this.notifyHandle = window.setTimeout(fire, 16);
    }
  }

  private cancelScheduledNotify(): void {
    if (!this.notifyScheduled) return;
    this.notifyScheduled = false;
    if (this.notifyHandle !== null) {
      if (typeof cancelAnimationFrame !== "undefined" && typeof this.notifyHandle === "number") {
        cancelAnimationFrame(this.notifyHandle);
      } else {
        window.clearTimeout(this.notifyHandle as ReturnType<typeof setTimeout>);
      }
      this.notifyHandle = null;
    }
  }

  private async pollSessionTitle(): Promise<void> {
    if (this.labelSource === "user") return;
    if (!this.backendSummarizesTitle()) return;
    try {
      const resp = await this.backend.listSessions(this.cwd ? { cwd: this.cwd } : {});
      const entry = resp.sessions.find((s) => s.sessionId === this.backendSessionId);
      const title = entry?.title?.trim();
      if (!title) return;
      if (title.startsWith(DEFAULT_TITLE_PREFIX)) return;
      this.applyAgentLabel(title);
    } catch (err) {
      if (err instanceof MethodUnsupportedError) return;
      logWarn(`[AgentMode] session/list title poll failed for ${this.internalId}`, err);
    }
  }

  private notifyModelChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onModelChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] model listener threw`, e);
      }
    }
  }

  private notifyCurrentTodoListChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onCurrentTodoListChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] todo-list listener threw`, e);
      }
    }
  }

  private notifyCurrentPlanChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onCurrentPlanChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] plan listener threw`, e);
      }
    }
  }
}
