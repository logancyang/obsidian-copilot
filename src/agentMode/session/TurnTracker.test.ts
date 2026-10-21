import { AI_SENDER, USER_SENDER } from "@/constants";
import { Notice } from "obsidian";
import { TurnTracker, type TurnOutcome, type TurnSend } from "./TurnTracker";
import {
  deferred,
  fakeTurnTrackerDeps,
  type FakeTurnTrackerDeps,
} from "./testing/fakeTurnTrackerDeps";
import type { AgentMessageStore } from "./AgentMessageStore";
import type { PromptContent, QueuedPrompt } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const TEXT: PromptContent[] = [{ type: "text", text: "hi" }];
const ALSO: QueuedPrompt = { id: "q1", text: "also check the tests" };
const LATER: QueuedPrompt = { id: "q2", text: "and the docs" };

interface Setup {
  deps: FakeTurnTrackerDeps;
  tracker: TurnTracker;
}

function setup(): Setup {
  const deps = fakeTurnTrackerDeps();
  return { deps, tracker: new TurnTracker(deps) };
}

function send(
  tracker: TurnTracker,
  promptId: string,
  continuesAtOutputLimit = true
): { turnSend: TurnSend; outcome: Promise<TurnOutcome> } {
  tracker.openReply();
  const turnSend = tracker.startSend();
  const outcome = tracker.submit(
    { promptId, prompt: TEXT },
    continuesAtOutputLimit,
    turnSend.pushed
  );
  return { turnSend, outcome };
}

function runningTurn(
  tracker: TurnTracker,
  promptId: string,
  turnId: string
): { turnSend: TurnSend; outcome: Promise<TurnOutcome>; replyId: string } {
  const sent = send(tracker, promptId);
  tracker.deliverPrompt(promptId);
  tracker.startTurn(turnId);
  return { ...sent, replyId: tracker.getReplyId()! };
}

function transcript(store: AgentMessageStore): Array<[string, string, string | null]> {
  return store
    .getDisplayMessages()
    .map((m) => [m.sender, m.message, m.turnStopReason ?? null] as [string, string, string | null]);
}

function toolStatuses(store: AgentMessageStore, messageId: string): Record<string, string> {
  return Object.fromEntries(
    (store.getMessage(messageId)?.parts ?? []).flatMap((p) =>
      p.kind === "tool_call" ? [[p.id, p.status]] : []
    )
  );
}

function addToolCall(
  store: AgentMessageStore,
  messageId: string,
  id: string,
  status: "pending" | "in_progress"
): void {
  store.upsertAgentPart(messageId, { kind: "tool_call", id, title: id, status });
}

describe("TurnTracker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("TurnTracker", () => {
    describe("openReply()", () => {
      it("adds an empty assistant reply, makes it the open reply and notifies", () => {
        const { deps, tracker } = setup();

        const replyId = tracker.openReply();

        expect(transcript(deps.store)).toEqual([[AI_SENDER, "", null]]);
        expect(tracker.getReplyId()).toBe(replyId);
        expect(deps.notifyMessages).toHaveBeenCalledTimes(1);
      });

      it("starts a new file capture for a new turn and keeps the capture when the reply continues the same turn", () => {
        const { tracker } = setup();
        tracker.openReply();
        const firstTurnFiles = tracker.getTurnFiles();

        tracker.openReply(true);
        const continuedFiles = tracker.getTurnFiles();
        tracker.openReply();

        expect(continuedFiles).toBe(firstTurnFiles);
        expect(tracker.getTurnFiles()).not.toBe(firstTurnFiles);
      });
    });

    describe("getReplyId()", () => {
      it("returns null until a reply opens and again after the reply closes", async () => {
        const { tracker } = setup();
        expect(tracker.getReplyId()).toBeNull();

        const { outcome } = runningTurn(tracker, "p1", "t1");
        expect(tracker.getReplyId()).not.toBeNull();
        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });
        await outcome;

        expect(tracker.getReplyId()).toBeNull();
      });
    });

    describe("getReplyStartedAtMs()", () => {
      it("returns the start time the open reply was dated from", () => {
        const { tracker } = setup();

        tracker.openReply(false, 1_000);

        expect(tracker.getReplyStartedAtMs()).toBe(1_000);
      });
    });

    describe("getTurnFiles()", () => {
      it("returns the capture the closing reply hands to captureFileChanges with the turn's diff, then a fresh one", async () => {
        const { deps, tracker } = setup();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        const turnFiles = tracker.getTurnFiles();
        const turnDiff = { root: "/vault", unifiedDiff: "" };
        deps.captureFileChanges.mockResolvedValueOnce(true);

        tracker.endTurn({ turnId: "t1", stopReason: "end_turn", turnDiff });
        await outcome;

        expect(deps.captureFileChanges).toHaveBeenCalledWith(turnFiles, replyId, turnDiff);
        expect(tracker.getTurnFiles()).not.toBe(turnFiles);
      });
    });

    describe("getQueuedPrompts()", () => {
      it("returns the same empty list whenever nothing is queued", () => {
        const { tracker } = setup();
        const before = tracker.getQueuedPrompts();
        tracker.startSend();
        void tracker.queue(ALSO, false, async () => () => TEXT);

        tracker.withdrawPrompts([ALSO.id]);

        expect(before).toEqual([]);
        expect(tracker.getQueuedPrompts()).toBe(before);
      });
    });

    describe("isSending()", () => {
      it("reports sending only from the send until the send ends, not while a turn the agent started is open", () => {
        const { tracker } = setup();
        const { signal } = tracker.startSend();
        expect(tracker.isSending()).toBe(true);

        tracker.endSend(signal);
        tracker.startTurn("background-report");

        expect(tracker.isSending()).toBe(false);
      });
    });

    describe("isMainTurnRunning()", () => {
      it("reports running from the send until the send ends, and while a turn is open", () => {
        const { tracker } = setup();
        expect(tracker.isMainTurnRunning()).toBe(false);

        const { turnSend } = runningTurn(tracker, "p1", "t1");
        turnSend.pushed();
        tracker.endSend(turnSend.signal);
        expect(tracker.isMainTurnRunning()).toBe(true);
        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });

        expect(tracker.isMainTurnRunning()).toBe(false);
      });
    });

    describe("hasLastTurnFailed()", () => {
      it("reports a failure from a failed reply until the next send starts", () => {
        const { tracker } = setup();
        tracker.openReply();

        tracker.failReply(new Error("rate limited"));
        expect(tracker.hasLastTurnFailed()).toBe(true);
        tracker.startSend();

        expect(tracker.hasLastTurnFailed()).toBe(false);
      });
    });

    describe("isStopping()", () => {
      it("reports stopping from Stop until both the stopped send and the stopped turn are over", () => {
        const { tracker } = setup();
        const { turnSend } = runningTurn(tracker, "p1", "t1");

        tracker.stop(false);
        expect(tracker.isStopping()).toBe(true);
        tracker.endTurn({ turnId: "t1", stopReason: "cancelled" });
        expect(tracker.isStopping()).toBe(true);
        tracker.endSend(turnSend.signal);

        expect(tracker.isStopping()).toBe(false);
      });
    });

    describe("startSend()", () => {
      it("marks the main turn running, clears the previous turn's failure and notifies the status", () => {
        const { deps, tracker } = setup();
        tracker.failReply(new Error("earlier failure"));
        deps.notifyStatus.mockClear();

        const turnSend = tracker.startSend();

        expect(turnSend.signal.aborted).toBe(false);
        expect(tracker.isMainTurnRunning()).toBe(true);
        expect(tracker.hasLastTurnFailed()).toBe(false);
        expect(deps.notifyStatus).toHaveBeenCalledTimes(1);
      });

      it("makes a prompt queued after it wait until this send reaches the backend", async () => {
        const { deps, tracker } = setup();
        const order: string[] = [];
        tracker.openReply();
        const turnSend = tracker.startSend();
        const accept = deferred();
        deps.prompt.mockReturnValueOnce(accept.promise);
        void tracker.submit({ promptId: "p1", prompt: TEXT }, true, () => {
          order.push("p1 reached the backend");
          turnSend.pushed();
        });

        void tracker.queue(ALSO, false, async () => {
          order.push("q1 prepared");
          return () => TEXT;
        });
        accept.resolve();
        await deps.whenSent(ALSO.id);

        expect(order).toEqual(["p1 reached the backend", "q1 prepared"]);
      });
    });

    describe("endSend()", () => {
      it("marks the main turn idle and notifies the status when no turn is open", () => {
        const { deps, tracker } = setup();
        const { signal } = tracker.startSend();
        deps.notifyStatus.mockClear();

        tracker.endSend(signal);

        expect(tracker.isMainTurnRunning()).toBe(false);
        expect(deps.notifyStatus).toHaveBeenCalledTimes(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 leaves a later send running when an earlier send ends late", () => {
        const { tracker } = setup();
        const earlier = tracker.startSend();
        const later = tracker.startSend();

        tracker.endSend(earlier.signal);
        expect(tracker.isSending()).toBe(true);
        tracker.endSend(later.signal);

        expect(tracker.isSending()).toBe(false);
      });
    });

    describe("submit()", () => {
      it("hands the prompt to the backend and resolves with the outcome of the turn that answers it", async () => {
        const { deps, tracker } = setup();
        const onPushed = jest.fn();
        tracker.openReply();
        tracker.startSend();
        const outcome = tracker.submit({ promptId: "p1", prompt: TEXT }, true, onPushed);
        tracker.deliverPrompt("p1");
        tracker.startTurn("t1");

        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });

        await expect(outcome).resolves.toMatchObject({ stopReason: "end_turn" });
        expect(deps.sentPrompts).toEqual([{ promptId: "p1", prompt: TEXT }]);
        expect(onPushed).toHaveBeenCalled();
      });

      it("rejects with the backend's error when the backend refuses the prompt", async () => {
        const { deps, tracker } = setup();
        const onPushed = jest.fn();
        deps.prompt.mockRejectedValueOnce(new Error("agent exited"));
        tracker.openReply();
        tracker.startSend();

        const outcome = tracker.submit({ promptId: "p1", prompt: TEXT }, true, onPushed);

        await expect(outcome).rejects.toThrow("agent exited");
        expect(onPushed).toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 resolves as cancelled when Stop lands before the backend accepts the prompt", async () => {
        const { deps, tracker } = setup();
        deps.prompt.mockReturnValueOnce(new Promise(() => undefined));
        tracker.openReply();
        tracker.startSend();
        const outcome = tracker.submit({ promptId: "p1", prompt: TEXT }, true);

        tracker.stop(false);

        await expect(outcome).resolves.toEqual({ stopReason: "cancelled" });
      });

      it("resolves as cancelled and ends the Stop drain when the backend fails a prompt that Stop already settled", async () => {
        const { deps, tracker } = setup();
        const accept = deferred();
        deps.prompt.mockReturnValueOnce(accept.promise);
        tracker.openReply();
        tracker.startSend();
        const outcome = tracker.submit({ promptId: "p1", prompt: TEXT }, true);
        tracker.stop(false);

        accept.reject(new Error("closed"));

        await expect(outcome).resolves.toEqual({ stopReason: "cancelled" });
        expect(tracker.whenStoppedTurnEnds(new AbortController().signal)).toBeNull();
      });
    });

    describe("queue()", () => {
      it("lists the prompt as queued until the agent takes it mid-turn, then resolves with that turn's outcome", async () => {
        const { deps, tracker } = setup();
        runningTurn(tracker, "p1", "t1");

        const turn = tracker.queue(ALSO, false, async () => () => TEXT);
        expect(tracker.getQueuedPrompts()).toEqual([ALSO]);
        expect(deps.notifyQueuedPrompts).toHaveBeenCalledTimes(1);
        await deps.whenSent(ALSO.id);
        tracker.deliverPrompt(ALSO.id);
        expect(tracker.getQueuedPrompts()).toEqual([]);
        deps.store.appendAgentText(tracker.getReplyId()!, "done");
        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });

        await expect(turn).resolves.toBe("end_turn");
      });

      it("prepares and sends queued prompts one at a time in the order they were queued", async () => {
        const { deps, tracker } = setup();
        const events: string[] = [];
        const firstPrepared = deferred<() => PromptContent[]>();
        const recordSent = deps.prompt.getMockImplementation()!;
        deps.prompt.mockImplementation(async (input) => {
          events.push(`${input.promptId} sent`);
          return recordSent(input);
        });
        tracker.startSend().pushed();

        void tracker.queue(ALSO, false, () => {
          events.push("q1 preparing");
          return firstPrepared.promise;
        });
        void tracker.queue(LATER, false, async () => {
          events.push("q2 preparing");
          return () => TEXT;
        });
        firstPrepared.resolve(() => TEXT);
        await deps.whenSent(LATER.id);

        expect(events).toEqual(["q1 preparing", "q1 sent", "q2 preparing", "q2 sent"]);
      });

      it("asks the backend to interrupt only when the prompt was queued to interrupt", async () => {
        const { deps, tracker } = setup();
        tracker.startSend().pushed();

        void tracker.queue(ALSO, true, async () => () => TEXT);
        void tracker.queue(LATER, false, async () => () => TEXT);
        await deps.whenSent(LATER.id);

        expect(deps.sentPrompts).toEqual([
          { promptId: ALSO.id, prompt: TEXT, interrupt: true },
          { promptId: LATER.id, prompt: TEXT },
        ]);
      });

      it("resolves as cancelled and never builds or sends a prompt withdrawn while it was being prepared", async () => {
        const { deps, tracker } = setup();
        const prepared = deferred<() => PromptContent[]>();
        const build = jest.fn(() => TEXT);
        tracker.startSend().pushed();
        const turn = tracker.queue(ALSO, false, () => prepared.promise);

        tracker.withdrawPrompts([ALSO.id]);
        prepared.resolve(build);

        await expect(turn).resolves.toBe("cancelled");
        expect(build).not.toHaveBeenCalled();
        expect(deps.prompt).not.toHaveBeenCalled();
      });

      it("returns a prompt the backend refuses to the composer, tells the user, and rejects", async () => {
        const { deps, tracker } = setup();
        jest.mocked(Notice).mockClear();
        deps.prompt.mockRejectedValueOnce(new Error("not accepting messages"));
        tracker.startSend().pushed();

        const turn = tracker.queue(ALSO, false, async () => () => TEXT);

        await expect(turn).rejects.toThrow("not accepting messages");
        expect(tracker.takeWithdrawnPrompts()).toEqual([ALSO]);
        expect(Notice).toHaveBeenCalledWith("Failed to send message. Please try again.");
      });

      it("rejects with the error of the turn that answered the prompt", async () => {
        const { deps, tracker } = setup();
        runningTurn(tracker, "p1", "t1");
        const turn = tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);
        tracker.deliverPrompt(ALSO.id);

        tracker.endTurn({ turnId: "t1", stopReason: "end_turn", error: new Error("overloaded") });

        await expect(turn).rejects.toThrow("overloaded");
      });
    });

    describe("withdrawQueued()", () => {
      it("withdraws a prompt that has not reached the backend without asking the backend", async () => {
        const { tracker } = setup();
        const turnSend = tracker.startSend();
        const turn = tracker.queue(ALSO, false, async () => () => TEXT);
        const withdrawSent = jest.fn(async () => true);

        await tracker.withdrawQueued(ALSO.id, withdrawSent);
        turnSend.pushed();

        expect(withdrawSent).not.toHaveBeenCalled();
        expect(tracker.takeWithdrawnPrompts()).toEqual([ALSO]);
        await expect(turn).resolves.toBe("cancelled");
      });

      it("leaves a sent prompt queued until the backend reports it withdrawn", async () => {
        const { deps, tracker } = setup();
        runningTurn(tracker, "p1", "t1");
        void tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);
        const withdrawSent = jest.fn(async () => true);

        await tracker.withdrawQueued(ALSO.id, withdrawSent);

        expect(withdrawSent).toHaveBeenCalledTimes(1);
        expect(tracker.getQueuedPrompts()).toEqual([ALSO]);
      });

      it("shows a sent prompt as delivered when the backend says the agent already took it", async () => {
        const { deps, tracker } = setup();
        const { replyId } = runningTurn(tracker, "p1", "t1");
        deps.store.appendAgentText(replyId, "working");
        void tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);

        await tracker.withdrawQueued(ALSO.id, async () => false);

        expect(tracker.getQueuedPrompts()).toEqual([]);
        expect(transcript(deps.store)).toEqual([
          [AI_SENDER, "working", "end_turn"],
          [USER_SENDER, ALSO.text, null],
          [AI_SENDER, "", null],
        ]);
      });

      it("ignores a prompt that is no longer queued", async () => {
        const { tracker } = setup();
        const withdrawSent = jest.fn(async () => true);

        await tracker.withdrawQueued("gone", withdrawSent);

        expect(withdrawSent).not.toHaveBeenCalled();
        expect(tracker.takeWithdrawnPrompts()).toEqual([]);
      });
    });

    describe("takeWithdrawnPrompts()", () => {
      it("returns the withdrawn prompts once and then the same empty list", () => {
        const { tracker } = setup();
        tracker.startSend();
        void tracker.queue(ALSO, false, async () => () => TEXT);
        tracker.withdrawPrompts([ALSO.id]);

        const first = tracker.takeWithdrawnPrompts();
        const second = tracker.takeWithdrawnPrompts();

        expect(first).toEqual([ALSO]);
        expect(second).toEqual([]);
        expect(tracker.takeWithdrawnPrompts()).toBe(second);
      });
    });

    describe("refuse()", () => {
      it("closes the open reply as a refusal that shows the message", () => {
        const { deps, tracker } = setup();
        tracker.openReply();
        tracker.startSend();

        const outcome = tracker.refuse("This chat's model isn't enabled.");

        expect(outcome).toEqual({ stopReason: "refusal" });
        expect(transcript(deps.store)).toEqual([
          [AI_SENDER, "**Error:** This chat's model isn't enabled.", "refusal"],
        ]);
        expect(tracker.getReplyId()).toBeNull();
      });
    });

    describe("releaseReply()", () => {
      it("forgets the open reply only when it is the given reply", () => {
        const { tracker } = setup();
        const replyId = tracker.openReply();

        tracker.releaseReply("another-reply");
        expect(tracker.getReplyId()).toBe(replyId);
        tracker.releaseReply(replyId);

        expect(tracker.getReplyId()).toBeNull();
      });
    });

    describe("stop()", () => {
      it("closes the reply as cancelled, resolves the sent prompt as cancelled and drops the stopped turn's later output", async () => {
        const { deps, tracker } = setup();
        const { outcome } = runningTurn(tracker, "p1", "t1");
        deps.store.appendAgentText(tracker.resolveContentTarget("m1")!, "partial");

        tracker.stop(false);

        await expect(outcome).resolves.toEqual({ stopReason: "cancelled" });
        expect(transcript(deps.store)).toEqual([[AI_SENDER, "partial", "cancelled"]]);
        expect(tracker.getReplyId()).toBeNull();
        expect(tracker.resolveContentTarget("m1")).toBeNull();
        expect(tracker.resolveContentTarget(undefined)).toBeNull();
        expect(deps.endLaunches).toHaveBeenCalledWith("stopped");
      });

      it("aborts a send that has not reached the backend and closes its reply without waiting for a turn", async () => {
        const { deps, tracker } = setup();
        tracker.openReply();
        const turnSend = tracker.startSend();
        const replyClosed = deps.nextMessagesChange();

        tracker.stop(false);
        await replyClosed;

        expect(turnSend.signal.aborted).toBe(true);
        expect(transcript(deps.store)).toEqual([[AI_SENDER, "", "cancelled"]]);
        expect(tracker.whenStoppedTurnEnds(new AbortController().signal)).toBeNull();
      });

      it("withdraws queued prompts that have not reached the backend when the backend can withdraw", () => {
        const { tracker } = setup();
        tracker.openReply();
        tracker.startSend();
        void tracker.queue(ALSO, false, async () => () => TEXT);

        tracker.stop(true);

        expect(tracker.getQueuedPrompts()).toEqual([]);
        expect(tracker.takeWithdrawnPrompts()).toEqual([ALSO]);
      });

      it("keeps queued prompts for the agent to run next when the backend cannot withdraw", () => {
        const { tracker } = setup();
        tracker.openReply();
        tracker.startSend();
        void tracker.queue(ALSO, false, async () => () => TEXT);

        tracker.stop(false);

        expect(tracker.getQueuedPrompts()).toEqual([ALSO]);
        expect(tracker.takeWithdrawnPrompts()).toEqual([]);
      });

      it("cancels the reply's unfinished tool calls but leaves started background tasks running", async () => {
        const { deps, tracker } = setup();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        addToolCall(deps.store, replyId, "tc-read", "in_progress");
        addToolCall(deps.store, replyId, "tc-background", "in_progress");
        deps.runningTaskToolCallIds.mockReturnValue(new Set(["tc-background"]));

        tracker.stop(false);
        await outcome;

        expect(toolStatuses(deps.store, replyId)).toEqual({
          "tc-read": "cancelled",
          "tc-background": "in_progress",
        });
      });
    });

    describe("whenStoppedTurnEnds()", () => {
      it("returns null when no stopped turn is draining", () => {
        const { tracker } = setup();

        expect(tracker.whenStoppedTurnEnds(new AbortController().signal)).toBeNull();
      });

      it("makes a send after Stop wait until the stopped turn ends", async () => {
        const { deps, tracker } = setup();
        const { turnSend } = runningTurn(tracker, "p1", "t1");
        tracker.stop(false);
        turnSend.pushed();
        tracker.endSend(turnSend.signal);
        tracker.openReply();
        const nextSend = tracker.startSend();

        const stoppedTurnEnded = tracker.whenStoppedTurnEnds(nextSend.signal);
        expect(stoppedTurnEnded).not.toBeNull();
        tracker.endTurn({ turnId: "t1", stopReason: "cancelled" });
        await stoppedTurnEnded;

        expect(tracker.whenStoppedTurnEnds(nextSend.signal)).toBeNull();
        expect(transcript(deps.store)).toEqual([
          [AI_SENDER, "", "cancelled"],
          [AI_SENDER, "", null],
        ]);
      });

      it("stops waiting when the waiting send is stopped too", async () => {
        const { tracker } = setup();
        const { turnSend } = runningTurn(tracker, "p1", "t1");
        tracker.stop(false);
        turnSend.pushed();
        tracker.endSend(turnSend.signal);
        tracker.openReply();
        const nextSend = tracker.startSend();
        const stoppedTurnEnded = tracker.whenStoppedTurnEnds(nextSend.signal);

        tracker.stop(false);
        await stoppedTurnEnded;

        expect(nextSend.signal.aborted).toBe(true);
      });
    });

    describe("dispose()", () => {
      it("resolves every prompt still waiting for its turn as cancelled and empties the queue without notifying", async () => {
        const { deps, tracker } = setup();
        const { outcome } = runningTurn(tracker, "p1", "t1");
        const queued = tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);
        deps.notifyQueuedPrompts.mockClear();

        tracker.dispose();

        await expect(outcome).resolves.toEqual({ stopReason: "cancelled" });
        await expect(queued).resolves.toBe("cancelled");
        expect(tracker.getQueuedPrompts()).toEqual([]);
        expect(deps.notifyQueuedPrompts).not.toHaveBeenCalled();
        expect(tracker.isMainTurnRunning()).toBe(true);
      });

      it("releases a send waiting on a stopped turn", async () => {
        const { tracker } = setup();
        const { turnSend } = runningTurn(tracker, "p1", "t1");
        tracker.stop(false);
        tracker.endSend(turnSend.signal);
        const nextSend = tracker.startSend();
        const stoppedTurnEnded = tracker.whenStoppedTurnEnds(nextSend.signal);

        tracker.dispose();
        await stoppedTurnEnded;

        expect(nextSend.signal.aborted).toBe(false);
        expect(tracker.whenStoppedTurnEnds(nextSend.signal)).toBeNull();
      });
    });

    describe("startTurn()", () => {
      it("opens a reply dated from the reported start for a turn the agent starts on its own", () => {
        const { deps, tracker } = setup();

        tracker.startTurn("background-report", 5_000);

        expect(transcript(deps.store)).toEqual([[AI_SENDER, "", null]]);
        expect(tracker.getReplyStartedAtMs()).toBe(5_000);
        expect(tracker.isMainTurnRunning()).toBe(true);
        expect(deps.notifyStatus).toHaveBeenCalled();
      });

      it("renders a turn that starts before the sent prompt is delivered into the reply opened at send", () => {
        const { deps, tracker } = setup();
        send(tracker, "p1");
        const replyAtSend = tracker.getReplyId();

        tracker.startTurn("background-report");

        expect(tracker.getReplyId()).toBe(replyAtSend);
        expect(tracker.resolveContentTarget("background-message")).toBe(replyAtSend);
        expect(transcript(deps.store)).toHaveLength(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 lets go of a stopped send so the turn of a message kept through Stop shows its output", () => {
        const { tracker } = setup();
        tracker.openReply();
        tracker.startSend();
        tracker.stop(false);
        expect(tracker.isStopping()).toBe(true);

        tracker.startTurn("t2");

        expect(tracker.isStopping()).toBe(false);
        expect(tracker.isSending()).toBe(false);
        expect(tracker.resolveContentTarget("m2")).toBe(tracker.getReplyId());
      });

      it("ignores a turn that starts while a stopped prompt's turn is still awaited", () => {
        const { deps, tracker } = setup();
        const { turnSend } = send(tracker, "p1");
        tracker.stop(false);
        tracker.endSend(turnSend.signal);

        tracker.startTurn("t1");

        expect(tracker.isMainTurnRunning()).toBe(false);
        expect(tracker.getReplyId()).toBeNull();
        expect(transcript(deps.store)).toHaveLength(1);
      });
    });

    describe("deliverPrompt()", () => {
      it("closes a reply that has activity and shows the delivered prompt before a new reply", async () => {
        const { deps, tracker } = setup();
        const { replyId } = runningTurn(tracker, "p1", "t1");
        deps.store.appendAgentText(replyId, "working");
        void tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);

        tracker.deliverPrompt(ALSO.id);

        expect(transcript(deps.store)).toEqual([
          [AI_SENDER, "working", "end_turn"],
          [USER_SENDER, ALSO.text, null],
          [AI_SENDER, "", null],
        ]);
        expect(tracker.getReplyId()).not.toBe(replyId);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 shows no empty-turn error when the agent adds nothing after the delivered prompt, since its earlier work is shown", async () => {
        const { deps, tracker } = setup();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        deps.store.appendAgentText(replyId, "Alpha: about A.");
        void tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);
        tracker.deliverPrompt(ALSO.id);
        const replyAfterPrompt = tracker.getReplyId()!;

        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });
        await outcome;

        expect(deps.store.getMessage(replyAfterPrompt)?.isErrorMessage).toBeUndefined();
      });

      it("replaces an empty reply with the delivered prompt", async () => {
        const { deps, tracker } = setup();
        runningTurn(tracker, "p1", "t1");
        void tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);

        tracker.deliverPrompt(ALSO.id);

        expect(transcript(deps.store)).toEqual([
          [USER_SENDER, ALSO.text, null],
          [AI_SENDER, "", null],
        ]);
      });

      it("keeps the turn's file capture in the reply that continues after the delivered prompt", async () => {
        const { deps, tracker } = setup();
        runningTurn(tracker, "p1", "t1");
        const turnFiles = tracker.getTurnFiles();
        void tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);

        tracker.deliverPrompt(ALSO.id);

        expect(tracker.getTurnFiles()).toBe(turnFiles);
      });

      it("shows a prompt delivered between turns without opening a reply", async () => {
        const { deps, tracker } = setup();
        const { outcome } = runningTurn(tracker, "p1", "t1");
        void tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);
        deps.store.appendAgentText(tracker.getReplyId()!, "done");
        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });
        await outcome;

        tracker.deliverPrompt(ALSO.id);

        expect(transcript(deps.store)).toEqual([
          [AI_SENDER, "done", "end_turn"],
          [USER_SENDER, ALSO.text, null],
        ]);
        expect(tracker.getReplyId()).toBeNull();
      });
    });

    describe("withdrawPrompts()", () => {
      it("returns withdrawn queued prompts to the composer, reports them withdrawn and resolves their sends as cancelled", async () => {
        const { deps, tracker } = setup();
        runningTurn(tracker, "p1", "t1");
        const turn = tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);

        tracker.withdrawPrompts([ALSO.id]);

        await expect(turn).resolves.toBe("cancelled");
        expect(tracker.getQueuedPrompts()).toEqual([]);
        expect(tracker.takeWithdrawnPrompts()).toEqual([ALSO]);
        expect(deps.promptsWithdrawn).toHaveBeenCalledWith([ALSO]);
      });

      it("ends the wait for a stopped prompt that the agent never took", () => {
        const { tracker } = setup();
        send(tracker, "p1");
        tracker.stop(false);

        tracker.withdrawPrompts(["p1"]);

        expect(tracker.whenStoppedTurnEnds(new AbortController().signal)).toBeNull();
      });
    });

    describe("disconnect()", () => {
      it("fails the open reply with the connection error and withdraws every sent prompt", async () => {
        const { deps, tracker } = setup();
        const { outcome } = runningTurn(tracker, "p1", "t1");
        void tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);

        tracker.disconnect(new Error("Claude exited"));

        await expect(outcome).resolves.toEqual({ stopReason: "cancelled" });
        expect(transcript(deps.store)).toEqual([[AI_SENDER, "**Error:** Claude exited", null]]);
        expect(tracker.takeWithdrawnPrompts()).toEqual([ALSO]);
        expect(tracker.hasLastTurnFailed()).toBe(true);
      });

      it("opens a reply to show the error for a sent prompt whose turn never started", async () => {
        const { deps, tracker } = setup();
        const { outcome } = runningTurn(tracker, "p1", "t1");
        void tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);
        deps.store.appendAgentText(tracker.getReplyId()!, "done");
        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });
        await outcome;

        tracker.disconnect(new Error("Claude exited"));

        expect(transcript(deps.store)).toEqual([
          [AI_SENDER, "done", "end_turn"],
          [AI_SENDER, "**Error:** Claude exited", null],
        ]);
      });

      it("ends the wait for a stopped turn so the next send goes ahead", () => {
        const { tracker } = setup();
        runningTurn(tracker, "p1", "t1");
        tracker.stop(false);

        tracker.disconnect(new Error("Claude exited"));

        expect(tracker.whenStoppedTurnEnds(new AbortController().signal)).toBeNull();
      });

      it("leaves the transcript alone when no reply is open and nothing was sent", () => {
        const { deps, tracker } = setup();

        tracker.disconnect(new Error("Claude exited"));

        expect(transcript(deps.store)).toEqual([]);
        expect(tracker.hasLastTurnFailed()).toBe(false);
      });
    });

    describe("endTurn()", () => {
      it("closes the reply with the turn's stop reason and resolves every delivered prompt", async () => {
        const { deps, tracker } = setup();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        deps.store.appendAgentText(replyId, "hello");

        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });

        await expect(outcome).resolves.toMatchObject({ stopReason: "end_turn" });
        expect(transcript(deps.store)).toEqual([[AI_SENDER, "hello", "end_turn"]]);
        expect(deps.endLaunches).toHaveBeenCalledWith("failed");
        expect(deps.onTurnCompleted).toHaveBeenCalledTimes(1);
      });

      it("keeps a prompt the agent has not taken waiting for the turn that answers it", async () => {
        const { deps, tracker } = setup();
        const { outcome } = runningTurn(tracker, "p1", "t1");
        const queued = tracker.queue(ALSO, false, async () => () => TEXT);
        await deps.whenSent(ALSO.id);
        deps.store.appendAgentText(tracker.getReplyId()!, "first answer");
        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });
        await outcome;

        tracker.startTurn("t2");
        tracker.deliverPrompt(ALSO.id);
        deps.store.appendAgentText(tracker.getReplyId()!, "second answer");
        tracker.endTurn({ turnId: "t2", stopReason: "end_turn" });

        await expect(queued).resolves.toBe("end_turn");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 keeps the reply open and fails its pending tool calls when a prompt that continues at the output limit is cut off", async () => {
        const { deps, tracker } = setup();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        addToolCall(deps.store, replyId, "tc-write", "pending");

        tracker.endTurn({ turnId: "t1", stopReason: "max_tokens" });

        await expect(outcome).resolves.toMatchObject({ stopReason: "max_tokens" });
        expect(tracker.getReplyId()).toBe(replyId);
        expect(toolStatuses(deps.store, replyId)).toEqual({ "tc-write": "failed" });
        expect(deps.store.getMessage(replyId)?.turnStopReason).toBeUndefined();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/739 closes the same reply at the output limit when the continuation is cut off too", async () => {
        const { deps, tracker } = setup();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        deps.store.appendAgentText(replyId, "part one");
        tracker.endTurn({ turnId: "t1", stopReason: "max_tokens" });
        await outcome;

        const continuation = tracker.submit({ promptId: "continue", prompt: TEXT }, false);
        tracker.deliverPrompt("continue");
        tracker.startTurn("t2");
        deps.store.appendAgentText(replyId, " part two");
        tracker.endTurn({ turnId: "t2", stopReason: "max_tokens" });

        await expect(continuation).resolves.toMatchObject({ stopReason: "max_tokens" });
        expect(transcript(deps.store)).toEqual([[AI_SENDER, "part one part two", "max_tokens"]]);
      });

      it("shows an empty-turn error on a reply with no assistant activity", async () => {
        const { deps, tracker } = setup();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");

        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });
        await outcome;

        expect(deps.store.getMessage(replyId)?.isErrorMessage).toBe(true);
        expect(deps.store.getMessage(replyId)?.message).toContain(
          "claude finished the turn without returning any assistant text or tool activity"
        );
      });

      it("does not show an empty-turn error when the turn only updated an earlier reply's tool call", async () => {
        const { deps, tracker } = setup();
        const earlierReply = tracker.openReply();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        tracker.resolveToolTarget(earlierReply);

        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });
        await outcome;

        expect(deps.store.getMessage(replyId)?.isErrorMessage).toBeUndefined();
      });

      it("fails the reply with the turn's error and resolves the delivered prompt with it", async () => {
        const { deps, tracker } = setup();
        const { outcome } = runningTurn(tracker, "p1", "t1");
        const error = new Error("overloaded");

        tracker.endTurn({ turnId: "t1", stopReason: "end_turn", error });

        await expect(outcome).resolves.toMatchObject({ error });
        expect(transcript(deps.store)).toEqual([[AI_SENDER, "**Error:** overloaded", null]]);
        expect(tracker.hasLastTurnFailed()).toBe(true);
        expect(deps.onTurnCompleted).not.toHaveBeenCalled();
      });

      it("ignores the end of a turn that is not running", () => {
        const { tracker } = setup();
        const { replyId } = runningTurn(tracker, "p1", "t1");

        tracker.endTurn({ turnId: "stale", stopReason: "end_turn" });

        expect(tracker.getReplyId()).toBe(replyId);
        expect(tracker.isMainTurnRunning()).toBe(true);
      });

      it("ends the wait for the stopped turn without closing the reply opened after Stop", () => {
        const { tracker } = setup();
        const { turnSend } = runningTurn(tracker, "p1", "t1");
        tracker.stop(false);
        tracker.endSend(turnSend.signal);
        const nextReply = tracker.openReply();

        tracker.endTurn({ turnId: "t1", stopReason: "cancelled" });

        expect(tracker.getReplyId()).toBe(nextReply);
        expect(tracker.whenStoppedTurnEnds(new AbortController().signal)).toBeNull();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 still closes the reply when its file changes cannot be captured", async () => {
        const { deps, tracker } = setup();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        deps.store.appendAgentText(replyId, "edited");
        deps.captureFileChanges.mockRejectedValueOnce(new Error("malformed diff"));

        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });

        await expect(outcome).resolves.toMatchObject({ stopReason: "end_turn" });
        expect(transcript(deps.store)).toEqual([[AI_SENDER, "edited", "end_turn"]]);
      });
    });

    describe("failReply()", () => {
      it("shows the failure on the open reply, fails its pending tool calls and reports the last turn as failed", () => {
        const { deps, tracker } = setup();
        const replyId = tracker.openReply();
        addToolCall(deps.store, replyId, "tc-read", "pending");

        tracker.failReply(new Error("rate limited"));

        expect(transcript(deps.store)).toEqual([[AI_SENDER, "**Error:** rate limited", null]]);
        expect(toolStatuses(deps.store, replyId)).toEqual({ "tc-read": "failed" });
        expect(deps.endLaunches).toHaveBeenCalledWith("failed");
        expect(tracker.getReplyId()).toBeNull();
        expect(tracker.hasLastTurnFailed()).toBe(true);
      });

      it("opens a reply to show the failure when none is open", () => {
        const { deps, tracker } = setup();

        tracker.failReply(new Error("rate limited"));

        expect(transcript(deps.store)).toEqual([[AI_SENDER, "**Error:** rate limited", null]]);
      });
    });

    describe("resolveContentTarget()", () => {
      it("routes content to the open reply", () => {
        const { tracker } = setup();
        const replyId = tracker.openReply();

        expect(tracker.resolveContentTarget("m1")).toBe(replyId);
        expect(tracker.resolveContentTarget(undefined)).toBe(replyId);
      });

      it("routes late content of a settled turn's message to that turn's reply", async () => {
        const { deps, tracker } = setup();
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        deps.store.appendAgentText(tracker.resolveContentTarget("m1")!, "first");
        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });
        await outcome;

        const nextReply = tracker.openReply();

        expect(tracker.resolveContentTarget("m1")).toBe(replyId);
        expect(tracker.resolveContentTarget("m2")).toBe(nextReply);
      });

      it("drops content while a Stop is in progress and later content of a message Stop cut off", () => {
        const { tracker } = setup();
        const { turnSend } = runningTurn(tracker, "p1", "t1");
        tracker.resolveContentTarget("m1");
        tracker.stop(false);
        expect(tracker.resolveContentTarget("m2")).toBeNull();
        tracker.endTurn({ turnId: "t1", stopReason: "cancelled" });
        turnSend.pushed();
        tracker.endSend(turnSend.signal);

        const nextReply = tracker.openReply();

        expect(tracker.resolveContentTarget("m1")).toBeNull();
        expect(tracker.resolveContentTarget("m2")).toBe(nextReply);
      });

      it("returns null when no reply is open", () => {
        const { tracker } = setup();

        expect(tracker.resolveContentTarget("m1")).toBeNull();
      });
    });

    describe("dropStoppedContent()", () => {
      it("drops later content of a message that arrived while stopping", () => {
        const { tracker } = setup();
        const { turnSend } = runningTurn(tracker, "p1", "t1");
        tracker.stop(false);

        tracker.dropStoppedContent("m-late");
        tracker.endTurn({ turnId: "t1", stopReason: "cancelled" });
        tracker.endSend(turnSend.signal);
        const nextReply = tracker.openReply();

        expect(tracker.resolveContentTarget("m-late")).toBeNull();
        expect(tracker.resolveContentTarget("m-next")).toBe(nextReply);
      });
    });

    describe("extendSettledTurn()", () => {
      it("extends a settled reply's duration to cover its late content and leaves other replies alone", async () => {
        const { deps, tracker } = setup();
        const now = jest.spyOn(Date, "now").mockReturnValue(1_000);
        const { outcome, replyId } = runningTurn(tracker, "p1", "t1");
        deps.store.appendAgentText(tracker.resolveContentTarget("m1")!, "answer");
        now.mockReturnValue(3_000);
        tracker.endTurn({ turnId: "t1", stopReason: "end_turn" });
        await outcome;
        const nextReply = tracker.openReply();
        now.mockReturnValue(9_000);

        tracker.extendSettledTurn(replyId);
        tracker.extendSettledTurn(nextReply);

        expect(deps.store.getMessage(replyId)?.turnDurationMs).toBe(8_000);
        expect(deps.store.getMessage(nextReply)?.turnDurationMs).toBeUndefined();
      });
    });

    describe("resolveToolTarget()", () => {
      it("routes an update to the earlier reply that owns the tool call", () => {
        const { tracker } = setup();
        const earlierReply = tracker.openReply();
        tracker.openReply();

        expect(tracker.resolveToolTarget(earlierReply)).toBe(earlierReply);
      });

      it("routes an update without an earlier owner to the open reply", () => {
        const { tracker } = setup();
        const replyId = tracker.openReply();

        expect(tracker.resolveToolTarget(undefined)).toBe(replyId);
      });

      it("returns null without an earlier owner or an open reply", () => {
        const { tracker } = setup();

        expect(tracker.resolveToolTarget(undefined)).toBeNull();
      });
    });
  });
});
