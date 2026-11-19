import { useDayLabels } from "@/hooks/useDayLabels";
import type { ChatMessage } from "@/types/message";
import { act, renderHook } from "@testing-library/react";

type DayMessage = Pick<ChatMessage, "timestamp" | "isVisible">;

function sentAt(date: Date, isVisible = true): DayMessage {
  return { isVisible, timestamp: { epoch: date.getTime(), display: "", fileName: "" } };
}

describe("useDayLabels", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 18, 15, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("useDayLabels()", () => {
    it("labels the first visible message of each day by its index and gives no label to a chat that began today", () => {
      const yesterday = sentAt(new Date(2026, 10, 17, 9, 0));
      const today = sentAt(new Date(2026, 10, 18, 10, 0));

      const { result: older } = renderHook(() =>
        useDayLabels([yesterday, sentAt(new Date(2026, 10, 17, 9, 5)), today])
      );
      const { result: fresh } = renderHook(() => useDayLabels([today]));

      expect([...older.current]).toEqual([
        [0, "Yesterday"],
        [2, "Today"],
      ]);
      expect(fresh.current.size).toBe(0);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 skips hidden messages and messages without a time, so they neither get a label nor start a day", () => {
      const { result } = renderHook(() =>
        useDayLabels([
          sentAt(new Date(2026, 10, 15, 9, 0), false),
          { isVisible: true, timestamp: null },
          sentAt(new Date(2026, 10, 17, 9, 0)),
          sentAt(new Date(2026, 10, 16, 9, 0), false),
          sentAt(new Date(2026, 10, 17, 9, 5)),
        ])
      );

      expect([...result.current]).toEqual([[2, "Yesterday"]]);
    });

    it("recomputes the labels when the messages change", () => {
      const first = [sentAt(new Date(2026, 10, 17, 9, 0))];
      const { result, rerender } = renderHook(({ messages }) => useDayLabels(messages), {
        initialProps: { messages: first },
      });

      rerender({ messages: [...first, sentAt(new Date(2026, 10, 18, 14, 0))] });

      expect([...result.current]).toEqual([
        [0, "Yesterday"],
        [1, "Today"],
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 relabels within a minute of midnight while mounted, and stops checking once unmounted", () => {
      jest.setSystemTime(new Date(2026, 10, 18, 23, 59, 30));
      const { result, unmount } = renderHook(() =>
        useDayLabels([sentAt(new Date(2026, 10, 18, 23, 50))])
      );
      expect(result.current.size).toBe(0);

      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect([...result.current]).toEqual([[0, "Yesterday"]]);

      expect(jest.getTimerCount()).toBe(1);
      unmount();
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
