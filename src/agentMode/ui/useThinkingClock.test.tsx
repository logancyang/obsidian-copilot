import { useThinkingClock } from "@/agentMode/ui/useThinkingClock";
import { act, renderHook } from "@testing-library/react";

describe("useThinkingClock", () => {
  describe("useThinkingClock()", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("uses the thought event timestamp instead of mount time (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      jest.setSystemTime(10_000);
      const { result } = renderHook(() => useThinkingClock(true, 2_000));

      expect(result.current).toBe(8_000);

      act(() => jest.advanceTimersByTime(4_000));
      expect(result.current).toBe(12_000);
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

    it("returns zero once the active span ends because completed time lives on the thought", () => {
      const { result, rerender } = renderHook(({ active }) => useThinkingClock(active, 1_000), {
        initialProps: { active: true },
      });

      act(() => jest.advanceTimersByTime(3_000));
      expect(result.current).toBeGreaterThanOrEqual(3_000);

      rerender({ active: false });
      expect(result.current).toBe(0);

      act(() => jest.advanceTimersByTime(30_000));
      expect(result.current).toBe(0);
    });
  });
});
