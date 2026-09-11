import { logInfo, logWarn } from "@/logger";
import type { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import type { AgentSessionListener, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type {
  AgentTaskAcceptance,
  AgentTaskCoordinator,
} from "@/agentMode/session/AgentTaskCoordinator";
import {
  EMPTY_VOICE_FOLLOW_UPS,
  VOICE_OFF_RUNTIME_STATE,
  type AgentTaskResult,
  type AgentTaskSubmission,
  type AgentVoiceAttachment,
  type AgentVoiceRuntimeState,
  type AgentVoiceStartOutcome,
} from "@/agentMode/session/voiceTypes";
import type {
  VoiceSessionEvent,
  VoiceSessionSnapshot,
  VoiceTimers,
  VoiceTranscriptDelta,
} from "@/agentMode/voice/types";
import type { VoiceSessionController } from "@/agentMode/voice/VoiceSessionController";
import { buildVoiceStartupContext } from "@/agentMode/voice/voiceStartupContext";
import { VoiceTranscriptAssembler } from "@/agentMode/voice/voiceTranscript";
import type { VoiceTaskState } from "@/agentMode/voice/voiceProtocol";
import { AI_SENDER, USER_SENDER } from "@/constants";
import type { MessageContext } from "@/types/message";

/**
 * Quiet period after the newest user transcript fragment before a delegation is
 * answered, and the longest a delegation waits for usable speech at all. Both
 * are starting parameters to measure against real speech, not API guarantees.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "From speech to a local task".
 */
export const TRANSCRIPT_SETTLE_MS = 500;
export const TRANSCRIPT_MAX_WAIT_MS = 2_000;

/**
 * Longest answer excerpt mirrored into the spoken conversation. The server
 * wraps it in a sentence and bounds the whole append well under the live API's
 * per-append cap, so the excerpt has to leave room for that framing. The full
 * answer never leaves the task card.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Returning progress and results".
 */
export const MAX_ANSWER_EXCERPT_CHARS = 280;

/** Longest request text echoed back as a queued-follow-up fact. */
const MAX_FOLLOW_UP_CHARS = 120;

/**
 * The conversation a call speaks for. `AgentSession` satisfies this; declaring
 * only what the bridge touches keeps the transport out of session ownership
 * and lets tests drive a real store and coordinator without a backend.
 */
export interface VoiceConversation {
  /** Runtime identity of the chat, used to tell one binding from another. */
  readonly internalId: string;
  readonly store: AgentMessageStore;
  readonly tasks: AgentTaskCoordinator;
  /** Durable conversation identity carried in the protocol. */
  getConversationId(): string;
  getStatus(): AgentSessionStatus;
  subscribe(listener: AgentSessionListener): () => void;
  /** Tell the chat that the transcript changed outside a backend turn. */
  notifyConversationChanged(): void;
}

/** The chat surface that renders this conversation's call. */
export interface VoiceChatSurface {
  /** Bind or clear the voice controls the chat UI reads. */
  attachVoice(attachment: AgentVoiceAttachment | null): void;
}

/** One conversation the bridge can open a call for. */
export interface VoiceChatBinding {
  conversation: VoiceConversation;
  chat: VoiceChatSurface;
  /** Human-readable name of the selected local agent, for spoken references. */
  backendDisplayName: string;
  /**
   * Agents the next turn would run. More than one is a fan-out turn, which
   * voice refuses: a spoken request needs exactly one agent to own it.
   */
  getSelectedBackendIds(): readonly string[];
  /** Composer context (attached notes, selections) to attach to spoken work. */
  resolveContext?: () => MessageContext | undefined;
  /** Short factual lines about what the user currently has open. */
  describeUiContext?: () => readonly string[];
}

/**
 * Where the conversation voice belongs to comes from. The bridge follows it so
 * that changing chat, changing project, or closing the view ends the call
 * before ownership moves.
 */
export interface VoiceActiveChatSource {
  /** Fires whenever the active conversation may have changed. */
  subscribe(listener: () => void): () => void;
  /** The chat that should own voice now, or null when none is active. */
  getActiveBinding(): VoiceChatBinding | null;
}

/** One call's transport, bound to the window that owns the chat. */
export interface VoiceCallResources {
  controller: VoiceSessionController;
  timers: VoiceTimers;
}

/** Everything the bridge needs from its runtime; all injected for testing. */
export interface VoiceConversationBridgeDeps {
  /**
   * Build a call bound to the window that owns the chat, or null when no
   * window can own one.
   */
  createCall: () => VoiceCallResources | null;
  /**
   * Why voice cannot run right now (not desktop, feature off, no server or
   * credential), or null when it can. Read at every start so changing a
   * setting never needs a new bridge.
   */
  checkEnvironment: () => string | null;
  /** Ids for submissions the bridge creates. */
  newSubmissionId: () => string;
}

/** A delegation waiting for the speech it belongs to. */
interface PendingDelegation {
  liveDelegationId: string;
  settleTimer: number | null;
  giveUpTimer: number;
}

/** Local work this call is responsible for reporting on. */
interface OwnedTask {
  liveDelegationId?: string;
  /** Last state reported upstream, so only real changes are sent. */
  reported: VoiceTaskState | null;
  revision: number;
  requestText: string;
}

/** The single call this plugin instance has open. */
interface ActiveCall {
  binding: VoiceChatBinding;
  controller: VoiceSessionController;
  timers: VoiceTimers;
  transcript: VoiceTranscriptAssembler;
  /** Store entry per transcript row, so late fragments amend the same row. */
  rowMessageIds: Map<string, string>;
  pending: Map<string, PendingDelegation>;
  delegationTasks: Map<string, string>;
  ownedTasks: Map<string, OwnedTask>;
  releases: Array<() => void>;
  /** Set once the user (or a lifecycle hook) asked to end this call. */
  endRequested: boolean;
  warningSecondsRemaining: number | null;
}

/**
 * The voice mode owner: at most one live call per plugin instance, bound to
 * one conversation at a time.
 *
 * It turns speech into rows of that conversation, turns delegations into local
 * tasks through the shared `AgentTaskCoordinator`, and mirrors sparse task
 * facts back so the spoken side can report status it was actually told. It
 * owns no backend session and no conversation content: ending a call leaves
 * every task, message, and agent session exactly where it was.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Delegation design".
 */
export class VoiceConversationBridge {
  private call: ActiveCall | null = null;
  private starting: VoiceChatBinding | null = null;
  private lastState: { binding: VoiceChatBinding; state: AgentVoiceRuntimeState } | null = null;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(private readonly deps: VoiceConversationBridgeDeps) {}

  /**
   * Give a chat its voice controls and keep them until the chat goes away.
   * Detaching ends the call when that chat owned it, which is how switching
   * chats, switching projects, or closing the view end voice first.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Mode and control behavior".
   *
   * @param binding - The conversation, its chat surface, and its agent.
   * @returns Detach function; safe to call more than once.
   */
  attach(binding: VoiceChatBinding): () => void {
    const attachment: AgentVoiceAttachment = {
      getState: () =>
        this.call?.binding === binding
          ? this.snapshotState()
          : this.lastState?.binding === binding
            ? this.lastState.state
            : VOICE_OFF_RUNTIME_STATE,
      subscribe: (listener) => this.subscribe(listener),
      start: () => this.start(binding),
      end: () =>
        this.call?.binding === binding || this.lastState?.binding === binding
          ? this.end("user ended voice")
          : Promise.resolve(),
      setMuted: (muted) => {
        if (this.call?.binding === binding) this.call.controller.setMuted(muted);
      },
      prepareSubmission: (submission) => this.prepareSubmission(binding, submission),
      noteSubmissionAccepted: (submission, acceptance) =>
        this.noteSubmissionAccepted(binding, submission, acceptance),
    };
    binding.chat.attachVoice(attachment);
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      binding.chat.attachVoice(null);
      if (this.lastState?.binding === binding) this.lastState = null;
      if (this.call?.binding === binding) void this.end("chat is no longer active");
    };
  }

  /**
   * Keep voice bound to whichever conversation is active. Every change detaches
   * the previous chat first, which ends its call — the design's rule that
   * changing chat, project, or backend ends voice rather than carrying it into
   * a conversation the user is no longer looking at.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Mode and control behavior".
   *
   * @param source - The active-chat feed to follow.
   * @returns Stop following and detach the current chat.
   */
  followActiveChat(source: VoiceActiveChatSource): () => void {
    let current: { key: string; detach: () => void } | null = null;
    const sync = () => {
      const binding = source.getActiveBinding();
      const key = binding?.conversation.internalId ?? null;
      if (current?.key === key) return;
      current?.detach();
      current = null;
      if (binding && key !== null) current = { key, detach: this.attach(binding) };
    };
    sync();
    const unsubscribe = source.subscribe(sync);
    return () => {
      unsubscribe();
      current?.detach();
      current = null;
    };
  }

  /** Fires whenever the call state a chat renders would change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Current call state, or the off state when nothing is running. */
  getState(): AgentVoiceRuntimeState {
    return this.call ? this.snapshotState() : (this.lastState?.state ?? VOICE_OFF_RUNTIME_STATE);
  }

  /** The conversation the live call belongs to, or null when voice is off. */
  getActiveConversationId(): string | null {
    return this.call?.binding.conversation.internalId ?? null;
  }

  /** End any call and release every listener. Safe to call repeatedly. */
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.end("plugin is shutting down");
    this.listeners.clear();
  }

  /**
   * Open a call for one conversation. Refuses — with a sentence the UI can
   * show — rather than opening a call that cannot work.
   */
  private async start(binding: VoiceChatBinding): Promise<AgentVoiceStartOutcome> {
    if (this.disposed) return refuse("Copilot is shutting down.");
    if (this.starting) {
      return refuse("Voice is already connecting. Wait for it to finish.");
    }
    const blocker = this.deps.checkEnvironment();
    if (blocker) return refuse(blocker);
    // A fan-out turn has no single owner for a spoken request, and the demo
    // does not route speech to several agents.
    // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Mode and control behavior".
    if (binding.getSelectedBackendIds().length > 1) {
      return refuse(
        "Select a single agent before starting voice. Voice cannot drive a multi-agent turn."
      );
    }
    // One active voice conversation per plugin instance: a call somewhere else
    // ends before this one opens, and its tasks are left running.
    if (this.call) {
      if (this.call.endRequested || this.call.controller.getSnapshot().state === "closing") {
        return refuse("Voice is ending. Wait for it to finish before starting again.");
      }
      if (this.call.binding === binding) return refuse("Voice is already on in this chat.");
      await this.end("voice moved to another chat");
    }

    this.starting = binding;
    try {
      const opened = this.deps.createCall();
      if (!opened) return refuse("Open a Copilot Agent chat first — voice runs in its window.");
      const call = this.openCall(binding, opened);
      this.call = call;
      this.lastState = null;
      const conversation = binding.conversation;
      const persistable = conversation.store.getPersistableConversation();
      try {
        await call.controller.start({
          conversationId: conversation.getConversationId(),
          backendDisplayName: binding.backendDisplayName,
          startupContext: buildVoiceStartupContext({
            messages: persistable.messages,
            tasks: persistable.tasks,
            backendDisplayName: binding.backendDisplayName,
            uiContext: binding.describeUiContext?.(),
          }),
        });
      } catch (error) {
        this.releaseCall(call);
        if (this.call === call) this.call = null;
        this.notify();
        return refuse(
          error instanceof Error ? error.message : "Voice could not connect. Please try again."
        );
      }
      logInfo("[Voice] call open", {
        conversationId: conversation.getConversationId(),
        voiceSessionId: call.controller.getSnapshot().voiceSessionId,
      });
      this.notify();
      return { started: true };
    } finally {
      this.starting = null;
    }
  }

  /**
   * End the live call. The conversation, its accepted work, and the backend
   * session are untouched; only the spoken channel closes.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Mode and control behavior".
   */
  private async end(reason: string): Promise<void> {
    const call = this.call;
    this.lastState = null;
    if (!call) {
      this.notify();
      return;
    }
    call.endRequested = true;
    this.releaseCall(call);
    try {
      const closing = call.controller.close(reason);
      this.notify();
      await closing;
    } catch (error) {
      logWarn("[Voice] closing the call failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
    } finally {
      if (this.call === call) this.call = null;
      this.notify();
    }
  }

  /** Wire one call's transport, task, and session subscriptions. */
  private openCall(binding: VoiceChatBinding, opened: VoiceCallResources): ActiveCall {
    const call: ActiveCall = {
      binding,
      controller: opened.controller,
      timers: opened.timers,
      transcript: new VoiceTranscriptAssembler(),
      rowMessageIds: new Map(),
      pending: new Map(),
      delegationTasks: new Map(),
      ownedTasks: new Map(),
      releases: [],
      endRequested: false,
      warningSecondsRemaining: null,
    };
    const { tasks } = binding.conversation;
    call.releases.push(
      opened.controller.subscribe((event) => this.handleCallEvent(call, event)),
      tasks.subscribe(() => this.reportTaskProgress(call)),
      tasks.onTaskSettled((result) => this.reportSettledTask(call, result)),
      binding.conversation.subscribe({
        onMessagesChanged: () => {},
        onStatusChanged: () => this.reportTaskProgress(call),
      })
    );
    return call;
  }

  private releaseCall(call: ActiveCall): void {
    for (const pending of [...call.pending.values()]) this.forget(call, pending);
    for (const release of call.releases) {
      try {
        release();
      } catch (error) {
        logWarn("[Voice] releasing a call subscription failed", error);
      }
    }
    call.releases = [];
  }

  private handleCallEvent(call: ActiveCall, event: VoiceSessionEvent): void {
    switch (event.type) {
      case "state.changed":
        // A dropped control socket can end without a session.closed frame.
        // Release ownership only once transport is off, while retaining the
        // failure for restart UI. See designdocs/VOICE_CHAT_DEMO_DESIGN.md.
        if (event.snapshot.state === "off" && this.call === call) {
          if (!call.endRequested) this.markInterrupted(call);
          this.lastState = { binding: call.binding, state: this.snapshotState() };
          this.call = null;
          this.releaseCall(call);
        }
        this.notify();
        return;
      case "transcript.delta":
        this.ingestTranscript(call, event.delta);
        return;
      case "delegation.requested":
        this.trackDelegation(call, event.liveDelegationId);
        return;
      case "session.warning":
        call.warningSecondsRemaining = event.secondsRemaining;
        this.notify();
        return;
      case "usage.updated":
        this.notify();
        return;
      case "session.closed":
        // Our own close is an orderly ending; anything else cut speech off
        // mid-sentence, and the affected row must say so rather than standing
        // as a complete turn.
        if (!call.endRequested) this.markInterrupted(call);
        this.notify();
        return;
      case "error":
        if (!event.recoverable && !call.endRequested) this.markInterrupted(call);
        this.notify();
        return;
    }
  }

  /** Write one transcript fragment into the conversation as a public row. */
  private ingestTranscript(call: ActiveCall, delta: VoiceTranscriptDelta): void {
    const change = call.transcript.ingest(delta);
    if (!change) return;
    const store = call.binding.conversation.store;
    const existing = call.rowMessageIds.get(change.group.groupId);
    if (existing === undefined) {
      const messageId = store.addMessage({
        sender: change.group.role === "user" ? USER_SENDER : AI_SENDER,
        message: change.group.text,
        timestamp: null,
        isVisible: true,
        origin: change.group.role === "user" ? "voice-user" : "voice-assistant",
        voiceSessionId: delta.voiceSessionId,
        sourceRanges: change.group.ranges,
      });
      call.rowMessageIds.set(change.group.groupId, messageId);
    } else {
      store.updateVoiceTranscript(existing, change.group.text, change.group.ranges);
    }
    call.binding.conversation.notifyConversationChanged();
    // Assistant acknowledgments must not postpone dispatch of settled user speech.
    if (delta.role === "user") {
      for (const pending of call.pending.values()) this.evaluate(call, pending);
    }
  }

  /** Mark the row that was still being spoken when the call ended abruptly. */
  private markInterrupted(call: ActiveCall): void {
    const openGroupId = call.transcript.getOpenAssistantGroupId();
    if (!openGroupId) return;
    const messageId = call.rowMessageIds.get(openGroupId);
    if (!messageId) return;
    if (call.binding.conversation.store.markVoiceInterrupted(messageId)) {
      call.binding.conversation.notifyConversationChanged();
    }
  }

  /**
   * Record a delegation before acknowledging it, then wait for the speech it
   * belongs to. A timer alone never authorizes work: the request needs usable
   * user speech before it can settle.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "From speech to a local task".
   */
  private trackDelegation(call: ActiveCall, liveDelegationId: string): void {
    const known = call.delegationTasks.get(liveDelegationId);
    if (known !== undefined) {
      // A repeated notification returns the mapping we already recorded rather
      // than starting the same work twice.
      call.controller.acceptDelegation(liveDelegationId, known);
      return;
    }
    if (call.pending.has(liveDelegationId)) return;
    const pending: PendingDelegation = {
      liveDelegationId,
      settleTimer: null,
      giveUpTimer: call.timers.setTimeout(
        () => this.deferForMissingSpeech(call, liveDelegationId),
        TRANSCRIPT_MAX_WAIT_MS
      ),
    };
    call.pending.set(liveDelegationId, pending);
    this.evaluate(call, pending);
  }

  /** Wait for user speech to settle before constructing its delegated request. */
  private evaluate(call: ActiveCall, pending: PendingDelegation): void {
    // Delegation offsets mark when the model delegates, which can follow user silence.
    // Waiting for user speech to reach that timestamp would reject complete requests.
    if (!call.transcript.hasUserSpeech()) return;
    if (pending.settleTimer !== null) call.timers.clearTimeout(pending.settleTimer);
    pending.settleTimer = call.timers.setTimeout(
      () => this.acceptDelegation(call, pending.liveDelegationId),
      TRANSCRIPT_SETTLE_MS
    );
  }

  /** Turn settled speech into one local task, or say why it did not become one. */
  private acceptDelegation(call: ActiveCall, liveDelegationId: string): void {
    const pending = call.pending.get(liveDelegationId);
    if (!pending) return;
    this.forget(call, pending);
    const claim = call.transcript.claimUserSpeech();
    if (!claim) {
      // Every fragment already belongs to a task. Typed requests and earlier
      // spoken requests are not re-run because the model asked again.
      this.defer(call, liveDelegationId, "already-claimed");
      return;
    }
    const binding = call.binding;
    const submission: AgentTaskSubmission = {
      submissionId: this.deps.newSubmissionId(),
      conversationId: binding.conversation.getConversationId(),
      sourceMessageIds: claim.groupIds
        .map((groupId) => call.rowMessageIds.get(groupId))
        .filter((id): id is string => id !== undefined),
      source: "voice",
      presentation: "voice-card",
      requestText: claim.text,
      context: binding.resolveContext?.(),
      voiceSessionId: call.controller.getSnapshot().voiceSessionId ?? undefined,
      delegationId: liveDelegationId,
    };
    const acceptance = binding.conversation.tasks.submit(submission);
    if (acceptance.disposition === "rejected") {
      this.defer(call, liveDelegationId, "declined");
      return;
    }
    call.delegationTasks.set(liveDelegationId, acceptance.taskId);
    this.own(call, acceptance.taskId, claim.text, liveDelegationId);
    call.controller.acceptDelegation(liveDelegationId, acceptance.taskId);
    logInfo("[Voice] delegation accepted", {
      liveDelegationId,
      taskId: acceptance.taskId,
      disposition: acceptance.disposition,
    });
    this.reportTaskProgress(call);
  }

  /** Give up on a delegation whose speech never arrived. */
  private deferForMissingSpeech(call: ActiveCall, liveDelegationId: string): void {
    const pending = call.pending.get(liveDelegationId);
    if (!pending) return;
    this.forget(call, pending);
    // Timing out leaves speech unclaimed; it does not mean a task already owns it.
    this.defer(call, liveDelegationId, "no-transcript");
  }

  private defer(
    call: ActiveCall,
    liveDelegationId: string,
    reason: "no-transcript" | "already-claimed" | "declined"
  ): void {
    logInfo("[Voice] delegation deferred", { liveDelegationId, reason });
    call.controller.deferDelegation(liveDelegationId, reason);
  }

  private forget(call: ActiveCall, pending: PendingDelegation): void {
    if (pending.settleTimer !== null) call.timers.clearTimeout(pending.settleTimer);
    call.timers.clearTimeout(pending.giveUpTimer);
    call.pending.delete(pending.liveDelegationId);
  }

  /**
   * Capture the call's presentation on a typed submission at the moment it is
   * sent. Presentation is fixed for a task's whole life, so ending voice later
   * never moves a historical answer.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Typed input during voice".
   */
  private prepareSubmission(
    binding: VoiceChatBinding,
    submission: AgentTaskSubmission
  ): AgentTaskSubmission {
    const call = this.call;
    if (!call || call.binding !== binding) return submission;
    const snapshot = call.controller.getSnapshot();
    if (snapshot.state !== "active") return submission;
    return {
      ...submission,
      presentation: "voice-card",
      voiceSessionId: snapshot.voiceSessionId ?? undefined,
    };
  }

  /**
   * Mirror an accepted typed request into the spoken conversation, so speech
   * knows Copilot already took the work on and never asks for it again.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Typed input during voice".
   */
  private noteSubmissionAccepted(
    binding: VoiceChatBinding,
    submission: AgentTaskSubmission,
    acceptance: AgentTaskAcceptance
  ): void {
    const call = this.call;
    if (!call || call.binding !== binding) return;
    if (submission.source !== "typed" || submission.presentation !== "voice-card") return;
    if (acceptance.disposition === "rejected" || acceptance.disposition === "duplicate") return;
    this.own(call, acceptance.taskId, submission.requestText);
    call.controller.updateContext({
      submission: {
        submissionId: submission.submissionId,
        taskId: acceptance.taskId,
        requestText: bound(submission.requestText, MAX_ANSWER_EXCERPT_CHARS),
      },
      facts: this.describeQueue(call),
    });
    this.reportTaskProgress(call);
  }

  /** Take responsibility for reporting one task's progress to this call. */
  private own(
    call: ActiveCall,
    taskId: string,
    requestText: string,
    liveDelegationId?: string
  ): void {
    if (call.ownedTasks.has(taskId)) return;
    call.ownedTasks.set(taskId, {
      liveDelegationId,
      reported: null,
      revision: 0,
      requestText,
    });
  }

  /**
   * Send whatever changed about this call's tasks. Sparse by construction: a
   * state that was already reported is not sent again, and nothing is sent
   * once the call that started the work is gone.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Returning progress and results".
   */
  private reportTaskProgress(call: ActiveCall): void {
    if (this.call !== call) return;
    const { tasks, store } = call.binding.conversation;
    const queued = new Set(tasks.getQueuedTasks().map((task) => task.taskId));
    const activeTaskId = tasks.getActiveTask()?.taskId ?? null;
    const awaitingUser = call.binding.conversation.getStatus() === "awaiting_permission";
    for (const [taskId, owned] of call.ownedTasks) {
      const record = store.getTask(taskId);
      // A settled task is reported by `reportSettledTask`, which alone knows
      // the outcome; a queue snapshot must never overwrite it.
      if (record && isTerminal(record.state)) continue;
      let state: VoiceTaskState;
      if (queued.has(taskId)) state = "queued";
      else if (taskId === activeTaskId) state = awaitingUser ? "awaiting-user" : "running";
      else continue;
      this.sendTaskFact(call, taskId, owned, state);
    }
    this.notify();
  }

  /** Report a task's real outcome, including a bounded excerpt of its answer. */
  private reportSettledTask(call: ActiveCall, result: AgentTaskResult): void {
    if (this.call !== call) return;
    const owned = call.ownedTasks.get(result.taskId);
    if (!owned) return;
    this.sendTaskFact(
      call,
      result.taskId,
      owned,
      result.state,
      result.state === "completed" && result.answerText
        ? bound(result.answerText, MAX_ANSWER_EXCERPT_CHARS)
        : undefined
    );
    this.notify();
  }

  private sendTaskFact(
    call: ActiveCall,
    taskId: string,
    owned: OwnedTask,
    state: VoiceTaskState,
    excerpt?: string
  ): void {
    if (owned.reported === state) return;
    if (call.controller.getSnapshot().state !== "active") return;
    owned.reported = state;
    owned.revision += 1;
    call.controller.updateTask({
      taskId,
      revision: owned.revision,
      state,
      ...(excerpt !== undefined ? { excerpt } : {}),
      ...(owned.liveDelegationId !== undefined ? { liveDelegationId: owned.liveDelegationId } : {}),
    });
  }

  /** One line per spoken request parked behind the running turn. */
  private describeQueue(call: ActiveCall): readonly string[] {
    const queued = call.binding.conversation.tasks
      .getQueuedTasks()
      .filter((task) => call.ownedTasks.has(task.taskId));
    if (queued.length === 0) return EMPTY_VOICE_FOLLOW_UPS;
    return queued.map(
      (task) => `Queued, not started: "${bound(task.submission.requestText, MAX_FOLLOW_UP_CHARS)}"`
    );
  }

  private snapshotState(): AgentVoiceRuntimeState {
    const call = this.call!;
    const snapshot: VoiceSessionSnapshot = call.controller.getSnapshot();
    return {
      session: snapshot.state,
      inputMuted: snapshot.locallyMuted,
      inputCommandPending: snapshot.inputCommandPending,
      playbackActive: snapshot.playbackActive,
      outputLevel: snapshot.outputLevel,
      startedAtMs: snapshot.startedAtMs,
      usage: snapshot.usage
        ? {
            connectedSeconds: snapshot.usage.connectedSeconds,
            estimatedCostUsd: snapshot.usage.estimatedCostUsd,
            confirmed: snapshot.usage.source === "provider",
          }
        : null,
      secondsRemainingWarning: call.warningSecondsRemaining,
      errorCode: snapshot.errorCode,
      queuedFollowUps: this.describeQueue(call),
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        logWarn("[Voice] state listener threw", error);
      }
    }
  }
}

function refuse(reason: string): AgentVoiceStartOutcome {
  return { started: false, reason };
}

function isTerminal(state: string): boolean {
  return (
    state === "completed" || state === "cancelled" || state === "failed" || state === "interrupted"
  );
}

/**
 * Cut text to a bound, saying that it was cut. A shortened answer must never
 * be spoken as if it were the whole answer.
 */
function bound(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}…`;
}
