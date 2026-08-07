import {
  AgentTurnDurationIndicator,
  formatWorkedDuration,
} from "@/agentMode/ui/AgentTurnDurationIndicator";
import { act, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentTurnDurationIndicator", () => {
  describe("formatWorkedDuration()", () => {
    it("keeps seconds while omitting leading zero-valued units", () => {
      expect(formatWorkedDuration(0)).toBe("0s");
      expect(formatWorkedDuration(18_999)).toBe("18s");
      expect(formatWorkedDuration(138_000)).toBe("2m 18s");
      expect(formatWorkedDuration(3_738_000)).toBe("1h 2m 18s");
    });

    it("clamps invalid and negative durations to zero", () => {
      expect(formatWorkedDuration(-1_000)).toBe("0s");
      expect(formatWorkedDuration(Number.NaN)).toBe("0s");
      expect(formatWorkedDuration(Number.POSITIVE_INFINITY)).toBe("0s");
    });
  });

  describe("AgentTurnDurationIndicator()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(200_000);
    });

    afterEach(() => jest.useRealTimers());

    it("shows the animated icon and advances while the turn is running", () => {
      const { container } = render(
        <AgentTurnDurationIndicator status="running" startedAtMs={62_000} />
      );

      expect(screen.getByRole("status").textContent).toBe("Agent is working");
      const duration = screen.getByText("2m 18s");
      expect(duration.closest('[aria-hidden="true"]')).toBeNull();
      expect(container.querySelector(".copilot-spinner")).toBeTruthy();
      expect(container.querySelector(".copilot-spinner-dot-0")).toBeTruthy();

      act(() => jest.advanceTimersByTime(2_000));

      expect(screen.getByText("2m 20s")).toBeTruthy();
    });

    it("registers and clears the ticker on the mounted element's window", () => {
      const setInterval = jest.fn(() => 42);
      const clearInterval = jest.fn();
      const popoutWindow = { setInterval, clearInterval } as unknown as Window;
      const winSpy = jest.spyOn(Node.prototype, "win", "get").mockReturnValue(popoutWindow);

      try {
        const { unmount } = render(
          <AgentTurnDurationIndicator status="running" startedAtMs={62_000} />
        );

        expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
        unmount();
        expect(clearInterval).toHaveBeenCalledWith(42);
      } finally {
        winSpy.mockRestore();
      }
    });

    it("freezes the duration and keeps a static icon after completion", () => {
      const { container } = render(
        <AgentTurnDurationIndicator status="complete" durationMs={138_000} />
      );

      expect(screen.getByText("2m 18s").parentElement?.textContent).toContain("Worked for 2m 18s");
      expect(
        screen.getByText("Worked for").parentElement?.parentElement?.classList.contains("tw-pl-1")
      ).toBe(true);
      expect(container.querySelector(".copilot-spinner")).toBeTruthy();
      expect(container.querySelector(".copilot-spinner-dot-0")).toBeNull();
      expect(
        container
          .querySelector(".copilot-spinner")
          ?.parentElement?.classList.contains("tw-absolute")
      ).toBe(true);
      expect(screen.queryByRole("status")).toBeNull();

      act(() => jest.advanceTimersByTime(60_000));

      expect(screen.getByText("2m 18s")).toBeTruthy();
    });
  });
});
