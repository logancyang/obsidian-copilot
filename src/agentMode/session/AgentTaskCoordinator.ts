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
    if (this.hold !== null || this.active !== null) {
      this.queue.push({ taskId, submission, queueReason: this.hold ?? "busy" });
      this.invalidateQueue();
      this.notify();
      return { taskId, disposition: "queued" };
    }
    return this.dispatch(taskId, submission);
  }

  /**
   * Park or release queue dispatch. The composer holds while its project's
   * context is materializing and while it is not the foreground conversation,
   * so switching chats never secretly flushes queued work into a backgrounded
   * session.
   *
   * @param reason - Why dispatch is held, or null to release and drain.
   */
  setDispatchHold(reason: AgentQueueHoldReason | null): void {
    if (this.hold === reason) return;
    this.hold = reason;
    if (reason === null) this.drain();
    this.notify();
  }

  getQueuedTasks(): readonly AgentQueuedTask[] {
    return this.queueSnapshot;
  }

  /** Drop a parked submission the user dismissed. */
  removeQueuedTask(taskId: string): boolean {
    const idx = this.queue.findIndex((item) => item.taskId === taskId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    this.invalidateQueue();
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
      this.queue = [];
      this.invalidateQueue();
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
    const result = this.executor.settleTask(taskId, outcome);
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
