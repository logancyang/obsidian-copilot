import {
  AgentMemoryScheduler,
  isConsolidationStaleAtLoad,
} from "@/agentMode/session/agentMemoryScheduler";

describe("agentMemoryScheduler", () => {
  describe("AgentMemoryScheduler", () => {
    const FLUSH_MS = 1000;
    const CONSOLIDATE_MS = 5000;

    let flushChat: jest.Mock<void, [string]>;
    let consolidate: jest.Mock<void, []>;
    let scheduler: AgentMemoryScheduler;

    beforeEach(() => {
      jest.useFakeTimers();
      flushChat = jest.fn();
      consolidate = jest.fn();
      scheduler = new AgentMemoryScheduler(
        { flushChat, consolidate },
        { flushIdleMs: FLUSH_MS, consolidationIdleMs: CONSOLIDATE_MS }
      );
    });

    afterEach(() => {
      scheduler.dispose();
      jest.useRealTimers();
    });

    describe("noteTurnEnded()", () => {
      it("flushes the chat once it has sat idle for the whole window (CUSTOM_AGENTS.md §5)", () => {
        scheduler.noteTurnEnded("chat-a");

        jest.advanceTimersByTime(FLUSH_MS - 1);
        expect(flushChat).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(flushChat).toHaveBeenCalledWith("chat-a");
      });

      it("restarts the window when a second turn ends, so one exchange is not split", () => {
        scheduler.noteTurnEnded("chat-a");
        jest.advanceTimersByTime(FLUSH_MS - 1);
        scheduler.noteTurnStarted("chat-a");
        scheduler.noteTurnEnded("chat-a");
        jest.advanceTimersByTime(FLUSH_MS - 1);

        expect(flushChat).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(flushChat).toHaveBeenCalledTimes(1);
      });

      it("times each chat separately, so a busy chat does not hold back a quiet one", () => {
        scheduler.noteTurnEnded("chat-a");
        jest.advanceTimersByTime(FLUSH_MS / 2);
        scheduler.noteTurnEnded("chat-b");
        jest.advanceTimersByTime(FLUSH_MS / 2);

        expect(flushChat.mock.calls).toEqual([["chat-a"]]);
      });

      it("consolidates once every chat has been quiet for the longer window", () => {
        scheduler.noteTurnEnded("chat-a");

        jest.advanceTimersByTime(CONSOLIDATE_MS - 1);
        expect(consolidate).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(consolidate).toHaveBeenCalledTimes(1);
      });

      it("waits for the last chat to settle before starting the consolidation window", () => {
        scheduler.noteTurnStarted("chat-a");
        scheduler.noteTurnStarted("chat-b");
        scheduler.noteTurnEnded("chat-a");

        // `chat-b` is still running, so no window is open yet.
        jest.advanceTimersByTime(CONSOLIDATE_MS);
        expect(consolidate).not.toHaveBeenCalled();

        scheduler.noteTurnEnded("chat-b");
        jest.advanceTimersByTime(CONSOLIDATE_MS);
        expect(consolidate).toHaveBeenCalledTimes(1);
      });
    });

    describe("noteTurnStarted()", () => {
      it("cancels a pending flush, because the chat is in use again", () => {
        scheduler.noteTurnEnded("chat-a");
        scheduler.noteTurnStarted("chat-a");

        jest.advanceTimersByTime(FLUSH_MS * 2);

        expect(flushChat).not.toHaveBeenCalled();
      });

      it("cancels a pending consolidation, because the plugin is no longer idle", () => {
        scheduler.noteTurnEnded("chat-a");
        jest.advanceTimersByTime(CONSOLIDATE_MS - 1);
        scheduler.noteTurnStarted("chat-b");

        jest.advanceTimersByTime(CONSOLIDATE_MS * 2);

        expect(consolidate).not.toHaveBeenCalled();
      });
    });

    describe("cancelFlush()", () => {
      it("drops a pending flush when something else already ended the conversation", () => {
        scheduler.noteTurnEnded("chat-a");
        scheduler.cancelFlush("chat-a");

        jest.advanceTimersByTime(FLUSH_MS * 2);

        expect(flushChat).not.toHaveBeenCalled();
      });
    });

    describe("dispose()", () => {
      it("stops both timers, so nothing fires after the plugin unloads", () => {
        scheduler.noteTurnEnded("chat-a");
        scheduler.dispose();

        jest.advanceTimersByTime(CONSOLIDATE_MS * 2);

        expect(flushChat).not.toHaveBeenCalled();
        expect(consolidate).not.toHaveBeenCalled();
      });
    });
  });

  describe("isConsolidationStaleAtLoad()", () => {
    it("treats an agent that has never consolidated as stale", () => {
      expect(isConsolidationStaleAtLoad(null, "2026-09-17")).toBe(true);
    });

    it("leaves today's and yesterday's work alone, since the user may still be in it", () => {
      expect(isConsolidationStaleAtLoad("2026-09-17", "2026-09-17")).toBe(false);
      expect(isConsolidationStaleAtLoad("2026-09-16", "2026-09-17")).toBe(false);
    });

    it("catches up on a marker older than a day (CUSTOM_AGENTS.md §5)", () => {
      expect(isConsolidationStaleAtLoad("2026-09-15", "2026-09-17")).toBe(true);
    });

    it("steps the calendar across a month boundary rather than subtracting hours", () => {
      expect(isConsolidationStaleAtLoad("2026-08-31", "2026-09-01")).toBe(false);
      expect(isConsolidationStaleAtLoad("2026-08-30", "2026-09-01")).toBe(true);
    });
  });
});
