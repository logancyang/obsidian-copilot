import { AI_SENDER, USER_SENDER } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import {
  AgentMessagePart,
  AgentToolCallOutput,
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  CurrentPlan,
  NewAgentChatMessage,
  PERMISSION_ALLOW_KINDS,
  PERMISSION_REJECT_KINDS,
  PermissionDecision,
  PermissionOptionKind,
  PermissionPrompt,
  PlanSummary,
  PromptContent,
  PromptInput,
  SessionEvent,
  SessionId,
  StopReason,
  ToolCallContent,
  ToolCallDelta,
  ToolCallSnapshot,
} from "@/agentMode/session/types";
import { isNoteSelectedTextContext, MessageContext } from "@/types/message";
import { err2String, formatDateTime } from "@/utils";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { resolveMcpServers } from "@/agentMode/session/mcpResolver";
import { getSettings } from "@/settings/model";

/**
 * Prefix opencode uses for placeholder titles before its title-summarizer
 * agent runs. Treating these as "no title" prevents the tab from briefly
 * showing "New session - 2026-…" before the LLM-generated label arrives.
 */
const DEFAULT_TITLE_PREFIX = "New session";
const MAX_TOOL_OUTPUT_TEXT_CHARS = 12_000;

export type AgentSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

/**
 * Statuses that demand the user's eye when reached from `running` on a
 * backgrounded tab. The manager uses this to decide when to flag
 * `needsAttention`. Co-located with the union so adding a new status forces
 * a deliberate decision about whether it belongs here.
 */
export const ATTENTION_TRIGGER_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "idle",
  "error",
  "awaiting_permission",
]);

export interface AgentSessionListener {
  onMessagesChanged(): void;
  onStatusChanged(status: AgentSessionStatus): void;
  /**
   * Optional: fired when model, configOption, or mode state changes. The
   * picker treats all three as one notification channel — they all cause it
   * to rebuild and there's no value in fanning out separate callbacks.
   */
  onModelChanged?(): void;
  /** Optional: fired when the user-visible label changes. */
  onLabelChanged?(): void;
  /**
   * Optional: fired when the singleton `currentPlan` changes (created,
   * revised in place, or cleared). The floating plan card / preview tab
   * subscribe to this channel.
   */
  onCurrentPlanChanged?(): void;
  /**
   * Optional: fired when the "needs attention" flag flips. The tab strip
   * subscribes to render an accent dot on the brand icon for backgrounded
   * sessions that finished, errored, or paused for permission while the
   * user was looking at a different tab.
   */
  onNeedsAttentionChanged?(needsAttention: boolean): void;
}

export interface AgentSessionStartOptions {
  backend: BackendProcess;
  cwd: string;
  internalId: string;
  backendId: BackendId;
  defaultModelId?: string;
  /**
   * Optional descriptor accessor. The session uses it to resolve mode mappings
   * without coupling to specific backends. Manager-supplied; tests omit it.
   */
  getDescriptor?: () => BackendDescriptor | undefined;
}

/**
 * Pre-resolved state used by tests and by `loadSessionFromHistory` to
 * construct a session that bypasses the async backend startup.
 */
export interface AgentSessionStateOptions {
  backend: BackendProcess;
  backendSessionId: SessionId;
  internalId: string;
  backendId: BackendId;
  initialState?: BackendState | null;
  cwd?: string | null;
  getDescriptor?: () => BackendDescriptor | undefined;
}

/**
 * Per-chat Agent Mode session. Owns its `AgentMessageStore`, the lifecycle
 * of one backend session id, and the `AbortController` that cancels in-flight
 * turns.
 *
 * Construction is split: `AgentSession.start()` returns synchronously with
 * status `"starting"` so the UI can swap to the new (empty) chat immediately.
 * The backend `newSession` runs in the background; once it resolves the
 * session transitions to `"idle"` and `sendPrompt` becomes usable. While
 * starting, `sendPrompt` throws — the chat UI gates the send button on
 * `getStatus() === "starting"`.
 */
export class AgentSession {
  readonly store = new AgentMessageStore();
  readonly internalId: string;
  readonly backendId: BackendId;
  /** Resolves when `newSession` succeeds; rejects when it fails. */
  readonly ready: Promise<void>;
  private backendSessionId: SessionId | null = null;
  private readonly backend: BackendProcess;
  private readonly cwd: string | null;
  private readonly getDescriptor: (() => BackendDescriptor | undefined) | null;
  private status: AgentSessionStatus = "starting";
  private placeholderId: string | null = null;
  private abortController: AbortController | null = null;
  private listeners = new Set<AgentSessionListener>();
  private unregisterSessionHandler: (() => void) | null = null;
  /**
   * Cached normalized state — produced by the backend at session start /
   * resume / load and refreshed via `state_changed` events or per-dimension
   * `setSession*` responses.
   */
  private currentState: BackendState | null = null;
  private label: string | null = null;
  // Tracks who set the current label so an agent-pushed `session_info_update`
  // can't clobber a label the user explicitly chose via Rename.
  private labelSource: "user" | "agent" | null = null;
  private disposed = false;
  // Pending permission resolvers keyed by toolCallId. Populated when an
  // ExitPlanMode permission request arrives (via the wrapped prompter); the
  // chat card resolves them through `resolvePlanProposalPermission`.
  private pendingPlanResolvers = new Map<
    string,
    {
      request: PermissionPrompt;
      resolve: (resp: PermissionDecision) => void;
    }
  >();
  // Singleton "current plan" for the floating card. At most one per session
  // while in canonical plan mode and a plan has been proposed; cleared on a
  // terminal user decision or when the canonical mode flips out of plan.
  private currentPlan: CurrentPlan | null = null;
  // Monotonic counter for `currentPlan.id` so the React tree can detect a
  // *new* plan-mode review (vs. an in-place revision that bumps `revision`).
  private planSeq = 0;
  // Tool-call ids the user has already finalized a decision on.
  private decidedPlanToolCallIds = new Set<string>();
  // True when something happened (turn ended, error, permission prompt) while
  // this session was not the active tab. The manager owns the policy for
  // setting this; the session just exposes the flag and notification channel.
  private needsAttention = false;
  // Streaming backends emit `agent_message_chunk`/`agent_thought_chunk` and
  // (for codex) `tool_call_update` at up to ~160 fps. We update the store
  // immediately but coalesce the React-facing `onMessagesChanged` callback
  // to one fire per animation frame so the trail doesn't rerender 200×/sec.
  // Non-streaming callers use `notifyMessages()` directly for immediate
  // flush on turn end / error / permission prompts.
  private notifyScheduled = false;
  private notifyHandle: ReturnType<typeof setTimeout> | number | null = null;

  /** Prefer `AgentSession.start(...)` in production so backend startup runs async. */
  constructor(opts: AgentSessionStateOptions | AgentSessionStartOptions) {
    this.backend = opts.backend;
    this.internalId = opts.internalId;
    this.backendId = opts.backendId;
    this.cwd = opts.cwd ?? null;
    this.getDescriptor = opts.getDescriptor ?? null;
    if ("backendSessionId" in opts) {
      this.backendSessionId = opts.backendSessionId;
      this.currentState = opts.initialState ?? null;
      this.unregisterSessionHandler = this.backend.registerSessionHandler(
        opts.backendSessionId,
        (event) => this.handleSessionEvent(event)
      );
      this.status = "idle";
      this.ready = Promise.resolve();
    } else {
      this.status = "starting";
      this.ready = this.initialize(opts);
    }
  }

  /**
   * Construct an `AgentSession` synchronously and kick off backend
   * initialization in the background. The returned session is immediately
   * registerable with the manager and renderable in the UI; `sendPrompt`
   * is gated until `ready` resolves.
   */
  static start(opts: AgentSessionStartOptions): AgentSession {
    return new AgentSession(opts);
  }

  /** The backend session id, or null while still starting. */
  getBackendSessionId(): SessionId | null {
    return this.backendSessionId;
  }

  private async initialize(opts: AgentSessionStartOptions): Promise<void> {
    const { backend, cwd, defaultModelId } = opts;
    try {
      const resp = await backend.newSession({
        cwd,
        mcpServers: resolveMcpServers(backend, getSettings().agentMode?.mcpServers),
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
      // dispose() may have run between newSession resolving and now.
      if (this.disposed) {
        this.unregisterSessionHandler();
        this.unregisterSessionHandler = null;
        return;
      }
      this.setStatus("idle");
      this.notifyModelChanged();

      // Apply sticky preference. Best-effort — failures leave the session
      // usable with whatever the agent picked by default.
      if (defaultModelId) {
        try {
          await this.setModel(defaultModelId);
        } catch (e) {
          logWarn(`[AgentMode] could not apply default model ${defaultModelId}`, e);
        }
      }
    } catch (err) {
      if (this.disposed) return;
      logWarn(`[AgentMode] session/new failed for ${this.internalId}`, err);
      this.setStatus("error");
      throw err instanceof Error ? err : new Error(err2String(err));
    }
  }

  /**
   * Latest known unified picker state for this session — model catalog,
   * canonical mode, canonical effort. `null` while the session is still
   * starting and the agent hasn't reported anything yet.
   */
  getState(): BackendState | null {
    return this.currentState;
  }

  /**
   * Switch the active model on this session. On success, replaces the
   * cached `BackendState` with the freshly-translated one returned by the
   * backend and notifies `onModelChanged` listeners.
   *
   * Throws `MethodUnsupportedError` if the backend does not support model
   * switching. Callers should treat that as "model switching is not
   * available" and degrade the UI accordingly.
   */
  async setModel(modelId: string): Promise<void> {
    if (this.status === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionModel({
      sessionId: this.backendSessionId,
      modelId,
    });
    this.currentState = next;
    this.notifyModelChanged();
  }

  /**
   * Set a session configuration option (e.g. effort). Reuses
   * `notifyModelChanged` because the picker treats model and configOption
   * changes as one channel.
   */
  async setConfigOption(configId: string, value: string): Promise<void> {
    if (this.status === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionConfigOption({
      sessionId: this.backendSessionId,
      configId,
      value,
    });
    this.currentState = next;
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  /**
   * Switch the active session mode (claude-code permission mode, codex
   * sandbox preset, etc.). On success, replaces the cached state and
   * notifies `onModelChanged` listeners.
   *
   * Throws `MethodUnsupportedError` when the backend doesn't support mode
   * switching.
   */
  async setMode(modeId: string): Promise<void> {
    if (this.status === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionMode({
      sessionId: this.backendSessionId,
      modeId,
    });
    this.currentState = next;
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  /** Whether the user can swap the active model on this session. */
  canSwitchModel(): boolean | null {
    return this.backend.isSetSessionModelSupported();
  }

  /**
   * Whether the user can swap effort. Descriptor-style backends route
   * effort via `setConfigOption`; suffix-style via `setModel`. The wire
   * routing is encapsulated here — UI consumers ask intent only.
   */
  canSwitchEffort(): boolean | null {
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return null;
    return descriptor.wire.effortConfigFor
      ? this.backend.isSetSessionConfigOptionSupported()
      : this.backend.isSetSessionModelSupported();
  }

  /**
   * Whether the user can swap modes. Each mode option carries its own
   * apply spec (`setMode` or `setConfigOption`); within a single backend
   * the dispatch path is consistent, so we sample the first option.
   */
  canSwitchMode(): boolean | null {
    const mode = this.currentState?.mode;
    if (!mode) return null;
    const sample = mode.options[0];
    if (!sample) return null;
    const spec = mode.apply[sample.value];
    if (!spec) return null;
    return spec.kind === "setConfigOption"
      ? this.backend.isSetSessionConfigOptionSupported()
      : this.backend.isSetSessionModeSupported();
  }

  getStatus(): AgentSessionStatus {
    return this.status;
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

  /**
   * Whether this session has at least one user-visible message. The model
   * picker uses this to decide whether non-active backend entries should be
   * hidden (mid-conversation) or shown (empty new tab).
   */
  hasUserVisibleMessages(): boolean {
    return this.store.getDisplayMessages().length > 0;
  }

  /**
   * User-supplied label for this session (shown in the tab strip). `null`
   * means "no label" — the UI falls back to a positional default like
   * "Session N".
   */
  getLabel(): string | null {
    return this.label;
  }

  setLabel(label: string | null): void {
    const next = label?.trim() ? label.trim() : null;
    if (next === this.label) return;
    this.label = next;
    this.labelSource = next ? "user" : null;
    this.notifyLabelChanged();
  }

  /**
   * Apply a label pushed by the backend agent (via `session_info_update`).
   * No-op when the user has already renamed this session — Rename wins so
   * later agent-side title revisions don't blow away the user's choice.
   */
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

  /**
   * Submit a user prompt. Synchronously appends the user message + an empty
   * assistant placeholder to the store and kicks off the backend prompt.
   * Streaming session events mutate the placeholder in place. Returns:
   *   - `userMessageId`: id of the appended user message.
   *   - `turn`: promise that resolves with `StopReason` when the turn
   *     completes, or rejects on transport errors.
   */
  sendPrompt(
    displayText: string,
    context?: MessageContext,
    content?: unknown[]
  ): { userMessageId: string; turn: Promise<StopReason> } {
    if (this.status === "starting") {
      throw new Error("Session is still starting");
    }
    if (this.status === "running" || this.status === "awaiting_permission") {
      throw new Error("Session already has a turn in flight");
    }
    if (this.status === "closed") {
      throw new Error("Session is closed");
    }

    const userMessage: NewAgentChatMessage = {
      message: displayText,
      sender: USER_SENDER,
      timestamp: formatDateTime(new Date()),
      isVisible: true,
      context,
      content,
    };
    const userMessageId = this.store.addMessage(userMessage);

    const placeholder: NewAgentChatMessage = {
      message: "",
      sender: AI_SENDER,
      timestamp: formatDateTime(new Date()),
      isVisible: true,
      parts: [],
    };
    this.placeholderId = this.store.addMessage(placeholder);
    this.notifyMessages();

    this.abortController = new AbortController();
    this.setStatus("running");

    const turn = this.runTurn(displayText, context, content);
    return { userMessageId, turn };
  }

  private async runTurn(
    displayText: string,
    context: MessageContext | undefined,
    content?: unknown[]
  ): Promise<StopReason> {
    const placeholderId = this.placeholderId;
    const sessionId = this.backendSessionId!;
    const turnStartedAt = Date.now();
    try {
      const promptBlocks = buildPromptBlocks(displayText, context, content);
      const req: PromptInput = {
        sessionId,
        prompt: promptBlocks,
      };
      const resp = await this.backend.prompt(req);
      if (
        placeholderId &&
        resp.stopReason !== "cancelled" &&
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
        this.store.markTurnComplete(placeholderId, resp.stopReason, Date.now() - turnStartedAt)
      ) {
        this.notifyMessages();
      }
      this.setStatus("idle");
      if (this.placeholderId === placeholderId) this.placeholderId = null;
      if (resp.stopReason === "end_turn") void this.pollSessionTitle();
      return resp.stopReason;
    } catch (err) {
      logWarn(`[AgentMode] prompt failed`, err);
      if (placeholderId) {
        this.store.markMessageError(placeholderId, formatPromptFailure(err));
        this.notifyMessages();
      }
      this.setStatus("error");
      if (this.placeholderId === placeholderId) this.placeholderId = null;
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel any in-flight turn. The backend may still emit a few trailing
   * session events before the prompt promise resolves with
   * `stopReason: "cancelled"` — that's expected.
   */
  async cancel(): Promise<void> {
    if (this.status !== "running" && this.status !== "awaiting_permission") return;
    if (!this.backendSessionId) return;
    try {
      await this.backend.cancel({ sessionId: this.backendSessionId });
    } catch (e) {
      logWarn(`[AgentMode] cancel notification failed`, e);
    }
    this.abortController?.abort();
  }

  /** Detach from the backend. Does not cancel — call `cancel()` first. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.unregisterSessionHandler?.();
    this.unregisterSessionHandler = null;
    for (const { request, resolve } of this.pendingPlanResolvers.values()) {
      resolve(decisionFor(request, PERMISSION_REJECT_KINDS));
    }
    this.pendingPlanResolvers.clear();
    this.decidedPlanToolCallIds.clear();
    this.currentPlan = null;
    this.setStatus("closed");
    this.cancelScheduledNotify();
    this.listeners.clear();
  }

  /**
   * Called by the wrapped permission prompter when an ExitPlanMode permission
   * request arrives. Returns a promise the backend will await for the
   * outcome; resolved by the chat card via `resolvePlanProposalPermission`.
   */
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
      this.notifyMessages();
    });
  }

  /**
   * Resolve a pending ExitPlanMode permission. `allow: true` selects the
   * first allow_once option; `false` selects the first reject option (or
   * cancels when no reject option is offered). When denying, an optional
   * `denyMessage` is forwarded as the agent-visible deny reason — used by
   * the plan card to ride user feedback through the same `canUseTool` deny
   * instead of as a separate follow-up turn. No-op when no permission is
   * pending for the given id (e.g. non-gated OpenCode proposals).
   */
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
    this.notifyMessages();
  }

  /** Snapshot of the singleton plan, or `null` if there's nothing to review. */
  getCurrentPlan(): CurrentPlan | null {
    return this.currentPlan;
  }

  /**
   * Drop the current plan once the user has decided. The UI gates the card
   * render on `decision === "pending"`, so a terminal state is never visible
   * to the user — clearing synchronously is fine.
   */
  finalizePlanDecision(proposalId: string): boolean {
    if (!this.currentPlan || this.currentPlan.id !== proposalId) return false;
    if (this.currentPlan.pendingToolCallId) {
      this.decidedPlanToolCallIds.add(this.currentPlan.pendingToolCallId);
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
    // Bump revision only when the body actually changed. Gating /
    // pendingToolCallId / sourceFilePath flips are control-flow signals,
    // not "the plan was revised in place" — they must propagate without
    // resetting the per-tab `decided` state in `PlanPreviewView`, which
    // keys on revision. MarkdownRenderer perf for body-identical
    // republishes is already handled by React's primitive equality on
    // the `planMarkdown` string in the consumer's effect deps.
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

  /** Public — used by mode-picker plumbing to clear the card on mode switch. */
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

  /**
   * Resolve once the session reaches a terminal state for the current turn
   * (`idle`, `error`, or `closed`). Used by the UI orchestrator to await
   * completion of a permission-resolution-then-followup sequence.
   */
  waitForIdle(): Promise<void> {
    const terminal = (s: AgentSessionStatus) => s === "idle" || s === "error" || s === "closed";
    if (this.disposed || terminal(this.status)) return Promise.resolve();
    return new Promise((resolve) => {
      const unsub = this.subscribe({
        onMessagesChanged: () => {},
        onStatusChanged: (s) => {
          if (terminal(s)) {
            unsub();
            resolve();
          }
        },
      });
    });
  }

  /**
   * Whether this session has any pending ExitPlanMode permission. The chat
   * input disables itself while one is outstanding so the user is funneled
   * toward the proposal card's actions.
   */
  hasPendingPlanPermission(): boolean {
    return this.pendingPlanResolvers.size > 0;
  }

  private handleSessionEvent(event: SessionEvent): void {
    const update = event.update;

    // Session-scoped updates aren't tied to a turn placeholder.
    if (update.sessionUpdate === "session_info_update") {
      this.applyAgentLabel(update.title);
      return;
    }
    if (update.sessionUpdate === "state_changed") {
      this.currentState = update.state;
      this.notifyModelChanged();
      this.clearCurrentPlanIfModeLeft();
      return;
    }
    if (update.sessionUpdate === "current_mode_update") {
      // The backend will follow this with a `state_changed` event carrying
      // the recomputed BackendState; nothing to do here.
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      // Same — the `state_changed` follow-up carries the recomputed state.
      return;
    }

    const placeholderId = this.placeholderId;
    if (!placeholderId) {
      logWarn(`[AgentMode] dropping session/update — no placeholder for ${this.internalId}`);
      return;
    }

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = extractText(update.content);
        if (!text) return;
        if (this.store.appendAgentText(placeholderId, text)) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "agent_thought_chunk": {
        const text = extractText(update.content);
        if (!text) return;
        if (this.store.appendAgentThought(placeholderId, text)) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "tool_call": {
        const exitPlan = tryReadExitPlanModeCall({
          kind: update.kind,
          rawInput: update.rawInput,
          isPlanProposal: update.isPlanProposal,
        });
        if (exitPlan) {
          this.publishGatedPlan(update.toolCallId, exitPlan);
          if (this.store.upsertAgentPart(placeholderId, toolCallToPart(update))) {
            this.scheduleNotifyMessages();
          }
          return;
        }
        if (this.store.upsertAgentPart(placeholderId, toolCallToPart(update))) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "tool_call_update": {
        const existing = this.findToolCallPart(placeholderId, update.toolCallId);
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
        if (this.store.upsertAgentPart(placeholderId, merged)) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "plan": {
        if (this.store.upsertAgentPart(placeholderId, planToPart(update))) {
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

  private findToolCallPart(messageId: string, toolCallId: string): AgentMessagePart | undefined {
    const msg = this.store.getMessage(messageId);
    return msg?.parts?.find((p) => p.kind === "tool_call" && p.id === toolCallId);
  }

  /**
   * Handle a fresh `ExitPlanMode` tool_call: open or revise the floating
   * plan card with the new body and route the gated permission resolver
   * id at it.
   */
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

  /** Whether the session is currently in canonical plan mode. */
  private isCurrentlyInPlanMode(): boolean {
    return this.currentState?.mode?.current === "plan";
  }

  private setStatus(next: AgentSessionStatus): void {
    if (this.status === next) return;
    this.status = next;
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

  /**
   * Coalesced variant for streaming hot paths. Multiple calls within a
   * single animation frame collapse to one `onMessagesChanged` fire. Store
   * mutations have already happened synchronously, so subscribers see the
   * latest state on their next render — they just see fewer renders.
   */
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

  /**
   * Pull the agent-generated title for this session via `listSessions` and
   * apply it as the tab label. Best-effort: silently no-ops when the agent
   * doesn't support listing or when the title is still the default.
   */
  private async pollSessionTitle(): Promise<void> {
    if (this.labelSource === "user") return;
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

/** Build the visible message for a completed turn that produced no UI activity. */
function buildEmptyTurnMessage(backendId: BackendId, stopReason: StopReason): string {
  return `${backendId} finished the turn without returning any assistant text or tool activity (stop reason: ${stopReason}). Try again, or switch models if this repeats.`;
}

/** Format prompt failures with provider error details when available. */
function formatPromptFailure(err: unknown): string {
  const base = err2String(err);
  const providerMessage = extractProviderErrorMessage(err);
  if (!providerMessage || base.includes(providerMessage)) return base;
  return `${base}\n${providerMessage}`;
}

/** Extract concise model/provider errors nested inside AI SDK error objects. */
function extractProviderErrorMessage(err: unknown): string | null {
  const found = findProviderErrorPayload(err, new Set<unknown>());
  if (!found) return null;
  const type = typeof found.type === "string" ? found.type : "ProviderError";
  const message = typeof found.message === "string" ? found.message : null;
  if (!message) return type;
  return `${type}: ${message}`;
}

/** Recursively search common AI SDK error shapes for provider error payloads. */
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

export function buildPromptBlocks(
  displayText: string,
  context?: MessageContext,
  content?: unknown[]
): PromptContent[] {
  // TODO(agent-mode): map `content` (image_url / etc.) to PromptContent
  // image/resource entries so attachments aren't silently dropped. Today
  // `AgentChat` strips images before calling sendMessage and surfaces a Notice.
  void content;
  const envelope = buildContextEnvelope(context);
  if (!envelope) return [{ type: "text", text: displayText }];
  return [{ type: "text", text: `${envelope}\n\n<user-message>\n${displayText}\n</user-message>` }];
}

/**
 * Build the `<copilot-context>` envelope listing attached vault paths and
 * inlining note excerpts. Returns `null` when there's nothing to attach.
 */
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
      lines.push(`- ${e.notePath} (lines ${e.startLine}-${e.endLine}):`);
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
    parentToolCallId: call.parentToolCallId,
  };
}

/**
 * Detect whether a tool_call / tool_call_update represents the agent's
 * plan-finalization signal. Returns the parsed payload (`plan`, optional
 * `planFilePath`) when so, or `null` otherwise.
 */
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
    parentToolCallId: upd.parentToolCallId ?? base.parentToolCallId,
  };
}

function extractToolCallOutputs(
  content: ToolCallContent[] | null | undefined
): AgentToolCallOutput[] | undefined {
  if (!content) return undefined;
  const outputs: AgentToolCallOutput[] = [];
  for (const item of content) {
    if (item.type === "content" && item.content.type === "text") {
      outputs.push(truncateToolOutputText(item.content.text));
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

/**
 * Keep large command/search results out of long-lived React state. The full
 * frame log still captures diagnostic summaries; the UI only needs enough
 * text to identify the result and avoid runaway memory growth.
 */
function truncateToolOutputText(text: string): AgentToolCallOutput {
  if (text.length <= MAX_TOOL_OUTPUT_TEXT_CHARS) {
    return { type: "text", text };
  }

  const omittedLength = text.length - MAX_TOOL_OUTPUT_TEXT_CHARS;
  return {
    type: "text",
    text:
      text.slice(0, MAX_TOOL_OUTPUT_TEXT_CHARS) +
      `\n\n[Tool output truncated in Copilot UI: ${omittedLength.toLocaleString()} characters omitted.]`,
    truncated: true,
    originalLength: text.length,
    omittedLength,
  };
}

/**
 * Pick the first option matching one of the given kinds (in order) and return
 * a `selected` decision. Falls back to `cancelled` (spec-safe no-decision)
 * when the agent offers no matching option.
 */
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
