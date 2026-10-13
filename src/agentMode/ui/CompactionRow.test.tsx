import { CompactionRow } from "@/agentMode/ui/CompactionRow";
import type { AgentMessagePart } from "@/agentMode/session/types";
import { act, render, screen } from "@testing-library/react";
import React from "react";

type CompactionPart = Extract<AgentMessagePart, { kind: "compaction" }>;

const part = (overrides: Partial<CompactionPart> = {}): CompactionPart => ({
  kind: "compaction",
  id: "c1",
  status: "completed",
  trigger: "manual",
  startedAtMs: 200_000,
  ...overrides,
});

describe("CompactionRow", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(212_000);
  });

  afterEach(() => jest.useRealTimers());

  describe("CompactionRow()", () => {
    it("announces a running manual compaction with a shimmering label and the seconds elapsed so far", () => {
      const { container } = render(<CompactionRow part={part({ status: "in_progress" })} />);

      expect(screen.getByRole("status").textContent).toBe("Compacting conversation");
      expect(screen.getByText("Compacting conversation…").className).toContain(
        "copilot-shimmer-text"
      );
      expect(screen.getByText("12s")).toBeTruthy();
      expect(container.querySelector(".copilot-spinner-dot-0")).toBeTruthy();

      act(() => jest.advanceTimersByTime(3_000));

      expect(screen.getByText("15s")).toBeTruthy();
    });

    it("words a running automatic compaction as the context being full", () => {
      render(<CompactionRow part={part({ status: "in_progress", trigger: "auto" })} />);

      expect(screen.getByText("Context is full, compacting…")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe("Context is full, compacting");
    });

    it("settles a completed compaction into a quiet divider without a status announcement", () => {
      const { container } = render(<CompactionRow part={part()} />);

      expect(screen.getByText("Context compacted")).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
      expect(container.querySelector(".copilot-spinner")).toBeNull();
    });

    it("shows how far a completed compaction shrank the context when both token counts are known", () => {
      render(<CompactionRow part={part({ preTokens: 182_340, postTokens: 24_100 })} />);

      expect(screen.getByText("Context compacted · 182k → 24k tokens")).toBeTruthy();
    });

    it("omits the token counts when the backend reported only one of them", () => {
      render(<CompactionRow part={part({ preTokens: 182_340 })} />);

      expect(screen.getByText("Context compacted")).toBeTruthy();
    });

    it("says an automatic completed compaction happened automatically", () => {
      render(
        <CompactionRow part={part({ trigger: "auto", preTokens: 90_000, postTokens: 8_000 })} />
      );

      expect(screen.getByText("Context compacted automatically · 90k → 8k tokens")).toBeTruthy();
    });

    it("shows a failed compaction with its error and a warning icon", () => {
      const { container } = render(
        <CompactionRow part={part({ status: "failed", error: "Summary request overloaded" })} />
      );

      expect(screen.getByText("Couldn't compact: Summary request overloaded")).toBeTruthy();
      expect(
        container.querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle")
      ).toBeTruthy();
    });

    it("shows a failed compaction without a reason as a bare failure", () => {
      render(<CompactionRow part={part({ status: "failed" })} />);

      expect(screen.getByText("Couldn't compact")).toBeTruthy();
    });

    it("shows a cancelled compaction as muted text", () => {
      render(<CompactionRow part={part({ status: "cancelled" })} />);

      expect(screen.getByText("Compaction cancelled")).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("shows a skipped compaction as muted text", () => {
      render(<CompactionRow part={part({ status: "skipped" })} />);

      expect(screen.getByText("Nothing to compact yet")).toBeTruthy();
    });
  });
});
