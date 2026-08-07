import { useThinkingClock } from "@/agentMode/ui/useThinkingClock";
import { act, renderHook } from "@testing-library/react";

describe("useThinkingClock", () => {
  describe("useThinkingClock()", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("measures the reasoning span and freezes it the moment reasoning stops", () => {
      const { result, rerender } = renderHook(({ active }) => useThinkingClock(active), {
        initialProps: { active: true },
      });

      expect(result.current).toBe(0);

      act(() => jest.advanceTimersByTime(4_000));
      expect(result.current).toBe(4_000);

      rerender({ active: false });
      expect(result.current).toBe(4_000);

      // The turn is over: no interval is left running and the value stands.
      act(() => jest.advanceTimersByTime(60_000));
      expect(result.current).toBe(4_000);
    });

    it("adds each further reasoning span to the time already banked", () => {
      const { result, rerender } = renderHook(({ active }) => useThinkingClock(active), {
        initialProps: { active: true },
      });

      act(() => jest.advanceTimersByTime(3_000));
      rerender({ active: false });

      // A tool call runs in between; that time is not thinking time.
      act(() => jest.advanceTimersByTime(10_000));
      rerender({ active: true });
      act(() => jest.advanceTimersByTime(2_000));

      expect(result.current).toBe(5_000);
    });

    it("keeps the measurement across re-renders that change nothing", () => {
      const { result, rerender } = renderHook(({ active }) => useThinkingClock(active), {
        initialProps: { active: true },
      });

      act(() => jest.advanceTimersByTime(7_000));
      rerender({ active: true });
      rerender({ active: true });

      expect(result.current).toBe(7_000);
    });

    it("stays at zero for a group that never reasons", () => {
      const { result } = renderHook(() => useThinkingClock(false));

      act(() => jest.advanceTimersByTime(30_000));

      expect(result.current).toBe(0);
    });
  });
});
