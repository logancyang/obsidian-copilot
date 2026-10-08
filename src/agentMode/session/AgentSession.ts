import { AI_SENDER, USER_SENDER, WEB_SELECTED_TEXT_TAG } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import {
  AgentChatMessage,
  AgentMessagePart,
  AgentPlanEntry,
  AgentQuestionAnswers,
  AgentTodoListEntry,
  AgentToolCallOutput,
  AskUserQuestionPrompt,
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  CopilotMode,
  CurrentPlan,
  EnabledModelEntry,
  ModelSelection,
  NewAgentChatMessage,
  PERMISSION_ALLOW_KINDS,
  PERMISSION_REJECT_KINDS,
  PermissionDecision,
  PermissionOptionKind,
  PermissionPrompt,
  PlanDecisionAction,
  PlanSummary,
  PromptContent,
  PromptInput,
  PromptOutput,
  SessionEvent,
  SessionId,
  PlanUsage,
  SessionUsage,
  StopReason,
  ToolCallContent,
  ToolCallDelta,
  ToolCallSnapshot,
} from "@/agentMode/session/types";
import {
  isNoteSelectedTextContext,
  isWebSelectedTextContext,
  MessageContext,
  type WebTabContext,
} from "@/types/message";
import { err2String, formatDateTime, type FormattedDateTime } from "@/utils";
import { ensureMultiAgentEntitlement, showMultiAgentUpgradePrompt } from "@/plusUtils";
import type { App } from "obsidian";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { deriveChatTitleFromMessages } from "@/agentMode/session/chatHistoryMerge";
import { ContextProcessor } from "@/contextProcessor";
import type { ContextMaterializationResult } from "@/context/projectContextMaterializer";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import type { FanoutRunInput } from "@/agentMode/session/fanout/FanoutOrchestrator";
import { isFanout } from "@/agentMode/session/fanout/answerers";
import {
  buildConversationHistoryBlock,
  buildPriorFanoutContextBlock,
  FANOUT_HISTORY_MAX_CHARS,
  FANOUT_READONLY_PREAMBLE,
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
import { stripUserMessageWrapper } from "@/agentMode/session/promptEnvelope";
import { replayPersistedMode } from "@/agentMode/session/replayPersistedMode";

export type RunFanoutTurn = (input: FanoutRunInput) => Promise<FanoutTurn>;

export const DEFAULT_TITLE_PREFIX = "New session";
const MAX_TOOL_OUTPUT_TEXT_CHARS = 256_000;
const CANCELLED_TURN_QUIET_MS = 1_000;
const EMPTY_PERMISSIONS: PermissionPrompt[] = [];
const EMPTY_QUESTIONS: AskUserQuestionPrompt[] = [];
const EMPTY_ANSWERS: AgentQuestionAnswers = Object.freeze({});
const EMPTY_BACKEND_IDS: ReadonlyArray<BackendId> = Object.freeze([]);
const EMPTY_ADDITIONAL_DIRECTORIES: string[] = Object.freeze([]) as unknown as string[];

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
  contextReady?: Promise<ContextMaterializationResult>;
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
  private readonly cwd: string | null;
  private readonly contextReady: Promise<ContextMaterializationResult> | null;
  private projectContextBlock: string | null = null;
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
  private lastTurnError = false;
  private lastMentionedAgents: ReadonlyArray<BackendId> = EMPTY_BACKEND_IDS;
  private pendingFanoutContext: PendingFanoutContext[] = [];
  private placeholderId: string | null = null;
  private currentTurnHadRoutedToolActivity = false;
  private currentMessageIds = new Set<string>();
  private settledStream: {
    placeholderId: string;
    messageIds: Set<string>;
    turnStartedAtMs: number;
  } | null = null;
  private cancelledPromptDrain: Promise<void> | null = null;
  private cancelledTurnActivity = 0;
  private cancelledMessageIds = new Set<string>();
  private abortController: AbortController | null = null;
  private listeners = new Set<AgentSessionListener>();
  private unregisterSessionHandler: (() => void) | null = null;
  private currentState: BackendState | null = null;
  private label: string | null = null;
  private labelSource: "user" | "agent" | null = null;
  private disposed = false;
  private resumeSelection: ModelSelection | undefined;
  private resumeMode: CopilotMode | null | undefined;
  private settleReady: () => void = () => {};
  private historyOpen = false;
  private historyUser: { wireId: string | undefined; raw: string; occurredAt?: number } | null =
    null;
  private historyAiId: string | null = null;
  private historyTurnStartedAt: number | undefined;
  private pendingPlanResolvers = new Map<
    string,
    {
      request: PermissionPrompt;
      resolve: (resp: PermissionDecision) => void;
    }
  >();
  private pendingToolResolvers = new Map<
    string,
    {
      request: PermissionPrompt;
      resolve: (resp: PermissionDecision) => void;
    }
  >();
  private pendingQuestionResolvers = new Map<
    string,
    {
      request: AskUserQuestionPrompt;
      resolve: (answers: AgentQuestionAnswers) => void;
    }
  >();
  private currentPlan: CurrentPlan | null = null;
  private currentTodoList: AgentTodoListEntry[] | null = null;
  private currentTodoListSignature: string | null = null;
  private currentUsage: SessionUsage | null = null;

  private currentPlanUsage: PlanUsage | null = null;
  private planSeq = 0;
  private decidedPlanToolCallIds = new Set<string>();
  private needsAttention = false;
  private notifyScheduled = false;
  private notifyHandle: ReturnType<typeof setTimeout> | number | null = null;

  constructor(opts: AgentSessionStateOptions | AgentSessionStartOptions) {
    this.backend = opts.backend;
    this.internalId = opts.internalId;
    this.chatInputId = opts.chatInputId ?? uuidv4();
    this.backendId = opts.backendId;
    this.planFeedbackDelivery = opts.getDescriptor?.()?.planFeedbackDelivery ?? "permission";
    this.projectId = opts.projectId ?? GLOBAL_SCOPE;
    this.cwd = opts.cwd ?? null;
    this.getDescriptor = opts.getDescriptor ?? null;
    this.runFanoutTurn = opts.runFanoutTurn ?? null;
    this.getDisplayName = opts.getDisplayName ?? null;
    this.getApp = opts.getApp ?? null;
    this.getProjectContextUpdatesFn = opts.getProjectContextUpdates ?? null;
    this.markProjectContextUpdatesDeliveredFn = opts.markProjectContextUpdatesDelivered ?? null;
    this.contextReady = "contextReady" in opts ? (opts.contextReady ?? null) : null;
    if ("backendSessionId" in opts) {
      this.backendSessionId = opts.backendSessionId;
      this.resumeSelection = opts.defaultModelSelection;
      this.resumeMode = opts.defaultMode;
      // The backend replays the chat as live-shaped updates until its load response; collect them from the first frame. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
      this.historyOpen = true;
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
    this.endHistory();
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
      const contextResult = this.contextReady ? await this.contextReady : null;
      const additionalDirectories =
        contextResult?.additionalDirectories ?? EMPTY_ADDITIONAL_DIRECTORIES;
      this.projectContextBlock = contextResult?.projectContextBlock ?? null;
      if (this.disposed) return;
      const resp = await backend.newSession({
        cwd,
        projectId: this.projectId,
        additionalDirectories,
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
    this.dropUsageWindowOnModelChange(next);
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
    this.dropUsageWindowOnModelChange(next);
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
    if (
      this.pendingPlanResolvers.size +
        this.pendingToolResolvers.size +
        this.pendingQuestionResolvers.size >
      0
    ) {
      return "awaiting_permission";
    }
    if (this.abortController !== null) return "running";
    if (this.lastTurnError) return "error";
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
    mentionedAgents?: ReadonlyArray<BackendId>
  ): { userMessageId: string; turn: Promise<StopReason> } {
    const status = this.getStatus();
    if (status === "starting") {
      throw new Error("Session is still starting");
    }
    if (status === "running" || status === "awaiting_permission") {
      throw new Error("Session already has a turn in flight");
    }
    if (status === "closed") {
      throw new Error("Session is closed");
    }

    const userMessage: NewAgentChatMessage = {
      message: displayText,
      sender: USER_SENDER,
      timestamp: formatDateTime(new Date()),
      isVisible: true,
      context,
      content: buildUserDisplayContent(displayText, promptContent),
    };
    const userMessageId = this.store.addMessage(userMessage);

    const turnStartedAtMs = Date.now();
    const placeholder: NewAgentChatMessage = {
      message: "",
      sender: AI_SENDER,
      timestamp: formatDateTime(new Date(turnStartedAtMs)),
      isVisible: true,
      parts: [],
    };
    this.placeholderId = this.store.addMessage(placeholder);
    this.currentMessageIds = new Set();
    this.currentTurnHadRoutedToolActivity = false;
    this.notifyMessages();

    if (this.label === null && !this.backendSummarizesTitle()) {
      this.applyAgentLabel(deriveChatTitleFromMessages(this.store.getDisplayMessages()));
    }

    this.lastMentionedAgents =
      mentionedAgents && mentionedAgents.length > 0 ? mentionedAgents : EMPTY_BACKEND_IDS;

    this.abortController = new AbortController();
    this.lastTurnError = false;
    this.recomputeStatusIfChanged();

    const turn = this.runTurn(displayText, userMessageId, context, turnStartedAtMs, promptContent);
    return { userMessageId, turn };
  }

  private async runTurn(
    displayText: string,
    userMessageId: string,
    context: MessageContext | undefined,
    turnStartedAtMs: number,
    promptContent?: PromptContent[]
  ): Promise<StopReason> {
    const placeholderId = this.placeholderId;
    const sessionId = this.backendSessionId!;
    const signal = this.abortController!.signal;
    try {
      const priorPromptDrain = this.cancelledPromptDrain;
      if (priorPromptDrain) {
        await Promise.race([
          priorPromptDrain,
          new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          }),
        ]);
      }

      const hasWebTabs = (context?.webTabs?.length ?? 0) > 0;
      const webTabBlock = hasWebTabs ? await serializeWebTabContext(context) : "";
      if (placeholderId && this.isOnModelNotEnabled()) {
        return this.refuseTurn(
          placeholderId,
          turnStartedAtMs,
          `This chat's model isn't enabled for ${this.displayNameFor(this.backendId)}. Pick an enabled model to continue.`
        );
      }
      const isFirstTurn = !this.firstPromptSent;
      const projectContextBlock = isFirstTurn ? this.projectContextBlock : null;
      const projectContextUpdates = this.getProjectContextUpdatesFn?.() ?? null;
      const projectContextUpdatesBlock = projectContextUpdates?.block ?? null;

      if (
        this.runFanoutTurn &&
        isFanout(this.lastMentionedAgents, this.backendId) &&
        placeholderId
      ) {
        if (!(await this.ensureMultiAgentEntitlement())) {
          showMultiAgentUpgradePrompt();
          return this.refuseTurn(
            placeholderId,
            turnStartedAtMs,
            "Multi-agent QA is a Copilot Plus feature. Upgrade to mention more than one agent in a turn."
          );
        }

        const historyBlock = buildConversationHistoryBlock(
          this.priorDisplayMessages(userMessageId, placeholderId),
          FANOUT_HISTORY_MAX_CHARS
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
        return await this.runFanoutPath(placeholderId, displayText, promptBlocks, turnStartedAtMs);
      }

      const leadingContextBlock = buildPriorFanoutContextBlock(this.pendingFanoutContext);
      // The agent keeps every earlier turn, so resending an unchanged page fills its context
      // window with copies. https://github.com/Brevilabs/obsidian-copilot-private/issues/667
      const webTabPromptBlock =
        webTabBlock && webTabBlock === this.lastSentWebTabBlock
          ? buildUnchangedWebTabBlock(context?.webTabs ?? [])
          : webTabBlock;
      const promptBlocks = buildPromptBlocks(
        displayText,
        context,
        promptContent,
        webTabPromptBlock,
        projectContextBlock,
        leadingContextBlock,
        projectContextUpdatesBlock
      );

      const req: PromptInput = {
        sessionId,
        prompt: promptBlocks,
      };
      const promptStarted = !signal.aborted;
      let resp: PromptOutput = { stopReason: "cancelled" };
      if (promptStarted) {
        const backingPrompt = this.backend.prompt(req);
        resp = await Promise.race([
          backingPrompt,
          new Promise<PromptOutput>((resolve) => {
            signal.addEventListener("abort", () => resolve({ stopReason: "cancelled" }), {
              once: true,
            });
          }),
        ]);
        if (signal.aborted) {
          const settledPrompt = backingPrompt.then(
            () => undefined,
            () => undefined
          );
          const drain = settledPrompt.then(async () => {
            let activity: number;
            do {
              activity = this.cancelledTurnActivity;
              await new Promise<void>((resolve) =>
                window.setTimeout(resolve, CANCELLED_TURN_QUIET_MS)
              );
            } while (activity !== this.cancelledTurnActivity);
          });
          this.cancelledPromptDrain = drain;
          void drain.then(() => {
            if (this.cancelledPromptDrain === drain) this.cancelledPromptDrain = null;
          });
          resp = { stopReason: "cancelled" };
        }
      }
      if (leadingContextBlock !== null && resp.stopReason !== "cancelled") {
        this.pendingFanoutContext = [];
      }
      if (isFirstTurn && promptStarted) this.firstPromptSent = true;
      if (webTabBlock && promptStarted) this.lastSentWebTabBlock = webTabBlock;
      if (projectContextUpdates && promptStarted) {
        this.markProjectContextUpdatesDeliveredFn?.(projectContextUpdates.epoch);
      }
      if (
        placeholderId &&
        resp.stopReason !== "cancelled" &&
        !this.currentTurnHadRoutedToolActivity &&
        !this.store.hasAssistantActivity(placeholderId)
      ) {
        const message = buildEmptyTurnMessage(this.backendId, resp.stopReason);
        logWarn(
          `[AgentMode] ${this.backendId} completed a turn without assistant text or tool activity (stopReason=${resp.stopReason})`
        );
        this.store.markMessageError(placeholderId, message);
      }
      if (
        placeholderId &&
        this.store.markTurnComplete(placeholderId, resp.stopReason, Date.now() - turnStartedAtMs)
      ) {
        this.notifyMessages();
      }
      if (placeholderId && resp.stopReason !== "cancelled") {
        this.settledStream = {
          placeholderId,
          messageIds: this.currentMessageIds,
          turnStartedAtMs,
        };
      } else if (resp.stopReason === "cancelled") {
        this.settledStream = null;
      }
      this.currentMessageIds = new Set();
      if (this.placeholderId === placeholderId) this.placeholderId = null;
      if (resp.stopReason === "end_turn") void this.pollSessionTitle();
      return resp.stopReason;
    } catch (err) {
      logWarn(`[AgentMode] prompt failed`, err);
      if (placeholderId) {
        this.store.markMessageError(
          placeholderId,
          formatPromptFailure(err),
          Date.now() - turnStartedAtMs
        );
        this.notifyMessages();
      }
      this.lastTurnError = true;
      this.currentMessageIds = new Set();
      if (this.placeholderId === placeholderId) this.placeholderId = null;
      throw err;
    } finally {
      this.abortController = null;
      this.recomputeStatusIfChanged();
    }
  }

  private ensureMultiAgentEntitlement(): Promise<boolean> {
    return ensureMultiAgentEntitlement(this.getApp?.());
  }

  private refuseTurn(placeholderId: string, turnStartedAtMs: number, message: string): StopReason {
    this.store.markMessageError(placeholderId, message);
    this.store.markTurnComplete(placeholderId, "refusal", Date.now() - turnStartedAtMs);
    this.currentMessageIds = new Set();
    if (this.placeholderId === placeholderId) this.placeholderId = null;
    this.notifyMessages();
    return "refusal";
  }

  private async runFanoutPath(
    placeholderId: string,
    originalPromptText: string,
    promptBlocks: PromptContent[],
    turnStartedAtMs: number
  ): Promise<StopReason> {
    const signal = this.abortController?.signal ?? new AbortController().signal;
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
    if (this.placeholderId === placeholderId) this.placeholderId = null;
    return stopReason;
  }

  private priorDisplayMessages(
    userMessageId: string,
    placeholderId: string
  ): readonly AgentChatMessage[] {
    return this.store
      .getDisplayMessages()
      .filter((m) => m.id !== userMessageId && m.id !== placeholderId);
  }

  private displayNameFor(backendId: BackendId): string {
    return this.getDisplayName?.(backendId) ?? backendId;
  }

  async cancel(): Promise<void> {
    const status = this.getStatus();
    if (status !== "running" && status !== "awaiting_permission") return;
    if (!this.backendSessionId) return;
    this.abortController?.abort();
    this.settledStream = null;
    for (const messageId of this.currentMessageIds) this.cancelledMessageIds.add(messageId);
    this.currentMessageIds = new Set();
    if (this.pendingToolResolvers.size > 0) {
      this.flushResolvers(this.pendingToolResolvers);
      this.notifyMessages();
    }
    if (this.pendingQuestionResolvers.size > 0) {
      this.flushQuestionResolvers();
      this.notifyMessages();
    }
    try {
      await this.backend.cancel({ sessionId: this.backendSessionId });
    } catch (e) {
      logWarn(`[AgentMode] cancel notification failed`, e);
    }
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
    this.flushResolvers(this.pendingPlanResolvers);
    this.flushResolvers(this.pendingToolResolvers);
    this.flushQuestionResolvers();
    this.decidedPlanToolCallIds.clear();
    this.currentPlan = null;
    this.currentTodoList = null;
    this.currentTodoListSignature = null;
    this.settledStream = null;
    this.cancelledPromptDrain = null;
    this.cancelledMessageIds.clear();
    this.currentMessageIds = new Set();
    this.recomputeStatusIfChanged();
    this.cancelScheduledNotify();
    this.listeners.clear();
  }

  handlePlanProposalPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    const toolCallId = request.toolCall.toolCallId;
    const exitPlan = tryReadExitPlanModeCall({
      kind: request.toolCall.kind,
      rawInput: request.toolCall.rawInput,
      isPlanProposal: request.toolCall.isPlanProposal,
    });
    if (exitPlan) {
      this.publishGatedPlan(toolCallId, exitPlan);
    }
    return new Promise<PermissionDecision>((resolve) => {
      this.pendingPlanResolvers.set(toolCallId, { request, resolve });
      this.recomputeStatusIfChanged();
      this.notifyMessages();
    });
  }

  resolvePlanProposalPermission(toolCallId: string, allow: boolean, denyMessage?: string): void {
    const entry = this.pendingPlanResolvers.get(toolCallId);
    if (!entry) return;
    this.pendingPlanResolvers.delete(toolCallId);
    const base = decisionFor(
      entry.request,
      allow ? PERMISSION_ALLOW_KINDS : PERMISSION_REJECT_KINDS
    );
    const decision: PermissionDecision = !allow && denyMessage ? { ...base, denyMessage } : base;
    entry.resolve(decision);
    this.recomputeStatusIfChanged();
    this.notifyMessages();
  }

  getCurrentPlan(): CurrentPlan | null {
    return this.currentPlan;
  }

  getCurrentTodoList(): AgentTodoListEntry[] | null {
    return this.currentTodoList;
  }

  getSessionUsage(): SessionUsage | null {
    return this.currentUsage;
  }

  getPlanUsage(): PlanUsage | null {
    return this.currentPlanUsage;
  }

  seedSessionUsage(usage: SessionUsage | undefined): void {
    if (!usage) return;
    this.currentUsage = usage;
    this.notifyMessages();
    // A persisted snapshot can predate the model's window being known — hosted models
    // never carry one on the wire, and older chats were saved before windows were
    // filled in at all — so without this a reopened chat shows a bare count until its
    // next turn (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
    if (usage.contextWindow === undefined) void this.fillSeededContextWindow(usage);
  }

  private async fillSeededContextWindow(seeded: SessionUsage): Promise<void> {
    if (!this.backend.readContextWindow) return;
    // A chat with no resumable backend session is seeded into a freshly created one,
    // BEFORE its `newSession` has resolved — so at call time the model is not known
    // yet. Wait for startup to settle rather than silently skipping, or exactly those
    // older chats would stay count-only until their next turn
    // (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
    try {
      await this.ready;
    } catch {
      return;
    }
    const wireModelId = this.currentState?.model?.current.baseModelId ?? null;
    if (!wireModelId) return;
    let contextWindow: number | null = null;
    try {
      contextWindow = await this.backend.readContextWindow(wireModelId);
    } catch {
      return;
    }
    if (!contextWindow) return;
    if (this.currentUsage !== seeded) return;
    if (this.currentState?.model?.current.baseModelId !== wireModelId) return;
    this.currentUsage = { ...seeded, contextWindow };
    this.notifyMessages();
  }

  private applyUsageUpdate(usage: SessionUsage): void {
    // Some backends use zero as an empty terminal snapshot after cancellation.
    // It does not measure consumed context, so wait for a positive reading.
    // https://github.com/logancyang/obsidian-copilot/issues/2975
    if (!usage.usedTokens) return;
    if (usage.contextWindow === undefined && this.currentUsage?.contextWindow !== undefined) {
      return;
    }
    this.currentUsage = usage;
    this.notifyMessages();
  }

  /**
   * Drop the held context window when the model changes, keeping the count. `applyUsageUpdate`
   * ignores windowless snapshots while a windowed one is held, so a stale window would stick.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/193
   */
  private dropUsageWindowOnModelChange(next: BackendState | null): void {
    const before = this.currentState?.model?.current.baseModelId;
    const after = next?.model?.current.baseModelId;
    if (!before || !after || before === after) return;
    if (this.currentUsage?.contextWindow === undefined) return;
    this.currentUsage = { ...this.currentUsage, contextWindow: undefined };
    this.notifyMessages();
  }

  finalizePlanDecision(
    proposalId: string,
    decision?: PlanDecisionAction,
    feedbackText?: string
  ): boolean {
    if (!this.currentPlan || this.currentPlan.id !== proposalId) return false;
    if (this.currentPlan.pendingToolCallId) {
      this.decidedPlanToolCallIds.add(this.currentPlan.pendingToolCallId);
      if (decision) {
        const summary =
          decision === "approve"
            ? "Approved plan"
            : decision === "reject"
              ? "Rejected plan"
              : `Requested plan changes: ${feedbackText ?? "Feedback sent"}`;
        // ACP may report only a titleless completion after the user decides.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/41
        this.recordUserResponse(this.currentPlan.pendingToolCallId, summary);
      }
    }
    this.currentPlan = null;
    this.notifyCurrentPlanChanged();
    return true;
  }

  private setCurrentPlan(next: Omit<CurrentPlan, "id" | "revision" | "decision">): void {
    if (!this.currentPlan) {
      this.planSeq += 1;
      this.currentPlan = {
        ...next,
        id: `plan-${this.internalId}-${this.planSeq}`,
        revision: 1,
        decision: "pending",
      };
      this.notifyCurrentPlanChanged();
      return;
    }
    const prev = this.currentPlan;
    const bodyChanged = prev.body !== next.body;
    const changed =
      bodyChanged ||
      prev.title !== next.title ||
      prev.sourceFilePath !== next.sourceFilePath ||
      prev.permissionGated !== next.permissionGated ||
      prev.pendingToolCallId !== next.pendingToolCallId ||
      prev.decision !== "pending";
    if (!changed) return;
    this.currentPlan = {
      ...prev,
      ...next,
      revision: bodyChanged ? prev.revision + 1 : prev.revision,
      decision: "pending",
    };
    this.notifyCurrentPlanChanged();
  }

  clearCurrentPlanIfModeLeft(): void {
    if (!this.currentPlan) return;
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return;
    if (!descriptor.getModeMapping) return;
    if (this.isCurrentlyInPlanMode()) return;
    const pending = this.currentPlan.pendingToolCallId;
    if (pending) {
      this.resolvePlanProposalPermission(pending, false);
      this.decidedPlanToolCallIds.add(pending);
    }
    this.currentPlan = null;
    this.notifyCurrentPlanChanged();
  }

  hasPendingPlanPermission(): boolean {
    return this.pendingPlanResolvers.size > 0;
  }

  handleToolPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    const toolCallId = request.toolCall.toolCallId;
    return new Promise<PermissionDecision>((resolve) => {
      this.pendingToolResolvers.set(toolCallId, { request, resolve });
      this.recomputeStatusIfChanged();
      this.notifyMessages();
    });
  }

  resolveToolPermission(toolCallId: string, optionId: string): void {
    const entry = this.pendingToolResolvers.get(toolCallId);
    if (!entry) return;
    this.pendingToolResolvers.delete(toolCallId);
    entry.resolve({ outcome: { outcome: "selected", optionId } });
    this.recomputeStatusIfChanged();
    this.notifyMessages();
  }

  getPendingToolPermissions(): PermissionPrompt[] {
    if (this.pendingToolResolvers.size === 0) return EMPTY_PERMISSIONS;
    return Array.from(this.pendingToolResolvers.values(), (e) => e.request);
  }

  handleAskUserQuestion(request: AskUserQuestionPrompt): Promise<AgentQuestionAnswers> {
    const requestId = request.requestId;
    if (request.signal?.aborted) return Promise.resolve(EMPTY_ANSWERS);
    return new Promise<AgentQuestionAnswers>((resolve) => {
      this.pendingQuestionResolvers.set(requestId, { request, resolve });
      // ACP timeout and cancellation withdraw the card without an answer.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
      request.signal?.addEventListener(
        "abort",
        () => this.resolveAskUserQuestion(requestId, EMPTY_ANSWERS),
        { once: true }
      );
      this.recomputeStatusIfChanged();
      this.notifyMessages();
    });
  }

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void {
    const entry = this.pendingQuestionResolvers.get(requestId);
    if (!entry) return;
    this.pendingQuestionResolvers.delete(requestId);
    const responses = entry.request.questions.flatMap((question) => {
      const answer = answers[question.answerKey ?? question.question];
      return answer ? [{ question: question.question, answer }] : [];
    });
    // ACP elicitation may have no tool call of its own; record the submitted
    // answers in the current assistant turn.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
    if (responses.length > 0) {
      const summary = `Answered: ${responses.map(({ answer }) => answer).join("; ")}`;
      const detail = responses.map(({ question, answer }) => `${question}: ${answer}`).join("\n");
      this.recordUserResponse(requestId, summary, detail);
    }
    entry.resolve(answers);
    this.recomputeStatusIfChanged();
    this.notifyMessages();
  }

  private recordUserResponse(toolCallId: string, summary: string, detail?: string): void {
    const messageId = this.store.findMessageIdWithToolCall(toolCallId) ?? this.placeholderId;
    if (!messageId) return;
    const previous = this.findToolCallPart(messageId, toolCallId);
    const part: AgentMessagePart = {
      ...(previous?.kind === "tool_call" ? previous : {}),
      kind: "tool_call",
      id: toolCallId,
      title: summary,
      status: "completed",
      userResponse: summary,
      ...(detail ? { output: [{ type: "text", text: detail }] } : {}),
    };
    if (this.store.upsertAgentPart(messageId, part)) this.notifyMessages();
  }

  getPendingAskUserQuestions(): AskUserQuestionPrompt[] {
    if (this.pendingQuestionResolvers.size === 0) return EMPTY_QUESTIONS;
    return Array.from(this.pendingQuestionResolvers.values(), (e) => e.request);
  }

  private flushResolvers(
    map: Map<string, { request: PermissionPrompt; resolve: (resp: PermissionDecision) => void }>
  ): void {
    for (const { request, resolve } of map.values()) {
      resolve(decisionFor(request, PERMISSION_REJECT_KINDS));
    }
    map.clear();
    this.recomputeStatusIfChanged();
  }

  private flushQuestionResolvers(): void {
    for (const { resolve } of this.pendingQuestionResolvers.values()) {
      resolve(EMPTY_ANSWERS);
    }
    this.pendingQuestionResolvers.clear();
    this.recomputeStatusIfChanged();
  }

  private handleSessionEvent(event: SessionEvent): void {
    const update = event.update;
    // A user message echoed outside the replay is already shown from the prompt that sent it. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
    if (update.sessionUpdate === "user_message_chunk" && !this.historyOpen) return;
    if (this.historyOpen && this.appendHistory(update, event.occurredAt)) {
      this.extendHistoryTurn(event.occurredAt);
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

    if (this.cancelledPromptDrain || this.abortController?.signal.aborted) {
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
        case "agent_thought_chunk":
          this.cancelledTurnActivity += 1;
          if (update.messageId) this.cancelledMessageIds.add(update.messageId);
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
        case "tool_call":
        case "plan":
          this.cancelledTurnActivity += 1;
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
        case "tool_call_update":
          if (isPriorToolUpdate) break;
          this.cancelledTurnActivity += 1;
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
      }
    }

    if (update.sessionUpdate === "plan" && this.applyCurrentTodoList(update.entries)) {
      this.notifyCurrentTodoListChanged();
    }

    if (update.sessionUpdate === "session_info_update") {
      if (this.backendSummarizesTitle()) this.applyAgentLabel(update.title);
      return;
    }
    if (update.sessionUpdate === "state_changed") {
      this.dropUsageWindowOnModelChange(update.state);
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
      this.applyUsageUpdate(update.usage);
      return;
    }
    if (update.sessionUpdate === "plan_usage_update") {
      this.currentPlanUsage = update.planUsage;
      this.notifyMessages();
      return;
    }

    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      const text = extractText(update.content);
      if (!text) return;
      const target = this.resolveContentTarget(update.messageId);
      if (!target) {
        logWarn(`[AgentMode] dropping ${update.sessionUpdate} — no target for ${this.internalId}`);
        return;
      }
      const appended =
        update.sessionUpdate === "agent_message_chunk"
          ? this.store.appendAgentText(target, text)
          : this.store.appendAgentThought(target, text);
      if (appended) {
        if (target === this.settledStream?.placeholderId) {
          this.store.extendTurnDuration(target, Date.now() - this.settledStream.turnStartedAtMs);
        }
        this.scheduleNotifyMessages();
      }
      return;
    }

    const placeholderId = this.placeholderId;
    const targetMessageId = isPriorToolUpdate ? toolOwnerMessageId : placeholderId;
    if (!targetMessageId) {
      logWarn(`[AgentMode] dropping session/update — no placeholder for ${this.internalId}`);
      return;
    }

    switch (update.sessionUpdate) {
      case "tool_call": {
        const exitPlan = tryReadExitPlanModeCall({
          kind: update.kind,
          rawInput: update.rawInput,
          isPlanProposal: update.isPlanProposal,
        });
        if (exitPlan) {
          this.publishGatedPlan(update.toolCallId, exitPlan);
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
        if (targetMessageId !== placeholderId) this.currentTurnHadRoutedToolActivity = true;
        const existing = this.findToolCallPart(targetMessageId, update.toolCallId);
        const merged = mergeToolCallUpdate(existing, update);
        if (merged.kind === "tool_call") {
          const exitPlan = tryReadExitPlanModeCall({
            kind: update.kind ?? merged.toolKind,
            rawInput: merged.input,
            isPlanProposal: update.isPlanProposal,
          });
          if (exitPlan) {
            this.publishGatedPlan(merged.id, exitPlan);
          }
        }
        if (this.store.upsertAgentPart(targetMessageId, merged)) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "plan": {
        if (this.store.upsertAgentPart(targetMessageId, planToPart(update))) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      default:
        logInfo(
          `[AgentMode] ignoring session/update kind=${(update as { sessionUpdate: string }).sessionUpdate}`
        );
        return;
    }
  }

  // Frames replayed before the load response are the chat's past turns, not a turn in flight. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
  private appendHistory(update: SessionEvent["update"], occurredAt: number | undefined): boolean {
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const text = extractText(update.content);
        const current = this.historyUser;
        if (current && update.messageId !== undefined && current.wireId === update.messageId) {
          current.raw += text;
          return true;
        }
        if (!text.trim()) return true;
        this.flushHistoryUser();
        this.historyAiId = null;
        this.historyUser = { wireId: update.messageId, raw: text, occurredAt };
        this.historyTurnStartedAt = occurredAt;
        return true;
      }
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const text = extractText(update.content);
        if (!text) return true;
        const id = this.historyAiBubbleId(occurredAt);
        const appended =
          update.sessionUpdate === "agent_message_chunk"
            ? this.store.appendAgentText(id, text)
            : this.store.appendAgentThought(id, text);
        if (appended) this.scheduleNotifyMessages();
        return true;
      }
      case "tool_call":
        if (
          this.store.upsertAgentPart(this.historyAiBubbleId(occurredAt), toolCallToPart(update))
        ) {
          this.scheduleNotifyMessages();
        }
        return true;
      case "tool_call_update": {
        const id =
          this.store.findMessageIdWithToolCall(update.toolCallId) ??
          this.historyAiBubbleId(occurredAt);
        const merged = mergeToolCallUpdate(this.findToolCallPart(id, update.toolCallId), update);
        if (this.store.upsertAgentPart(id, merged)) this.scheduleNotifyMessages();
        return true;
      }
      case "plan":
        if (this.store.upsertAgentPart(this.historyAiBubbleId(occurredAt), planToPart(update))) {
          this.scheduleNotifyMessages();
        }
        // The last replayed task list is the one the chat closed with, so the project popover shows it again. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
        if (this.applyCurrentTodoList(update.entries)) this.notifyCurrentTodoListChanged();
        return true;
      default:
        return false;
    }
  }

  // A prompt's context envelope stays hidden until its wrapper is complete, so a user bubble waits for the message to end. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
  private flushHistoryUser(): void {
    const pending = this.historyUser;
    this.historyUser = null;
    if (!pending) return;
    this.store.addMessage({
      message: stripUserMessageWrapper(pending.raw),
      sender: USER_SENDER,
      timestamp: historyTimestamp(pending.occurredAt),
      isVisible: true,
    });
    this.scheduleNotifyMessages();
  }

  private historyAiBubbleId(occurredAt: number | undefined): string {
    if (this.historyAiId) return this.historyAiId;
    this.flushHistoryUser();
    const startedAt = this.historyTurnStartedAt;
    this.historyAiId = this.store.addMessage({
      message: "",
      sender: AI_SENDER,
      timestamp: historyTimestamp(occurredAt),
      isVisible: true,
      parts: [],
      turnDurationMs:
        startedAt === undefined || occurredAt === undefined
          ? undefined
          : Math.max(0, occurredAt - startedAt),
    });
    return this.historyAiId;
  }

  // A replayed turn lasts from its prompt to its last timed frame; frames from an agent that sends no times leave it untimed. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
  private extendHistoryTurn(occurredAt: number | undefined): void {
    const startedAt = this.historyTurnStartedAt;
    if (!this.historyAiId || startedAt === undefined || occurredAt === undefined) return;
    if (this.store.extendTurnDuration(this.historyAiId, occurredAt - startedAt)) {
      this.scheduleNotifyMessages();
    }
  }

  private endHistory(): void {
    this.flushHistoryUser();
    this.historyOpen = false;
    this.historyAiId = null;
    this.historyTurnStartedAt = undefined;
  }

  private resolveContentTarget(messageId: string | undefined): string | null {
    if (
      this.cancelledPromptDrain ||
      this.abortController?.signal.aborted ||
      (messageId !== undefined && this.cancelledMessageIds.has(messageId))
    ) {
      return null;
    }
    if (messageId && this.settledStream?.messageIds.has(messageId)) {
      return this.settledStream.placeholderId;
    }
    const placeholderId = this.placeholderId;
    if (!placeholderId) return null;
    if (messageId) this.currentMessageIds.add(messageId);
    return placeholderId;
  }

  private findToolCallPart(messageId: string, toolCallId: string): AgentMessagePart | undefined {
    const msg = this.store.getMessage(messageId);
    return msg?.parts?.find((p) => p.kind === "tool_call" && p.id === toolCallId);
  }

  private publishGatedPlan(
    toolCallId: string,
    info: { plan: string; planFilePath?: string }
  ): void {
    if (this.decidedPlanToolCallIds.has(toolCallId)) return;
    const stale = this.currentPlan?.pendingToolCallId;
    if (stale && stale !== toolCallId) this.resolvePlanProposalPermission(stale, false);
    const title = derivePlanTitleFromMarkdown(info.plan);
    this.setCurrentPlan({
      body: info.plan,
      title,
      sourceFilePath: info.planFilePath,
      permissionGated: true,
      pendingToolCallId: toolCallId,
    });
  }

  private isCurrentlyInPlanMode(): boolean {
    return this.currentState?.mode?.current === "plan";
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

  private applyCurrentTodoList(entries: AgentPlanEntry[]): boolean {
    const next: AgentTodoListEntry[] = entries.map((e) => ({
      content: e.content,
      status: e.status,
    }));
    const signature = next.length > 0 ? JSON.stringify(next) : null;
    if (signature === this.currentTodoListSignature) return false;
    this.currentTodoList = next.length > 0 ? next : null;
    this.currentTodoListSignature = signature;
    return true;
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

function buildEmptyTurnMessage(backendId: BackendId, stopReason: StopReason): string {
  return `${backendId} finished the turn without returning any assistant text or tool activity (stop reason: ${stopReason}). Try again, or switch models if this repeats.`;
}

function formatPromptFailure(err: unknown): string {
  const base = err2String(err);
  const providerMessage = extractProviderErrorMessage(err);
  if (!providerMessage || base.includes(providerMessage)) return base;
  return `${base}\n${providerMessage}`;
}

function extractProviderErrorMessage(err: unknown): string | null {
  const found = findProviderErrorPayload(err, new Set<unknown>());
  if (!found) return null;
  const type = typeof found.type === "string" ? found.type : "ProviderError";
  const message = typeof found.message === "string" ? found.message : null;
  if (!message) return type;
  return `${type}: ${message}`;
}

function findProviderErrorPayload(
  value: unknown,
  seen: Set<unknown>
): { type?: unknown; message?: unknown } | null {
  if (value === null || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const record = value as Record<string, unknown>;
  const directError = record.error;
  if (directError && typeof directError === "object") {
    const errorRecord = directError as Record<string, unknown>;
    if (typeof errorRecord.message === "string" || typeof errorRecord.type === "string") {
      return { type: errorRecord.type, message: errorRecord.message };
    }
  }
  if (typeof record.message === "string") {
    const parsed = tryParseJsonObject(record.message);
    if (parsed) {
      const nested = findProviderErrorPayload(parsed, seen);
      if (nested) return nested;
    }
  }
  if (record.data) {
    const nested = findProviderErrorPayload(record.data, seen);
    if (nested) return nested;
  }
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      const nested = findProviderErrorPayload(item, seen);
      if (nested) return nested;
    }
  }
  const cause = record.cause;
  if (cause) return findProviderErrorPayload(cause, seen);
  return null;
}

function tryParseJsonObject(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type DisplayContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildUserDisplayContent(
  displayText: string,
  promptContent?: PromptContent[]
): DisplayContentItem[] | undefined {
  const images = (promptContent ?? []).filter(
    (p): p is Extract<PromptContent, { type: "image" }> => p.type === "image"
  );
  if (images.length === 0) return undefined;
  const content: DisplayContentItem[] = [];
  if (displayText.trim()) content.push({ type: "text", text: displayText });
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    });
  }
  return content;
}

export function buildPromptBlocks(
  displayText: string,
  context?: MessageContext,
  content?: PromptContent[],
  webTabBlock?: string,
  projectContextBlock?: string | null,
  leadingContextBlock?: string | null,
  projectContextUpdatesBlock?: string | null
): PromptContent[] {
  const sections = [
    projectContextBlock?.trim() || null,
    projectContextUpdatesBlock?.trim() || null,
    leadingContextBlock?.trim() || null,
    buildContextEnvelope(context),
    buildWebSelectionBlocks(context),
    webTabBlock?.trim() || null,
  ].filter((s): s is string => Boolean(s));
  const head = sections.length > 0 ? sections.join("\n\n") : null;
  const headText = head
    ? `${head}\n\n<user-message>\n${displayText}\n</user-message>`
    : displayText;
  const extras = content ?? [];
  if (extras.length === 0) return [{ type: "text", text: headText }];
  return [{ type: "text", text: headText }, ...extras];
}

export function withReadOnlyPreamble(blocks: PromptContent[]): PromptContent[] {
  const i = blocks.findIndex((b) => b.type === "text");
  if (i === -1) return [{ type: "text", text: FANOUT_READONLY_PREAMBLE }, ...blocks];
  const block = blocks[i] as Extract<PromptContent, { type: "text" }>;
  const out = blocks.slice();
  out[i] = { type: "text", text: `${FANOUT_READONLY_PREAMBLE}\n\n${block.text}` };
  return out;
}

async function serializeWebTabContext(context: MessageContext | undefined): Promise<string> {
  const webTabs = context?.webTabs;
  if (!webTabs || webTabs.length === 0) return "";
  return (await ContextProcessor.getInstance().processContextWebTabs(webTabs)).trim();
}

function buildUnchangedWebTabBlock(webTabs: readonly WebTabContext[]): string {
  return [
    "<web_tabs_unchanged>",
    "Same content as already sent earlier in this conversation:",
    ...webTabs.map(
      (tab) =>
        `- ${escapeXml(tab.title || tab.url)} (${escapeXml(tab.url)})${tab.isActive ? " [active]" : ""}`
    ),
    "</web_tabs_unchanged>",
  ].join("\n");
}

function buildWebSelectionBlocks(context: MessageContext | undefined): string | null {
  const selections = (context?.selectedTextContexts ?? []).filter(isWebSelectedTextContext);
  if (selections.length === 0) return null;
  return selections
    .map((s) =>
      [
        `<${WEB_SELECTED_TEXT_TAG}>`,
        `<title>${escapeXml(s.title)}</title>`,
        `<url>${escapeXml(s.url)}</url>`,
        `<content>\n${escapeXml(s.content)}\n</content>`,
        `</${WEB_SELECTED_TEXT_TAG}>`,
      ].join("\n")
    )
    .join("\n\n");
}

function buildContextEnvelope(context: MessageContext | undefined): string | null {
  if (!context) return null;
  const notePaths = (context.notes ?? []).map((n) => n.path).filter(Boolean);
  const excerpts = (context.selectedTextContexts ?? []).filter(isNoteSelectedTextContext);
  if (notePaths.length === 0 && excerpts.length === 0) return null;

  const lines: string[] = [
    "<copilot-context>",
    "The user attached the following vault items. The vault is your current working directory; use the Read tool to inspect them when relevant.",
  ];
  if (notePaths.length > 0) {
    lines.push("", "Notes:");
    for (const p of notePaths) lines.push(`- ${p}`);
  }
  if (excerpts.length > 0) {
    lines.push("", "Selected excerpts (already inlined; no need to re-read):");
    for (const e of excerpts) {
      const location = e.startLine > 0 ? ` (lines ${e.startLine}-${e.endLine})` : "";
      lines.push(`- ${e.notePath}${location}:`);
      for (const l of e.content.split("\n")) lines.push(`  ${l}`);
    }
  }
  lines.push("</copilot-context>");
  return lines.join("\n");
}

function extractText(content: PromptContent): string {
  if (content.type === "text") return content.text;
  return "";
}

function toolCallToPart(
  call: ToolCallSnapshot & { sessionUpdate?: "tool_call" }
): AgentMessagePart {
  return {
    kind: "tool_call",
    id: call.toolCallId,
    title: call.title,
    toolKind: call.kind,
    status: call.status ?? "pending",
    input: call.rawInput,
    output: extractToolCallOutputs(call.content),
    locations: call.locations?.map((l) => ({ path: l.path, line: l.line ?? undefined })),
    vendorToolName: call.vendorToolName,
    mcpServer: call.mcpServer,
    parentToolCallId: call.parentToolCallId,
    progress: call.progress,
  };
}

export function tryReadExitPlanModeCall(args: {
  kind?: string;
  rawInput: unknown;
  isPlanProposal?: boolean;
}): { plan: string; planFilePath?: string } | null {
  const raw = args.rawInput as { plan?: unknown; planFilePath?: unknown } | null | undefined;
  const plan = raw?.plan;
  if (typeof plan !== "string") return null;
  if (!args.isPlanProposal && args.kind !== "switch_mode") return null;
  const planFilePath = typeof raw?.planFilePath === "string" ? raw.planFilePath : undefined;
  return { plan, planFilePath };
}

function derivePlanTitleFromMarkdown(md: string): string {
  for (const line of md.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, "").slice(0, 80);
  }
  return "Plan proposal";
}

function mergeToolCallUpdate(
  existing: AgentMessagePart | undefined,
  upd: ToolCallDelta & { sessionUpdate?: "tool_call_update" }
): AgentMessagePart {
  const base: AgentMessagePart =
    existing && existing.kind === "tool_call"
      ? existing
      : {
          kind: "tool_call",
          id: upd.toolCallId,
          title: upd.title ?? "Tool call",
          status: "pending",
        };
  if (base.kind !== "tool_call") return base;
  return {
    ...base,
    title: upd.title ?? base.title,
    toolKind: upd.kind ?? base.toolKind,
    status: upd.status ?? base.status,
    input: upd.rawInput !== undefined ? upd.rawInput : base.input,
    output:
      upd.content !== undefined && upd.content !== null
        ? extractToolCallOutputs(upd.content)
        : base.output,
    locations:
      upd.locations !== undefined && upd.locations !== null
        ? upd.locations.map((l) => ({ path: l.path, line: l.line ?? undefined }))
        : base.locations,
    vendorToolName: upd.vendorToolName ?? base.vendorToolName,
    mcpServer: upd.mcpServer ?? base.mcpServer,
    parentToolCallId: upd.parentToolCallId ?? base.parentToolCallId,
    progress: upd.progress === undefined ? base.progress : { ...base.progress, ...upd.progress },
  };
}

function extractToolCallOutputs(
  content: ToolCallContent[] | null | undefined
): AgentToolCallOutput[] | undefined {
  if (!content) return undefined;
  const outputs: AgentToolCallOutput[] = [];
  for (const item of content) {
    if (item.type === "content" && item.content.type === "text") {
      outputs.push(capToolOutputText(item.content.text));
    } else if (item.type === "diff") {
      outputs.push({
        type: "diff",
        path: item.path,
        oldText: item.oldText ?? null,
        newText: item.newText,
      });
    }
  }
  return outputs.length > 0 ? outputs : undefined;
}

function capToolOutputText(text: string): AgentToolCallOutput {
  if (text.length <= MAX_TOOL_OUTPUT_TEXT_CHARS) return { type: "text", text };
  const omitted = text.length - MAX_TOOL_OUTPUT_TEXT_CHARS;
  return {
    type: "text",
    text:
      text.slice(0, MAX_TOOL_OUTPUT_TEXT_CHARS) +
      `\n\n[Display trimmed: ${omitted.toLocaleString()} more characters. The agent received the full output.]`,
  };
}

function decisionFor(
  req: PermissionPrompt,
  kinds: ReadonlyArray<PermissionOptionKind>
): PermissionDecision {
  for (const k of kinds) {
    const opt = req.options.find((o) => o.kind === k);
    if (opt) return { outcome: { outcome: "selected", optionId: opt.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

function planToPart(plan: PlanSummary & { sessionUpdate?: "plan" }): AgentMessagePart {
  return {
    kind: "plan",
    entries: plan.entries.map((e) => ({
      content: e.content,
      priority: e.priority,
      status: e.status,
    })),
  };
}

function historyTimestamp(occurredAt: number | undefined): FormattedDateTime | null {
  return occurredAt === undefined ? null : formatDateTime(new Date(occurredAt));
}
