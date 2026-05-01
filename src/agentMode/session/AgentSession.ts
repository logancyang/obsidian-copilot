import { AI_SENDER, USER_SENDER } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import {
  AgentMessagePart,
  AgentToolCallOutput,
  AgentToolKind,
  AgentToolStatus,
  BackendDescriptor,
  CurrentPlan,
  NewAgentChatMessage,
  planBodyEquals,
  planEntriesToMarkdown,
} from "@/agentMode/session/types";
import * as fs from "node:fs";
import * as path from "node:path";
import { isNoteSelectedTextContext, MessageContext } from "@/types/message";
import { err2String, formatDateTime } from "@/utils";
import {
  ContentBlock,
  Plan,
  PromptRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionId,
  SessionModelState,
  SessionModeState,
  SessionNotification,
  StopReason,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import { MethodUnsupportedError, type BackendId } from "@/agentMode/acp/types";
import type { BackendMetaParser } from "@/agentMode/session/backendMeta";
import { resolveMcpServers } from "@/agentMode/session/mcpResolver";
import { getSettings } from "@/settings/model";

/**
 * Prefix opencode uses for placeholder titles before its title-summarizer
 * agent runs. Treating these as "no title" prevents the tab from briefly
 * showing "New session - 2026-…" before the LLM-generated label arrives.
 */
const DEFAULT_TITLE_PREFIX = "New session";

export type AgentSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

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
}

export interface AgentSessionStartOptions {
  backend: AcpBackendProcess;
  cwd: string;
  internalId: string;
  backendId: BackendId;
  preferredModelId?: string;
  /**
   * Optional descriptor accessor. The session uses it to read static behavior
   * flags (e.g. `emitsPlanProposalOnEndOfTurn`) and to resolve mode mappings
   * without coupling to specific backends. Manager-supplied; tests omit it.
   */
  getDescriptor?: () => BackendDescriptor | undefined;
}

/**
 * Pre-resolved state used by tests and by `loadSessionFromHistory` to
 * construct a session that bypasses the async ACP startup.
 */
export interface AgentSessionStateOptions {
  backend: AcpBackendProcess;
  acpSessionId: SessionId;
  internalId: string;
  backendId: BackendId;
  initialModelState?: SessionModelState | null;
  initialConfigOptions?: SessionConfigOption[] | null;
  initialModeState?: SessionModeState | null;
  cwd?: string | null;
  getDescriptor?: () => BackendDescriptor | undefined;
}

/**
 * Per-chat Agent Mode session. Owns its `AgentMessageStore`, the lifecycle
 * of one ACP session id on the shared backend, and the `AbortController` that
 * cancels in-flight turns.
 *
 * Construction is split: `AgentSession.start()` returns synchronously with
 * status `"starting"` so the UI can swap to the new (empty) chat immediately.
 * The ACP `session/new` RPC runs in the background; once it resolves the
 * session transitions to `"idle"` and `sendPrompt` becomes usable. While
 * starting, `sendPrompt` throws — the chat UI gates the send button on
 * `getStatus() === "starting"`.
 */
export class AgentSession {
  readonly store = new AgentMessageStore();
  readonly internalId: string;
  readonly backendId: BackendId;
  /** Resolves when `session/new` succeeds; rejects when it fails. */
  readonly ready: Promise<void>;
  private acpSessionId: SessionId | null = null;
  private readonly backend: AcpBackendProcess;
  private readonly cwd: string | null;
  private readonly getDescriptor: (() => BackendDescriptor | undefined) | null;
  private status: AgentSessionStatus = "starting";
  private placeholderId: string | null = null;
  private abortController: AbortController | null = null;
  private listeners = new Set<AgentSessionListener>();
  private unregisterSessionHandler: (() => void) | null = null;
  private modelState: SessionModelState | null = null;
  private configOptions: SessionConfigOption[] | null = null;
  private modeState: SessionModeState | null = null;
  private label: string | null = null;
  // Tracks who set the current label so an agent-pushed `session_info_update`
  // can't clobber a label the user explicitly chose via Rename.
  private labelSource: "user" | "agent" | null = null;
  private disposed = false;
  // Pending ACP permission resolvers keyed by toolCallId. Populated when an
  // ExitPlanMode permission request arrives (via the wrapped prompter); the
  // chat card resolves them through `resolvePlanProposalPermission`.
  private pendingPlanResolvers = new Map<
    string,
    {
      request: RequestPermissionRequest;
      resolve: (resp: RequestPermissionResponse) => void;
    }
  >();
  // Singleton "current plan" for the floating card. At most one per session
  // while in canonical plan mode and a plan has been proposed; cleared on a
  // terminal user decision or when the canonical mode flips out of plan.
  private currentPlan: CurrentPlan | null = null;
  // Monotonic counter for `currentPlan.id` so the React tree can detect a
  // *new* plan-mode review (vs. an in-place revision that bumps `revision`).
  private planSeq = 0;
  // Tool-call ids the user has already finalized a decision on. Late
  // `tool_call_update` notifications for the same ExitPlanMode tool (e.g.
  // status → "completed" after the agent received the allow/deny) carry the
  // original plan body and would otherwise re-trigger `publishGatedPlan`
  // after `currentPlan` was cleared, resurrecting a "ghost" pending card the
  // user just dismissed.
  private decidedPlanToolCallIds = new Set<string>();

  /**
   * Tests and `loadSessionFromHistory` use this constructor with a
   * pre-resolved `acpSessionId`. Production code should use
   * `AgentSession.start(...)` so the ACP startup runs in the background.
   */
  constructor(opts: AgentSessionStateOptions | AgentSessionStartOptions) {
    this.backend = opts.backend;
    this.internalId = opts.internalId;
    this.backendId = opts.backendId;
    this.cwd = opts.cwd ?? null;
    this.getDescriptor = opts.getDescriptor ?? null;
    if ("acpSessionId" in opts) {
      this.acpSessionId = opts.acpSessionId;
      this.modelState = opts.initialModelState ?? null;
      this.configOptions = opts.initialConfigOptions ?? null;
      this.modeState = opts.initialModeState ?? null;
      this.unregisterSessionHandler = this.backend.registerSessionHandler(
        opts.acpSessionId,
        (update) => this.handleSessionUpdate(update)
      );
      this.status = "idle";
      this.ready = Promise.resolve();
    } else {
      this.status = "starting";
      this.ready = this.initialize(opts);
    }
  }

  /**
   * Construct an `AgentSession` synchronously and kick off ACP
   * initialization in the background. The returned session is immediately
   * registerable with the manager and renderable in the UI; `sendPrompt`
   * is gated until `ready` resolves.
   */
  static start(opts: AgentSessionStartOptions): AgentSession {
    return new AgentSession(opts);
  }

  /** The ACP session id, or null while still starting. */
  getAcpSessionId(): SessionId | null {
    return this.acpSessionId;
  }

  private async initialize(opts: AgentSessionStartOptions): Promise<void> {
    const { backend, cwd, preferredModelId } = opts;
    try {
      const resp = await backend.newSession({
        cwd,
        mcpServers: resolveMcpServers(backend, getSettings().agentMode?.mcpServers),
      });
      if (this.disposed) return;
      if (resp.models) {
        const ids = resp.models.availableModels.map((m) => m.modelId).join(", ");
        logInfo(
          `[AgentMode] session ${resp.sessionId} model=${resp.models.currentModelId} (available: ${ids})`
        );
      } else {
        logInfo(`[AgentMode] session ${resp.sessionId} created — agent did not report model state`);
      }
      this.acpSessionId = resp.sessionId;
      this.modelState = resp.models ?? null;
      this.configOptions = resp.configOptions ?? null;
      this.modeState = resp.modes ?? null;
      this.unregisterSessionHandler = this.backend.registerSessionHandler(
        resp.sessionId,
        (update) => this.handleSessionUpdate(update)
      );
      // dispose() may have run between newSession resolving and now. If so,
      // tear the handler down — without this, the agent-side session id is
      // live with no local consumer.
      if (this.disposed) {
        this.unregisterSessionHandler();
        this.unregisterSessionHandler = null;
        return;
      }
      this.setStatus("idle");
      this.notifyModelChanged();

      // Apply sticky preference if it's available and differs from the agent's
      // current model. Failures here are non-fatal — the session is usable with
      // whatever the agent picked by default.
      if (
        preferredModelId &&
        resp.models &&
        resp.models.currentModelId !== preferredModelId &&
        resp.models.availableModels.some((m) => m.modelId === preferredModelId)
      ) {
        try {
          await this.setModel(preferredModelId);
        } catch (e) {
          logWarn(`[AgentMode] could not apply preferred model ${preferredModelId}`, e);
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
   * Latest known model state for this session. `null` when the agent did not
   * report any models in `NewSessionResponse` (older agents/backends).
   */
  getModelState(): SessionModelState | null {
    return this.modelState;
  }

  /**
   * Switch the active model on this session. Calls
   * `unstable_setSessionModel`; on success, mutates the local
   * `currentModelId` and notifies `onModelChanged` listeners.
   *
   * Throws `MethodUnsupportedError` if the agent does not implement the
   * unstable RPC. Callers should treat that as "model switching is not
   * available" and degrade the UI accordingly.
   */
  async setModel(modelId: string): Promise<void> {
    if (this.status === "closed") throw new Error("Session is closed");
    if (!this.acpSessionId) throw new Error("Session is still starting");
    await this.backend.setSessionModel({ sessionId: this.acpSessionId, modelId });
    if (this.modelState) {
      this.modelState = { ...this.modelState, currentModelId: modelId };
    } else {
      this.modelState = { availableModels: [], currentModelId: modelId };
    }
    this.notifyModelChanged();
  }

  /**
   * Whether `unstable_setSessionModel` is known to be supported. Mirrors
   * `AcpBackendProcess.isSetSessionModelSupported()`. May be `null` until the
   * first probe happens.
   */
  isModelSwitchSupported(): boolean | null {
    return this.backend.isSetSessionModelSupported();
  }

  getConfigOptions(): SessionConfigOption[] | null {
    return this.configOptions;
  }

  /**
   * Set a session configuration option (e.g. effort). The response carries
   * the **full** post-update option list per spec, which we cache verbatim.
   * Reuses `notifyModelChanged` because the picker treats model and
   * configOption changes as one channel.
   */
  async setConfigOption(configId: string, value: string): Promise<void> {
    if (this.status === "closed") throw new Error("Session is closed");
    if (!this.acpSessionId) throw new Error("Session is still starting");
    const resp = await this.backend.setSessionConfigOption({
      sessionId: this.acpSessionId,
      configId,
      value,
    });
    this.configOptions = resp.configOptions;
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  /** Tri-state mirror of `AcpBackendProcess.isSetSessionConfigOptionSupported()`. */
  isSetSessionConfigOptionSupported(): boolean | null {
    return this.backend.isSetSessionConfigOptionSupported();
  }

  /**
   * Latest known mode state for this session. `null` when the agent did not
   * report any modes in `NewSessionResponse` (older agents/backends).
   */
  getModeState(): SessionModeState | null {
    return this.modeState;
  }

  /**
   * Switch the active session mode (claude-code permission mode, codex
   * sandbox preset, etc.) via `session/set_mode`. On success, mutates the
   * local `currentModeId` and notifies `onModelChanged` listeners.
   *
   * Throws `MethodUnsupportedError` when the agent doesn't implement the
   * RPC. Callers should treat that as "mode switching is not available" and
   * degrade the UI accordingly.
   */
  async setMode(modeId: string): Promise<void> {
    if (this.status === "closed") throw new Error("Session is closed");
    if (!this.acpSessionId) throw new Error("Session is still starting");
    await this.backend.setSessionMode({ sessionId: this.acpSessionId, modeId });
    this.modeState = {
      ...(this.modeState ?? { availableModes: [] }),
      currentModeId: modeId,
    };
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  /** Tri-state mirror of `AcpBackendProcess.isSetSessionModeSupported()`. */
  isSetModeSupported(): boolean | null {
    return this.backend.isSetSessionModeSupported();
  }

  getStatus(): AgentSessionStatus {
    return this.status;
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
   * assistant placeholder to the store (so the UI can render immediately) and
   * kicks off `session/prompt`. Streaming `session/update` notifications
   * mutate the placeholder in place. Returns:
   *   - `userMessageId`: id of the appended user message.
   *   - `turn`: promise that resolves with the ACP `StopReason` when the
   *     turn completes, or rejects on transport errors.
   */
  sendPrompt(
    displayText: string,
    context?: MessageContext,
    content?: any[]
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
    content?: any[]
  ): Promise<StopReason> {
    const placeholderId = this.placeholderId;
    // sendPrompt's status guard guarantees acpSessionId is set; the assertion
    // is for the type narrower since status and acpSessionId are independent.
    const sessionId = this.acpSessionId!;
    try {
      const promptBlocks = buildPromptBlocks(displayText, context, content);
      const req: PromptRequest = {
        sessionId,
        prompt: promptBlocks,
      };
      const resp = await this.backend.prompt(req);
      this.setStatus("idle");
      // Publish any structured plan as the floating plan card when
      // the descriptor opted in (OpenCode-style end-of-turn). Done before
      // clearing the placeholder reference so the new part still routes to
      // the same assistant message.
      if (resp.stopReason === "end_turn" && placeholderId) {
        this.maybePromotePlanToProposal(placeholderId);
      }
      // Clear the placeholder reference now that the turn is done. We do this
      // here (and in the catch branch) instead of in `finally` so that
      // trailing `session/update` notifications that may arrive between
      // `prompt()` resolving and this point are still applied to the right
      // message — per ACP, the agent can emit final updates around the
      // stopReason.
      if (this.placeholderId === placeholderId) this.placeholderId = null;
      // Fire-and-forget title pull. Errors are swallowed (best-effort: the tab
      // just stays at "Session N"). Skipped on cancelled turns where opencode
      // hasn't run its title-summarizer yet.
      if (resp.stopReason === "end_turn") void this.pollSessionTitle();
      return resp.stopReason;
    } catch (err) {
      logWarn(`[AgentMode] prompt failed`, err);
      if (placeholderId) {
        this.store.markMessageError(placeholderId, err2String(err));
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
   * Cancel any in-flight turn. Sends `session/cancel` over ACP and aborts the
   * local controller. The backend may still emit a few trailing
   * `session/update` notifications before the prompt promise resolves with
   * `stopReason: "cancelled"` — that's expected per the ACP spec.
   */
  async cancel(): Promise<void> {
    if (this.status !== "running" && this.status !== "awaiting_permission") return;
    if (!this.acpSessionId) return;
    try {
      await this.backend.cancel({ sessionId: this.acpSessionId });
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
    // Drain any unresolved plan-proposal permissions with deny so the agent
    // doesn't leak a pending RPC.
    for (const { request, resolve } of this.pendingPlanResolvers.values()) {
      resolve(permissionResponseFor(request, REJECT_KINDS));
    }
    this.pendingPlanResolvers.clear();
    this.decidedPlanToolCallIds.clear();
    this.currentPlan = null;
    this.setStatus("closed");
    this.listeners.clear();
  }

  /**
   * Called by the wrapped permission prompter when an ExitPlanMode permission
   * request arrives. Returns a promise the ACP backend will await for the
   * outcome; resolved by the chat card via `resolvePlanProposalPermission`.
   */
  handlePlanProposalPermission(
    request: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const toolCallId = request.toolCall.toolCallId;
    return new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPlanResolvers.set(toolCallId, { request, resolve });
      // Notify so the chat input can disable itself in response to the new
      // pending permission. Re-uses the messages channel because the
      // proposal card is part of the same UI tree.
      this.notifyMessages();
    });
  }

  /**
   * Resolve a pending ExitPlanMode permission. `allow: true` selects the
   * first allow_once option; `false` selects the first reject option (or
   * cancels when no reject option is offered). No-op when no permission is
   * pending for the given id (e.g. non-gated OpenCode proposals).
   */
  resolvePlanProposalPermission(toolCallId: string, allow: boolean): void {
    const entry = this.pendingPlanResolvers.get(toolCallId);
    if (!entry) return;
    this.pendingPlanResolvers.delete(toolCallId);
    entry.resolve(permissionResponseFor(entry.request, allow ? ALLOW_KINDS : REJECT_KINDS));
    // Pending state changed — re-enable the chat input in the UI.
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

  /**
   * Replace the current plan body in place, keeping the same id and bumping
   * `revision`. Mints a fresh id when no plan is active. Skips the notify
   * when the new body is identical to the existing one (agent rewriting the
   * same plan file content) so MarkdownRenderer doesn't churn.
   *
   * `permissionGated` follows the source: gated for live ExitPlanMode
   * permissions, non-gated for everything else.
   */
  private setCurrentPlan(next: Omit<CurrentPlan, "id" | "revision" | "decision">): void {
    if (this.currentPlan && planBodyEquals(this.currentPlan.body, next.body)) {
      return;
    }
    if (!this.currentPlan) {
      this.planSeq += 1;
      this.currentPlan = {
        ...next,
        id: `plan-${this.internalId}-${this.planSeq}`,
        revision: 1,
        decision: "pending",
      };
    } else {
      this.currentPlan = {
        ...this.currentPlan,
        ...next,
        revision: this.currentPlan.revision + 1,
        decision: "pending",
      };
    }
    this.notifyCurrentPlanChanged();
  }

  /** Public — used by mode-picker plumbing to clear the card on mode switch. */
  clearCurrentPlanIfModeLeft(): void {
    if (!this.currentPlan) return;
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return;
    // Without a mode mapping there's no canonical "plan" to compare against —
    // any plan that exists is necessarily orphaned from this check, so leave
    // it alone rather than clearing on every config tick.
    if (!descriptor.getModeMapping) return;
    if (this.isCurrentlyInPlanMode(descriptor)) return;
    // If a permission was still pending, reject it so the agent's RPC
    // doesn't hang waiting for a card that no longer exists.
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

  private handleSessionUpdate(notification: SessionNotification): void {
    const update = notification.update;

    // Session-scoped updates aren't tied to a turn placeholder, so handle
    // them before the placeholder check below.
    if (update.sessionUpdate === "session_info_update") {
      this.applyAgentLabel(update.title);
      return;
    }
    if (update.sessionUpdate === "current_mode_update") {
      // Agent flipped its own mode (e.g. an in-prompt marker, or a server-
      // side default kicking in). Mirror it locally so the picker reflects
      // reality without having to resync via setMode. Skip when the id
      // didn't actually change to avoid spurious re-renders.
      if (this.modeState?.currentModeId === update.currentModeId) return;
      this.modeState = {
        ...(this.modeState ?? { availableModes: [] }),
        currentModeId: update.currentModeId,
      };
      this.notifyModelChanged();
      this.clearCurrentPlanIfModeLeft();
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      // Agent rebuilt its config option list — most often after a model
      // switch, since (e.g.) claude-agent-acp's effort vocabulary depends on
      // the selected model. Mirror the full post-update list locally
      // (per spec: ConfigOptionUpdate.configOptions is the full set, not a
      // delta) so the picker reflects reality without a round trip.
      // `attachModelCacheSync` listens to the same `notifyModelChanged`
      // channel and will refresh the preloader cache as a side-effect.
      if (configOptionsSig(this.configOptions) === configOptionsSig(update.configOptions)) {
        return;
      }
      this.configOptions = update.configOptions;
      this.notifyModelChanged();
      this.clearCurrentPlanIfModeLeft();
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
          this.notifyMessages();
        }
        return;
      }
      case "agent_thought_chunk": {
        const text = extractText(update.content);
        if (!text) return;
        if (this.store.appendAgentThought(placeholderId, text)) {
          this.notifyMessages();
        }
        return;
      }
      case "tool_call": {
        const parser = this.getDescriptor?.()?.meta;
        const exitPlan = tryReadExitPlanModeCall({
          kind: update.kind,
          rawInput: update.rawInput,
          meta: update._meta,
          parser,
        });
        if (exitPlan) {
          this.publishGatedPlan(update.toolCallId, exitPlan);
          // Still record the tool call so the chat shows what triggered the
          // gated card (avoids a "the agent did something invisible" feel).
          if (this.store.upsertAgentPart(placeholderId, toolCallToPart(update, parser))) {
            this.notifyMessages();
          }
          return;
        }
        if (this.store.upsertAgentPart(placeholderId, toolCallToPart(update, parser))) {
          this.notifyMessages();
        }
        return;
      }
      case "tool_call_update": {
        const existing = this.findToolCallPart(placeholderId, update.toolCallId);
        const parser = this.getDescriptor?.()?.meta;
        const merged = mergeToolCallUpdate(existing, update, parser);
        // The plan body may arrive on an update rather than the initial
        // tool_call. Re-check after merging and publish if so.
        if (merged.kind === "tool_call") {
          const exitPlan = tryReadExitPlanModeCall({
            kind: update.kind ?? merged.toolKind,
            rawInput: merged.input,
            meta: update._meta,
            parser,
          });
          if (exitPlan) {
            this.publishGatedPlan(merged.id, exitPlan);
          }
        }
        if (this.store.upsertAgentPart(placeholderId, merged)) {
          this.notifyMessages();
        }
        // Plan-file promotion on a successful edit-class tool call:
        // - bootstrap a fresh plan card from a write to a backend-managed
        //   plan path (opencode-style — no permission-gated tool to hook
        //   off, the file IS the plan)
        // - refresh the existing card's body when the agent revises the
        //   plan file in place (Claude Code post-rejection behavior)
        if (merged.kind === "tool_call" && merged.status === "completed") {
          this.maybePromotePlanFileWrite(merged);
          this.maybePromotePlanFileEdit(merged);
        }
        return;
      }
      case "plan": {
        if (this.store.upsertAgentPart(placeholderId, planToPart(update))) {
          this.notifyMessages();
        }
        return;
      }
      default:
        logInfo(`[AgentMode] ignoring session/update kind=${update.sessionUpdate}`);
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
   * id at it. When this fires while a non-gated plan was already on
   * screen (e.g. an OpenCode review followed by a re-issue), reuse the
   * same card identity — same review session, just gated now.
   */
  private publishGatedPlan(
    toolCallId: string,
    info: { plan: string; planFilePath?: string }
  ): void {
    // Skip if the user already finalized a decision on this tool call. The
    // agent's `tool_call_update` for the same ExitPlanMode (status →
    // completed after allow/deny) still carries the original plan body, so
    // without this guard `setCurrentPlan` would mint a fresh pending card
    // into the slot we just cleared — visibly resurrecting a card the user
    // just dismissed.
    if (this.decidedPlanToolCallIds.has(toolCallId)) return;
    // Defensive: if a different gated permission was already pending on this
    // card, reject it now so the agent's prior RPC doesn't hang.
    const stale = this.currentPlan?.pendingToolCallId;
    if (stale && stale !== toolCallId) this.resolvePlanProposalPermission(stale, false);
    const title = derivePlanTitleFromMarkdown(info.plan);
    this.setCurrentPlan({
      body: { type: "markdown", text: info.plan },
      title,
      sourceFilePath: info.planFilePath,
      permissionGated: true,
      pendingToolCallId: toolCallId,
    });
  }

  /**
   * Refresh the existing plan card's body when the agent revises the plan
   * file in place (Claude Code post-rejection behavior, or any backend
   * iterating on the plan markdown). Same plan id, bumped revision;
   * permissionGated drops to `false` because the underlying gating
   * permission was already resolved.
   *
   * No-op when there's no current plan, no `sourceFilePath`, the tool
   * isn't ACP-canonical edit-class, or the file path doesn't match.
   */
  private maybePromotePlanFileEdit(part: Extract<AgentMessagePart, { kind: "tool_call" }>): void {
    const plan = this.currentPlan;
    if (!plan?.sourceFilePath) return;
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return;
    if (!this.isCurrentlyInPlanMode(descriptor)) return;
    if (part.toolKind !== "edit") return;
    const targetPath = extractToolCallPath(part);
    if (!targetPath) return;
    const absPath = resolveAbsolute(targetPath, this.cwd);
    if (absPath !== plan.sourceFilePath) return;
    fs.promises.readFile(absPath, "utf8").then(
      (text) => {
        // The plan may have been resolved or the mode flipped while the
        // read was in flight. Bail rather than resurrecting a stale card.
        if (!this.currentPlan || this.currentPlan.id !== plan.id) return;
        this.setCurrentPlan({
          body: { type: "markdown", text },
          title: derivePlanTitleFromMarkdown(text),
          sourceFilePath: plan.sourceFilePath,
          permissionGated: false,
        });
      },
      (e) => logWarn(`[AgentMode] could not re-read plan file ${absPath}`, e)
    );
  }

  /**
   * Bootstrap a brand-new plan card from a successful edit-class tool
   * call writing to a backend-managed plan-file path (opencode-style:
   * `<cwd>/.opencode/plans/*.md` etc.). The plan markdown body comes
   * from disk; `permissionGated` is `false` since there's no permission
   * to gate on.
   *
   * Hands off to `maybePromotePlanFileEdit` for in-place revisions —
   * once a plan with this `sourceFilePath` is on screen, subsequent
   * writes to the same path are revisions, not bootstraps.
   */
  private maybePromotePlanFileWrite(part: Extract<AgentMessagePart, { kind: "tool_call" }>): void {
    const descriptor = this.getDescriptor?.();
    if (!descriptor?.isPlanModePlanFilePath) return;
    if (!this.isCurrentlyInPlanMode(descriptor)) return;
    if (part.toolKind !== "edit") return;
    const targetPath = extractToolCallPath(part);
    if (!targetPath) return;
    const absPath = resolveAbsolute(targetPath, this.cwd);
    if (!descriptor.isPlanModePlanFilePath(absPath, this.cwd)) return;
    // Revision case: the existing card's path matches → let the edit
    // handler refresh the body so we don't mint a duplicate plan id.
    if (this.currentPlan?.sourceFilePath === absPath) return;
    fs.promises.readFile(absPath, "utf8").then(
      (text) => {
        // Race: the mode flipped or another bootstrap landed first while
        // the read was in flight. Bail if we're no longer the right hook.
        if (!this.isCurrentlyInPlanMode(descriptor)) return;
        if (this.currentPlan?.sourceFilePath === absPath) return;
        this.setCurrentPlan({
          body: { type: "markdown", text },
          title: derivePlanTitleFromMarkdown(text),
          sourceFilePath: absPath,
          permissionGated: false,
        });
      },
      (e) => logWarn(`[AgentMode] could not read plan file ${absPath}`, e)
    );
  }

  /**
   * If the descriptor advertises end-of-turn proposal emission AND the
   * session is currently in canonical "plan" mode AND the placeholder
   * message contains a structured `kind: "plan"` part, publish it as
   * the floating plan card (entries body, not gated). No-op for backends
   * that handle plan completion via a permission-gated tool — those
   * routes already published a gated card via `publishGatedPlan`.
   *
   * Skips when a markdown-body plan was already published mid-turn (via
   * `maybePromotePlanFileWrite`). The plan-file body is more
   * authoritative than a `todowrite`-derived checklist; overwriting it
   * with the entries body would lose detail.
   */
  private maybePromotePlanToProposal(placeholderId: string): void {
    const descriptor = this.getDescriptor?.();
    if (!descriptor?.emitsPlanProposalOnEndOfTurn) return;
    if (!this.isCurrentlyInPlanMode(descriptor)) return;
    if (this.currentPlan?.body.type === "markdown") return;
    const msg = this.store.getMessage(placeholderId);
    const planPart = msg?.parts?.find((p) => p.kind === "plan");
    if (!planPart || planPart.kind !== "plan") return;
    const markdown = planEntriesToMarkdown(planPart.entries);
    this.setCurrentPlan({
      body: { type: "entries", entries: planPart.entries },
      title: derivePlanTitleFromMarkdown(markdown),
      permissionGated: false,
    });
  }

  /**
   * Resolve the descriptor's canonical "plan" mode against the current
   * session state. Mirrors the dispatch logic in modeAdapter (configOption-
   * vs setMode-style backends) without importing it, to keep the session
   * layer free of UI/picker concerns.
   */
  private isCurrentlyInPlanMode(descriptor: BackendDescriptor): boolean {
    const mapping = descriptor.getModeMapping?.(this.modeState, this.configOptions);
    if (!mapping) return false;
    const planNative = mapping.canonical.plan;
    if (!planNative) return false;
    if (mapping.kind === "configOption") {
      const opt = this.configOptions?.find((o) => o.id === mapping.configId);
      if (!opt || !("currentValue" in opt)) return false;
      return String(opt.currentValue) === planNative;
    }
    return this.modeState?.currentModeId === planNative;
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
    for (const l of this.listeners) {
      try {
        l.onMessagesChanged();
      } catch (e) {
        logWarn(`[AgentMode] messages listener threw`, e);
      }
    }
  }

  /**
   * Pull the agent-generated title for this session via `session/list` and
   * apply it as the tab label. Workaround for backends like opencode 1.14
   * that summarize the first turn into a title, persist it, but don't push
   * it through `session_info_update` notifications.
   *
   * Best-effort: silently no-ops when the agent doesn't support `session/list`
   * or when the title is still the default placeholder.
   */
  private async pollSessionTitle(): Promise<void> {
    if (this.labelSource === "user") return;
    try {
      const resp = await this.backend.listSessions(this.cwd ? { cwd: this.cwd } : {});
      const entry = resp.sessions.find((s) => s.sessionId === this.acpSessionId);
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

export function buildPromptBlocks(
  displayText: string,
  context?: MessageContext,
  content?: any[]
): ContentBlock[] {
  // TODO(agent-mode): map `content` (image_url / etc.) to ACP `ContentBlock`
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

function extractText(content: ContentBlock): string {
  if (content.type === "text") return content.text;
  return "";
}

function configOptionsSig(opts: SessionConfigOption[] | null): string {
  if (!opts) return "";
  return opts.map((o) => `${o.id}=${"currentValue" in o ? String(o.currentValue) : ""}`).join(",");
}

function toolCallToPart(
  call: ToolCall & { sessionUpdate: "tool_call" },
  parser?: BackendMetaParser
): AgentMessagePart {
  const meta = parser?.parseToolCallMeta(call._meta) ?? null;
  return {
    kind: "tool_call",
    id: call.toolCallId,
    title: call.title,
    toolKind: call.kind as AgentToolKind | undefined,
    status: (call.status ?? "pending") as AgentToolStatus,
    input: call.rawInput,
    output: extractToolCallOutputs(call.content),
    locations: call.locations?.map((l) => ({ path: l.path, line: l.line ?? undefined })),
    vendorToolName: meta?.vendorToolName,
    parentToolCallId: meta?.parentToolCallId,
  };
}

/**
 * Pull the file path off an edit-class tool call. Prefers the ACP-canonical
 * `locations[0].path`, falls back to common rawInput shapes (`file_path`
 * for Claude Code, `filePath` for opencode). Returns `undefined` when the
 * tool call carries no path — caller should bail.
 */
function extractToolCallPath(
  part: Extract<AgentMessagePart, { kind: "tool_call" }>
): string | undefined {
  const fromLoc = part.locations?.[0]?.path;
  if (typeof fromLoc === "string" && fromLoc.length > 0) return fromLoc;
  const input = part.input as { file_path?: unknown; filePath?: unknown } | null | undefined;
  if (typeof input?.file_path === "string") return input.file_path;
  if (typeof input?.filePath === "string") return input.filePath;
  return undefined;
}

/**
 * Resolve a possibly-relative path to an absolute one against `cwd` (the
 * session's working directory, typically the vault root). ACP doesn't
 * require absolute paths but most backends emit them; this is the
 * defensive fallback.
 */
function resolveAbsolute(filePath: string, cwd: string | null): string {
  if (path.isAbsolute(filePath)) return filePath;
  if (cwd) return path.resolve(cwd, filePath);
  return filePath;
}

/**
 * Detect whether a tool_call / tool_call_update represents the agent's
 * plan-finalization signal (Claude Code's `ExitPlanMode`, or any future
 * backend that follows the standard ACP `switch_mode` ToolKind convention).
 * Returns the parsed payload (`plan`, optional `planFilePath`) when so, or
 * `null` otherwise.
 *
 * Layered detection — the content gate is load-bearing:
 *   1. `rawInput.plan: string` — without it there's nothing to render.
 *   2. Backend's typed `_meta` parser flags `isPlanProposal` (primary,
 *      vendor-specific path; lives in `backends/<id>/meta.ts`).
 *   3. Standard ACP `kind === "switch_mode"` (backend-agnostic fallback).
 */
export function tryReadExitPlanModeCall(args: {
  kind?: string;
  rawInput: unknown;
  meta?: unknown;
  parser?: BackendMetaParser;
}): { plan: string; planFilePath?: string } | null {
  const raw = args.rawInput as { plan?: unknown; planFilePath?: unknown } | null | undefined;
  const plan = raw?.plan;
  if (typeof plan !== "string") return null;
  const flagged = args.parser?.parseToolCallMeta(args.meta)?.isPlanProposal;
  if (!flagged && args.kind !== "switch_mode") return null;
  const planFilePath = typeof raw?.planFilePath === "string" ? raw.planFilePath : undefined;
  return { plan, planFilePath };
}

/**
 * Derive a short title for the plan card / preview tab from a markdown
 * body. Uses the first non-empty line, stripping leading `#`s. Falls back
 * to a generic label when the body is blank.
 */
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
  upd: ToolCallUpdate & { sessionUpdate: "tool_call_update" },
  parser?: BackendMetaParser
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
  // Late-arriving `_meta` (some backends only attach it on updates) can fill
  // in vendor identity / parent linkage that was empty on the initial part.
  // Existing values win — once set, vendorToolName / parentToolCallId don't
  // change between updates for the same tool call.
  const meta = upd._meta !== undefined ? (parser?.parseToolCallMeta(upd._meta) ?? null) : null;
  return {
    ...base,
    title: upd.title ?? base.title,
    toolKind: (upd.kind as AgentToolKind | undefined) ?? base.toolKind,
    status: (upd.status as AgentToolStatus | undefined) ?? base.status,
    input: upd.rawInput !== undefined ? upd.rawInput : base.input,
    output:
      upd.content !== undefined && upd.content !== null
        ? extractToolCallOutputs(upd.content)
        : base.output,
    locations:
      upd.locations !== undefined && upd.locations !== null
        ? upd.locations.map((l) => ({ path: l.path, line: l.line ?? undefined }))
        : base.locations,
    vendorToolName: base.vendorToolName ?? meta?.vendorToolName,
    parentToolCallId: base.parentToolCallId ?? meta?.parentToolCallId,
  };
}

function extractToolCallOutputs(
  content: ToolCall["content"] | ToolCallUpdate["content"]
): AgentToolCallOutput[] | undefined {
  if (!content) return undefined;
  const outputs: AgentToolCallOutput[] = [];
  for (const item of content) {
    if (item.type === "content" && item.content.type === "text") {
      outputs.push({ type: "text", text: item.content.text });
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
 * Pick the first option matching one of the given kinds (in order) and return
 * a `selected` response. Falls back to `cancelled` (spec-safe no-decision)
 * when the agent offers no matching option.
 */
function permissionResponseFor(
  req: RequestPermissionRequest,
  kinds: ReadonlyArray<"allow_once" | "allow_always" | "reject_once" | "reject_always">
): RequestPermissionResponse {
  for (const k of kinds) {
    const opt = req.options.find((o) => o.kind === k);
    if (opt) return { outcome: { outcome: "selected", optionId: opt.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

const ALLOW_KINDS = ["allow_once", "allow_always"] as const;
const REJECT_KINDS = ["reject_once", "reject_always"] as const;

function planToPart(plan: Plan & { sessionUpdate: "plan" }): AgentMessagePart {
  return {
    kind: "plan",
    entries: plan.entries.map((e) => ({
      content: e.content,
      priority: e.priority,
      status: e.status,
    })),
  };
}
