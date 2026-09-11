import { logError, logWarn } from "@/logger";
import type { StopReason } from "@/agentMode/session/types";
import type {
  AgentTaskRecord,
  AgentTaskResult,
  AgentTaskSubmission,
} from "@/agentMode/session/voiceTypes";
import type { MessageContext, SelectedTextContext, WebTabContext } from "@/types/message";
import { mergeWebTabContexts } from "@/utils/urlNormalization";
import { TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";

/**
 * Why a submission is parked instead of dispatched. Snapshotted at enqueue
 * time so the queue row explains what held it, rather than chasing blockers as
 * they evolve.
 */
export type AgentQueueHoldReason = "context" | "busy";

/** A submission waiting for the session to become free. */
export interface AgentQueuedTask {
  taskId: string;
  submission: AgentTaskSubmission;
  queueReason: AgentQueueHoldReason;
}

/**
 * What {@link AgentTaskCoordinator.submit} decided, recorded synchronously so
 * the caller can acknowledge the request before any work starts. `duplicate`
 * means the submission (or its delegation) already maps to `taskId`.
 */
export interface AgentTaskAcceptance {
  taskId: string;
  disposition: "dispatched" | "queued" | "duplicate" | "rejected";
  /** Present only for `rejected`: why the session refused the work. */
  rejectionReason?: string;
}

/**
 * The slice of `AgentSession` the coordinator drives. Declared here so the
 * coordinator stays a plain unit under test and the session keeps owning
 * messages, prompts, and cancellation.
 */
export interface AgentTaskExecutor {
  /**
   * Start one backend turn for an accepted submission and link it to `taskId`.
   * The returned promise is the raw turn outcome: it rejects on transport
   * failure and must not be wrapped in anything that swallows errors.
   */
  submitTask(
    submission: AgentTaskSubmission,
    taskId: string
  ): { assistantMessageId: string; turn: Promise<StopReason> };
  /** Record a task's real terminal state from its turn outcome. */
  settleTask(
    taskId: string,
    outcome: { stopReason?: StopReason; error?: unknown }
  ): AgentTaskResult;
  /** Cancel the in-flight turn, if any. */
  cancel(): Promise<void>;
  getTask(taskId: string): AgentTaskRecord | undefined;
}

// Frozen empty so an idle coordinator keeps handing back the same reference
// and the memoized queue UI bails out instead of re-rendering.
const EMPTY_QUEUED_TASKS: readonly AgentQueuedTask[] = Object.freeze([]);

// Holder key for a caller that owns dispatch on its own (every test, and any
// future single-surface driver). A conversation shown in two windows passes a
// distinct key per composer instead.
const SOLE_HOLDER = "sole-holder";

const dedupeBy = <T>(items: Iterable<T>, key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
};

const buildMessageContext = (
  notes: TFile[],
  selected: SelectedTextContext[],
  webTabs: WebTabContext[]
): MessageContext | undefined => {
  if (notes.length === 0 && selected.length === 0 && webTabs.length === 0) return undefined;
  return {
    notes,
    urls: [],
    selectedTextContexts: selected.length > 0 ? selected : undefined,
    webTabs: webTabs.length > 0 ? webTabs : undefined,
  };
};

/**
 * Fold consecutive typed submissions into the single turn the backend sees,
 * preserving the order the user sent them. Keeps the first entry's identity so
 * every id already handed to a caller still resolves to the surviving task.
 */
function combineTypedSubmissions(items: readonly AgentQueuedTask[]): AgentTaskSubmission {
  const first = items[0].submission;
  if (items.length === 1) return first;
  const submissions = items.map((item) => item.submission);
  const allPromptContent = submissions.flatMap((s) => [...(s.promptContent ?? [])]);
  const mergedAgents = dedupeBy(
    submissions.flatMap((s) => [...(s.mentionedAgents ?? [])]),
    (id) => id
  );
  const rawInputs = submissions.map((s) => s.rawInput).filter((raw): raw is string => !!raw);
  return {
    ...first,
    sourceMessageIds: submissions.flatMap((s) => [...s.sourceMessageIds]),
    requestText: submissions.map((s) => s.requestText).join("\n\n"),
    rawInput: rawInputs.length > 0 ? rawInputs.join("\n\n") : undefined,
    context: buildMessageContext(
      dedupeBy(
        submissions.flatMap((s) => s.context?.notes ?? []),
        (n) => n.path
      ),
      dedupeBy(
        submissions.flatMap((s) => s.context?.selectedTextContexts ?? []),
        (s) => s.id
      ),
      mergeWebTabContexts(submissions.flatMap((s) => s.context?.webTabs ?? []))
    ),
    promptContent: allPromptContent.length > 0 ? allPromptContent : undefined,
    mentionedAgents: mergedAgents.length > 0 ? mergedAgents : undefined,
  };
}

/**
 * Single owner of local task submission for one conversation. Every request —
 * typed today, spoken once the voice transport exists — becomes a task here,
 * gets a stable id and a presentation fixed at submission, and reaches the
 * session one at a time. Owning the queue in one place is what stops a second
 * input channel from racing a parallel queue against the composer's.
 *
 * It does not own voice transport, message content, or backend lifetime.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
 */
export class AgentTaskCoordinator {
  private queue: AgentQueuedTask[] = [];
  private queueSnapshot: readonly AgentQueuedTask[] = EMPTY_QUEUED_TASKS;
  private hold: AgentQueueHoldReason | null = null;
  // What each registered composer reports. One conversation can be composed
  // from several surfaces at once (sidebar plus popout), so the hold is the
  // union of what they report rather than whatever the last one said.
  private readonly holders = new Map<string, AgentQueueHoldReason | null>();
  // Set when the last registered composer goes away: a conversation with no
  // composer on screen is backgrounded and must not flush its queue. Distinct
  // from an empty holder map before any composer registers, which is simply a
  // conversation nothing has rendered yet.
  private backgrounded = false;
  private active: { taskId: string; generation: number } | null = null;
  // Monotonic per dispatch. A turn's callback carries the generation it was
  // started with, so a late settlement from a superseded turn can still record
  // its own outcome without clearing the replacement task that took its slot.
  private generation = 0;
  private readonly submissionToTask = new Map<string, string>();
  private readonly delegationToTask = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly settlementListeners = new Set<(result: AgentTaskResult) => void>();
  private disposed = false;

  constructor(private readonly executor: AgentTaskExecutor) {}

  /**
   * Accept a request for backend work. Returns synchronously: the disposition
   * says whether the turn started, was parked, or was refused. Completion
   * arrives separately through {@link onTaskSettled}.
   */
  submit(submission: AgentTaskSubmission): AgentTaskAcceptance {
    const existing =
      this.submissionToTask.get(submission.submissionId) ??
      (submission.delegationId ? this.delegationToTask.get(submission.delegationId) : undefined);
    if (existing !== undefined) {
      return { taskId: existing, disposition: "duplicate" };
    }

    const taskId = `task-${uuidv4()}`;
    this.submissionToTask.set(submission.submissionId, taskId);
    if (submission.delegationId) this.delegationToTask.set(submission.delegationId, taskId);

    if (this.disposed) {
      return { taskId, disposition: "rejected", rejectionReason: "Conversation is closed" };
    }
    // A non-empty queue holds the line too: a submission accepted while
    // earlier work is still parked must run after it, not in front of it.
    if (this.hold !== null || this.active !== null || this.queue.length > 0) {
      this.queue.push({ taskId, submission, queueReason: this.hold ?? "busy" });
      this.invalidateQueue();
      this.notify();
      return { taskId, disposition: "queued" };
    }
    return this.dispatch(taskId, submission);
  }

  /**
   * Register what one composer currently allows. A composer holds while its
   * project's context is materializing and while it cannot accept work, so
   * queued work never flushes into a conversation that is not ready for it.
   *
   * @param reason - Why this composer holds dispatch, or null to let it run.
   * @param holderId - Identity of the composer reporting; one per mounted instance.
   */
  setDispatchHold(reason: AgentQueueHoldReason | null, holderId: string = SOLE_HOLDER): void {
    this.holders.set(holderId, reason);
    this.backgrounded = false;
    this.applyHold();
  }

  /**
   * Drop a composer that unmounted. Dispatch keeps running while any other
   * composer is still registered — closing a popout must not park the queue
   * the sidebar composer is still driving — and parks once the last one goes,
   * so switching chats never secretly flushes a backgrounded conversation.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
   *
   * @param holderId - Identity the unmounting composer registered under.
   */
  releaseDispatchHold(holderId: string = SOLE_HOLDER): void {
    if (!this.holders.delete(holderId)) return;
    if (this.holders.size === 0) this.backgrounded = true;
    this.applyHold();
  }

  /** Recompute the effective hold from every registered composer and react to it. */
  private applyHold(): void {
    let next: AgentQueueHoldReason | null = null;
    if (this.backgrounded) {
      next = "busy";
    } else {
      for (const reason of this.holders.values()) {
        if (reason !== null) {
          next = reason;
          break;
        }
      }
    }
    if (this.hold === next) return;
    this.hold = next;
    if (next === null) this.drain();
    this.notify();
  }

  getQueuedTasks(): readonly AgentQueuedTask[] {
    return this.queueSnapshot;
  }

  /** Drop a parked submission the user dismissed. */
  removeQueuedTask(taskId: string): boolean {
    const idx = this.queue.findIndex((item) => item.taskId === taskId);
    if (idx === -1) return false;
    const [dropped] = this.queue.splice(idx, 1);
    this.invalidateQueue();
    this.reportDiscarded([dropped]);
    this.notify();
    return true;
  }

  /** The task whose turn the backend is running, or null when idle. */
  getActiveTask(): AgentTaskRecord | null {
    if (!this.active) return null;
    return this.executor.getTask(this.active.taskId) ?? null;
  }

  isBusy(): boolean {
    return this.active !== null;
  }

  /**
   * Stop. Queued submissions are discarded *before* cancellation is requested,
   * so a cancellation that completes the active turn cannot flush a follow-up
   * the user just told us to abandon.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/365
   */
  async cancelActiveAndClearQueue(): Promise<void> {
    if (this.queue.length > 0) {
      const discarded = this.queue;
      this.queue = [];
      this.invalidateQueue();
      this.reportDiscarded(discarded);
      this.notify();
    }
    try {
      await this.executor.cancel();
    } catch (e) {
      logError("[AgentMode] cancel failed", e);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Observe settled outcomes. Fires once per task, after its state is recorded. */
  onTaskSettled(listener: (result: AgentTaskResult) => void): () => void {
    this.settlementListeners.add(listener);
    return () => this.settlementListeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.queueSnapshot = EMPTY_QUEUED_TASKS;
    this.holders.clear();
    this.listeners.clear();
    this.settlementListeners.clear();
  }

  private dispatch(taskId: string, submission: AgentTaskSubmission): AgentTaskAcceptance {
    const generation = ++this.generation;
    this.active = { taskId, generation };
    let turn: Promise<StopReason>;
    try {
      ({ turn } = this.executor.submitTask(submission, taskId));
    } catch (e) {
      this.active = null;
      const rejectionReason = e instanceof Error ? e.message : String(e);
      logWarn("[AgentMode] task submission refused", e);
      this.settle(taskId, { error: e });
      // One refused submission must not strand everything behind it: the rest
      // of the queue still gets its turn.
      this.drain();
      this.notify();
      return { taskId, disposition: "rejected", rejectionReason };
    }
    turn.then(
      (stopReason) => this.finish(taskId, generation, { stopReason }),
      (error) => this.finish(taskId, generation, { error })
    );
    this.notify();
    return { taskId, disposition: "dispatched" };
  }

  private finish(
    taskId: string,
    generation: number,
    outcome: { stopReason?: StopReason; error?: unknown }
  ): void {
    this.settle(taskId, outcome);
    // A turn that was already superseded still records its own outcome, but it
    // must not free the slot or drain the queue on behalf of the task that
    // replaced it.
    if (this.active?.generation !== generation) {
      this.notify();
      return;
    }
    this.active = null;
    this.drain();
    this.notify();
  }

  private settle(taskId: string, outcome: { stopReason?: StopReason; error?: unknown }): void {
    if (this.disposed) return;
    this.emitSettlement(this.executor.settleTask(taskId, outcome));
  }

  /**
   * Report abandoned queued work as cancelled. These submissions never reached
   * the session, so there is no turn to settle — but anything already told
   * that the request was queued must learn it was dropped instead of waiting
   * for an outcome that will never arrive.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
   *
   * @param discarded - Queue rows removed without ever being dispatched.
   */
  private reportDiscarded(discarded: readonly AgentQueuedTask[]): void {
    if (this.disposed) return;
    for (const item of discarded) {
      this.emitSettlement({
        taskId: item.taskId,
        state: "cancelled",
        assistantMessageId: "",
        answerText: "",
      });
    }
  }

  private emitSettlement(result: AgentTaskResult): void {
    for (const listener of this.settlementListeners) {
      try {
        listener(result);
      } catch (e) {
        logWarn("[AgentTaskCoordinator] settlement listener threw", e);
      }
    }
  }

  /**
   * Start the next turn when nothing is held and nothing is running. Leading
   * typed submissions merge into one turn, matching the composer's long-
   * standing follow-up behavior; spoken requests keep their own boundaries and
   * stay one task each.
   */
  private drain(): void {
    if (this.disposed || this.hold !== null || this.active !== null) return;
    if (this.queue.length === 0) return;
    const head = this.queue[0];
    // The leading run of typed submissions merges; a spoken request ends the
    // run (and is dispatched alone when it is the head).
    const run: AgentQueuedTask[] = [head];
    if (head.submission.source === "typed") {
      for (const item of this.queue.slice(1)) {
        if (item.submission.source !== "typed") break;
        run.push(item);
      }
    }
    this.queue = this.queue.slice(run.length);
    this.invalidateQueue();
    const submission = combineTypedSubmissions(run);
    // Every merged id keeps resolving, now to the surviving task.
    for (const item of run) {
      this.submissionToTask.set(item.submission.submissionId, head.taskId);
      if (item.submission.delegationId) {
        this.delegationToTask.set(item.submission.delegationId, head.taskId);
      }
    }
    this.dispatch(head.taskId, submission);
  }

  private invalidateQueue(): void {
    this.queueSnapshot = this.queue.length > 0 ? [...this.queue] : EMPTY_QUEUED_TASKS;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        logWarn("[AgentTaskCoordinator] listener threw", e);
      }
    }
  }
}
