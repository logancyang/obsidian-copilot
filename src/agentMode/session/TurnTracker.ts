import { AI_SENDER } from "@/constants";
import { logWarn } from "@/logger";
import type { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import type { FileCaptures } from "@/agentMode/session/turnFileChanges";
import type {
  BackendId,
  PromptContent,
  PromptInput,
  QueuedPrompt,
  StopReason,
  TaskEndStatus,
  TurnDiff,
  TurnEnd,
} from "@/agentMode/session/types";
import { buildUserMessage } from "@/agentMode/session/promptEnvelope";
import { buildEmptyTurnMessage, formatPromptFailure } from "@/agentMode/session/promptFailure";
import { formatDateTime } from "@/utils";
import { Notice } from "obsidian";

export type TurnOutcome = Omit<TurnEnd, "turnId">;

export type TurnPrompt = Omit<PromptInput, "sessionId">;

export interface TurnSend {
  signal: AbortSignal;
  pushed: () => void;
}

export interface TurnTrackerDeps {
  store: AgentMessageStore;
  backendId: BackendId;
  prompt: (input: TurnPrompt) => Promise<void>;
  notifyMessages: () => void;
  notifyQueuedPrompts: () => void;
  promptsWithdrawn: (prompts: readonly QueuedPrompt[]) => void;
  notifyStatus: () => void;
  runningTaskToolCallIds: () => ReadonlySet<string>;
  endLaunches: (status: TaskEndStatus) => void;
  captureFileChanges: (
    files: FileCaptures,
    messageId: string,
    turnDiff?: TurnDiff
  ) => Promise<boolean>;
  onTurnCompleted: () => void;
}

interface PendingPrompt {
  delivered: boolean;
  continuesAtOutputLimit: boolean;
  settle: (outcome: TurnOutcome) => void;
}

interface StopDrain {
  ended: Promise<void>;
  end: () => void;
  promptIds: ReadonlySet<string>;
}

const EMPTY_QUEUED_PROMPTS: readonly QueuedPrompt[] = Object.freeze([]);

export class TurnTracker {
  private placeholderId: string | null = null;
  private replyStartedAtMs = 0;
  private openTurnId: string | null = null;
  private sendController: AbortController | null = null;
  private lastTurnFailed = false;
  private pendingPrompts = new Map<string, PendingPrompt>();
  private queuedPrompts: readonly QueuedPrompt[] = EMPTY_QUEUED_PROMPTS;
  private withdrawnPrompts: readonly QueuedPrompt[] = EMPTY_QUEUED_PROMPTS;
  private sendOrder: Promise<void> = Promise.resolve();
  private stopDrain: StopDrain | null = null;
  private cancelledMessageIds = new Set<string>();
  private currentMessageIds = new Set<string>();
  private settledStream: {
    placeholderId: string;
    messageIds: Set<string>;
    turnStartedAtMs: number;
  } | null = null;
  private showedActivityElsewhere = false;
  private turnFiles: FileCaptures = new Map();

  constructor(private readonly deps: TurnTrackerDeps) {}

  getReplyId(): string | null {
    return this.placeholderId;
  }

  getReplyStartedAtMs(): number {
    return this.replyStartedAtMs;
  }

  getQueuedPrompts(): readonly QueuedPrompt[] {
    return this.queuedPrompts;
  }

  getTurnFiles(): FileCaptures {
    return this.turnFiles;
  }

  isSending(): boolean {
    return this.sendController !== null;
  }

  isMainTurnRunning(): boolean {
    return this.sendController !== null || this.openTurnId !== null;
  }

  hasLastTurnFailed(): boolean {
    return this.lastTurnFailed;
  }

  isStopping(): boolean {
    return this.stopDrain !== null || this.sendController?.signal.aborted === true;
  }

  takeWithdrawnPrompts(): readonly QueuedPrompt[] {
    const withdrawn = this.withdrawnPrompts;
    this.withdrawnPrompts = EMPTY_QUEUED_PROMPTS;
    return withdrawn;
  }

  openReply(continuesTurn = false, startedAtMs = Date.now()): string {
    this.replyStartedAtMs = startedAtMs;
    this.placeholderId = this.deps.store.addMessage({
      message: "",
      sender: AI_SENDER,
      timestamp: formatDateTime(new Date(this.replyStartedAtMs)),
      isVisible: true,
      parts: [],
    });
    this.currentMessageIds = new Set();
    if (!continuesTurn) {
      this.showedActivityElsewhere = false;
      this.turnFiles = new Map();
    }
    this.deps.notifyMessages();
    return this.placeholderId;
  }

  releaseReply(replyId: string): void {
    if (this.placeholderId === replyId) this.placeholderId = null;
  }

  startSend(): TurnSend {
    const controller = new AbortController();
    this.sendController = controller;
    this.lastTurnFailed = false;
    this.deps.notifyStatus();
    return { signal: controller.signal, pushed: this.takeSendOrder().done };
  }

  endSend(signal: AbortSignal): void {
    // A turn started after Stop already let go of this send's controller, and a later send may own the current one. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
    if (this.sendController?.signal === signal) this.sendController = null;
    this.deps.notifyStatus();
  }

  whenStoppedTurnEnds(signal: AbortSignal): Promise<void> | null {
    const drain = this.stopDrain?.ended;
    if (!drain) return null;
    return Promise.race([
      drain,
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    ]);
  }

  // A message sent while the agent works is shown only once it reaches the agent, at that point in the transcript. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
  queue(
    prompt: QueuedPrompt,
    interrupt: boolean,
    preparePrompt: () => Promise<() => PromptContent[]>
  ): Promise<StopReason> {
    this.setQueuedPrompts([...this.queuedPrompts, prompt]);
    const order = this.takeSendOrder();
    return (async (): Promise<StopReason> => {
      try {
        await order.ready;
        const buildPrompt = await preparePrompt();
        // A message withdrawn while it waited to be sent never reaches the agent. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
        if (!this.isQueued(prompt.id)) return "cancelled";
        const blocks = buildPrompt();
        const outcome = await this.submit(
          { promptId: prompt.id, prompt: blocks, ...(interrupt ? { interrupt } : {}) },
          false,
          order.done
        );
        if (outcome.error !== undefined) throw outcome.error;
        return outcome.stopReason;
      } catch (err) {
        // A message the agent refused goes back to the composer, and the user is told why it came back. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
        if (this.isQueued(prompt.id)) {
          this.withdrawPrompts([prompt.id]);
          new Notice("Failed to send message. Please try again.");
        }
        throw err;
      } finally {
        order.done();
      }
    })();
  }

  submit(
    input: TurnPrompt,
    continuesAtOutputLimit: boolean,
    onPushed?: () => void
  ): Promise<TurnOutcome> {
    const ended = new Promise<TurnOutcome>((settle) => {
      this.pendingPrompts.set(input.promptId, { delivered: false, continuesAtOutputLimit, settle });
    });
    const admitted = this.deps
      .prompt(input)
      .finally(onPushed)
      .then(
        () => ended,
        (err: unknown) => {
          this.endStopDrain();
          if (!this.pendingPrompts.delete(input.promptId)) return ended;
          throw err;
        }
      );
    // Stop must free the chat while the agent is still signing in or starting up. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    return Promise.race([ended, admitted]);
  }

  async withdrawQueued(
    promptId: string,
    withdrawSent: () => Promise<boolean> | undefined
  ): Promise<void> {
    if (!this.isQueued(promptId)) return;
    if (!this.pendingPrompts.has(promptId)) return this.withdrawPrompts([promptId]);
    const withdrawn = await withdrawSent();
    // A message the agent has already taken can no longer be withdrawn, so it shows as sent. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
    if (withdrawn === false) this.deliverPrompt(promptId);
  }

  refuse(message: string): TurnOutcome {
    const placeholderId = this.placeholderId!;
    this.deps.store.markMessageError(placeholderId, message);
    this.deps.store.markTurnComplete(placeholderId, "refusal", Date.now() - this.replyStartedAtMs);
    this.placeholderId = null;
    this.deps.notifyMessages();
    return { stopReason: "refusal" };
  }

  stop(withdrawsUnsent: boolean): void {
    this.sendController?.abort();
    // A message handed to the agent for its next step is the backend's to withdraw at Stop; a backend that cannot keeps it and runs it next. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
    const queued = new Set(this.queuedPrompts.map((p) => p.id));
    if (withdrawsUnsent) {
      this.withdrawPrompts(
        this.queuedPrompts.flatMap((p) => (this.pendingPrompts.has(p.id) ? [] : [p.id]))
      );
    }
    const stoppedIds = [...this.pendingPrompts.keys()].filter((id) => !queued.has(id));
    // The stopped prompt's turn may still be running or yet to start; it renders nothing until it ends. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    if (this.openTurnId !== null || stoppedIds.length > 0) {
      let end!: () => void;
      const ended = new Promise<void>((resolve) => (end = resolve));
      this.stopDrain = { ended, end, promptIds: new Set(stoppedIds) };
    }
    this.openTurnId = null;
    const stopped = stoppedIds.map((id) => this.pendingPrompts.get(id)!);
    for (const id of stoppedIds) this.pendingPrompts.delete(id);
    for (const messageId of this.currentMessageIds) this.cancelledMessageIds.add(messageId);
    this.currentMessageIds = new Set();
    void this.finalizeReply("cancelled").then(() => {
      for (const prompt of stopped) prompt.settle({ stopReason: "cancelled" });
    });
    this.settledStream = null;
  }

  dispose(): void {
    this.settledStream = null;
    this.endStopDrain();
    this.openTurnId = null;
    for (const prompt of this.pendingPrompts.values()) prompt.settle({ stopReason: "cancelled" });
    this.pendingPrompts.clear();
    this.queuedPrompts = EMPTY_QUEUED_PROMPTS;
    this.cancelledMessageIds.clear();
    this.currentMessageIds = new Set();
  }

  startTurn(turnId: string, startedAt?: number): void {
    if (this.stopDrain) return;
    // A turn that starts after Stop runs a message kept through it, so the stopped prompt's cancellation must not drop its output. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
    if (this.sendController?.signal.aborted) this.sendController = null;
    this.openTurnId = turnId;
    if (!this.placeholderId) this.openReply(false, startedAt);
    this.deps.notifyStatus();
  }

  deliverPrompt(promptId: string): void {
    const prompt = this.pendingPrompts.get(promptId);
    if (prompt) prompt.delivered = true;
    this.showDeliveredPrompt(promptId);
  }

  withdrawPrompts(promptIds: readonly string[]): void {
    // A stopped message the agent never took has no turn left to wait for. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
    if (promptIds.some((id) => this.stopDrain?.promptIds.has(id))) this.endStopDrain();
    for (const promptId of promptIds) {
      this.pendingPrompts.get(promptId)?.settle({ stopReason: "cancelled" });
      this.pendingPrompts.delete(promptId);
    }
    const ids = new Set(promptIds);
    const withdrawn = this.queuedPrompts.filter((p) => ids.has(p.id));
    // A message the agent never read goes back to the composer, so its text is not lost. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
    if (withdrawn.length > 0) {
      this.withdrawnPrompts = Object.freeze([...this.withdrawnPrompts, ...withdrawn]);
      this.deps.promptsWithdrawn(withdrawn);
    }
    this.removeQueuedPrompts(promptIds);
    this.deps.notifyStatus();
  }

  // The next send reconnects the agent, so the chat only reports the loss. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
  disconnect(error: Error): void {
    this.endStopDrain();
    if (this.placeholderId || this.pendingPrompts.size > 0) this.failReply(error);
    this.withdrawPrompts([...this.pendingPrompts.keys()]);
  }

  endTurn(end: TurnEnd): void {
    if (this.stopDrain) {
      this.endStopDrain();
      return;
    }
    if (end.turnId !== this.openTurnId) {
      logWarn(`[AgentMode] ignoring the end of turn ${end.turnId}, which is not running`);
      return;
    }
    this.openTurnId = null;
    const delivered = [...this.pendingPrompts].filter(([, prompt]) => prompt.delivered);
    for (const [promptId] of delivered) this.pendingPrompts.delete(promptId);
    const prompts = delivered.map(([, prompt]) => prompt);
    const settle = (): void => {
      for (const prompt of prompts) prompt.settle(end);
      this.deps.notifyStatus();
    };
    if (end.error !== undefined) {
      this.failReply(end.error);
      return settle();
    }
    // An agent cut off at its output limit gets the cause and one chance to continue in the same reply. https://github.com/Brevilabs/obsidian-copilot-private/issues/739
    if (end.stopReason === "max_tokens" && prompts.some((p) => p.continuesAtOutputLimit)) {
      if (this.placeholderId && this.deps.store.settleOpenParts(this.placeholderId, "failed")) {
        this.deps.notifyMessages();
      }
      return settle();
    }
    void this.finalizeReply(end.stopReason, end.turnDiff).then(settle);
  }

  failReply(err: unknown): void {
    logWarn(`[AgentMode] prompt failed`, err);
    const placeholderId = this.placeholderId ?? this.openReply();
    // The turn's error already shows the failure, so the row must not repeat it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/633
    this.deps.store.settleOpenParts(placeholderId, "failed");
    this.deps.endLaunches("failed");
    this.deps.store.markMessageError(
      placeholderId,
      formatPromptFailure(err),
      Date.now() - this.replyStartedAtMs
    );
    this.placeholderId = null;
    this.currentMessageIds = new Set();
    this.lastTurnFailed = true;
    this.deps.notifyMessages();
  }

  resolveContentTarget(messageId: string | undefined): string | null {
    if (this.isStopping() || (messageId !== undefined && this.cancelledMessageIds.has(messageId))) {
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

  dropStoppedContent(messageId: string | undefined): void {
    if (messageId) this.cancelledMessageIds.add(messageId);
  }

  extendSettledTurn(replyId: string): void {
    if (replyId !== this.settledStream?.placeholderId) return;
    this.deps.store.extendTurnDuration(replyId, Date.now() - this.settledStream.turnStartedAtMs);
  }

  resolveToolTarget(ownerMessageId: string | undefined): string | null {
    const target = ownerMessageId ?? this.placeholderId;
    if (!target) return null;
    if (target !== this.placeholderId) this.showedActivityElsewhere = true;
    return target;
  }

  private isQueued(promptId: string): boolean {
    return this.queuedPrompts.some((p) => p.id === promptId);
  }

  // A message still being prepared must reach the agent before a later one. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
  private takeSendOrder(): { ready: Promise<void>; done: () => void } {
    const ready = this.sendOrder;
    let done!: () => void;
    this.sendOrder = new Promise<void>((resolve) => (done = resolve));
    return { ready, done };
  }

  private setQueuedPrompts(next: readonly QueuedPrompt[]): void {
    this.queuedPrompts = next.length === 0 ? EMPTY_QUEUED_PROMPTS : Object.freeze([...next]);
    this.deps.notifyQueuedPrompts();
  }

  private removeQueuedPrompts(promptIds: readonly string[]): void {
    const ids = new Set(promptIds);
    if (!this.queuedPrompts.some((p) => ids.has(p.id))) return;
    this.setQueuedPrompts(this.queuedPrompts.filter((p) => !ids.has(p.id)));
  }

  private showDeliveredPrompt(promptId: string): void {
    const prompt = this.queuedPrompts.find((p) => p.id === promptId);
    if (!prompt) return;
    this.removeQueuedPrompts([promptId]);
    const { store } = this.deps;
    // The agent's work before the message stays in its own reply and still counts for the turn; an empty reply gives way to the message. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
    const reply = this.placeholderId;
    if (reply && store.hasAssistantActivity(reply)) {
      store.markTurnComplete(reply, "end_turn", Date.now() - this.replyStartedAtMs);
      this.showedActivityElsewhere = true;
    } else if (reply) {
      store.deleteMessage(reply);
    }
    store.addMessage(
      buildUserMessage(prompt.id, prompt.text, prompt.context, prompt.promptContent)
    );
    if (reply) this.openReply(true);
    else this.deps.notifyMessages();
  }

  private endStopDrain(): void {
    this.stopDrain?.end();
    this.stopDrain = null;
  }

  private async finalizeReply(stopReason: StopReason, turnDiff?: TurnDiff): Promise<void> {
    const placeholderId = this.placeholderId;
    if (!placeholderId) return;
    const { store, backendId } = this.deps;
    const turnStartedAtMs = this.replyStartedAtMs;
    this.placeholderId = null;
    this.settledStream =
      stopReason === "cancelled"
        ? null
        : { placeholderId, messageIds: this.currentMessageIds, turnStartedAtMs };
    this.currentMessageIds = new Set();
    if (
      stopReason !== "cancelled" &&
      !this.showedActivityElsewhere &&
      !store.hasAssistantActivity(placeholderId)
    ) {
      const message = buildEmptyTurnMessage(backendId, stopReason);
      logWarn(
        `[AgentMode] ${backendId} completed a turn without assistant text or tool activity (stopReason=${stopReason})`
      );
      store.markMessageError(placeholderId, message);
    }
    // Stop ends the turn's tool calls with it; a background task launched in the turn keeps running. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
    if (stopReason === "cancelled") {
      store.stopToolCalls(placeholderId, this.deps.runningTaskToolCallIds());
    }
    store.settleOpenParts(placeholderId);
    this.deps.endLaunches(stopReason === "cancelled" ? "stopped" : "failed");
    // A turn whose file changes cannot be captured, such as one with a malformed agent diff, must still end. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    const turnFiles = this.turnFiles;
    this.turnFiles = new Map();
    const filesChanged = await this.deps
      .captureFileChanges(turnFiles, placeholderId, turnDiff)
      .catch((err: unknown) => {
        logWarn(`[AgentMode] could not capture the turn's file changes`, err);
        return false;
      });
    if (filesChanged) this.deps.notifyMessages();
    if (store.markTurnComplete(placeholderId, stopReason, Date.now() - turnStartedAtMs)) {
      this.deps.notifyMessages();
    }
    if (stopReason === "end_turn") this.deps.onTurnCompleted();
  }
}
