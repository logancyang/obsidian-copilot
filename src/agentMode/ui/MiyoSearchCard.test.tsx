import { MiyoSearchCard } from "@/agentMode/ui/MiyoSearchCard";
import { render, screen } from "@testing-library/react";
import React from "react";

const SHIMMER = ".copilot-shimmer-text";
const SPARKLE = ".lucide-sparkle";
const ACCENT_BORDER = "interactive-accent";

describe("MiyoSearchCard", () => {
  describe("MiyoSearchCard()", () => {
    it("shows the Miyo logo, the query actually sent and the note count for a completed search", () => {
      const { container } = render(
        <MiyoSearchCard status="completed" query="back pain standing desk" noteCount={4} />
      );

      expect(screen.getByText("Searched with Miyo")).toBeTruthy();
      expect(screen.getByText("“back pain standing desk”")).toBeTruthy();
      expect(screen.getByText("4 notes")).toBeTruthy();
      expect(container.querySelector("svg path")).toBeTruthy();
      expect(container.querySelector(SHIMMER)).toBeNull();
    });

    it("uses the singular for one note", () => {
      render(<MiyoSearchCard status="completed" query="q" noteCount={1} />);
      expect(screen.getByText("1 note")).toBeTruthy();
    });

    it("shimmers the label with no count while the search is running", () => {
      const { container } = render(
        <MiyoSearchCard status="in_progress" query="tariff code" noteCount={null} />
      );

      expect(container.querySelector(SHIMMER)?.textContent).toBe("Searching with Miyo");
      expect(screen.getByText("“tariff code”")).toBeTruthy();
      expect(screen.queryByText(/note/)).toBeNull();
    });

    it("stops the label shimmer for reduced motion", () => {
      const { container } = render(<MiyoSearchCard status="pending" query="q" noteCount={null} />);

      expect(container.querySelector(SHIMMER)?.className).toContain(
        "motion-reduce:tw-animate-none"
      );
    });

    it.each(["pending", "in_progress", "completed", "failed"] as const)(
      "draws the logo in the normal text color with no animation when the status is %s",
      (status) => {
        const { container } = render(<MiyoSearchCard status={status} query="q" noteCount={null} />);
        const logo = container.querySelector("svg")!;

        expect(logo.getAttribute("class")).toContain("tw-text-normal");
        expect(logo.getAttribute("class")).not.toContain("animate");
      }
    );

    it.each(["pending", "in_progress", "completed"] as const)(
      "tints the border with the accent and ends the row with a sparkle when the status is %s",
      (status) => {
        const { container } = render(<MiyoSearchCard status={status} query="q" noteCount={2} />);
        const card = container.firstElementChild!;

        expect(card.className).toContain(ACCENT_BORDER);
        expect(card.className).toContain("tw-border-solid");
        expect(card.lastElementChild?.matches(SPARKLE)).toBe(true);
        expect(card.lastElementChild?.getAttribute("aria-hidden")).toBe("true");
      }
    );

    it("keeps the sparkle after the count for an empty result", () => {
      const { container } = render(<MiyoSearchCard status="completed" query="q" noteCount={0} />);
      const card = container.firstElementChild!;

      expect(card.lastElementChild?.matches(SPARKLE)).toBe(true);
      expect(card.lastElementChild?.previousElementSibling?.textContent).toBe("No notes");
    });

    it("twinkles the sparkle only while the search is running and only when motion is allowed", () => {
      const running = render(<MiyoSearchCard status="in_progress" query="q" noteCount={null} />);
      expect(running.container.querySelector(SPARKLE)?.getAttribute("class")).toContain(
        "motion-safe:tw-animate-twinkle"
      );
      running.unmount();

      const done = render(<MiyoSearchCard status="completed" query="q" noteCount={1} />);
      expect(done.container.querySelector(SPARKLE)?.getAttribute("class")).not.toContain("animate");
    });

    it("uses a plain border and no sparkle when the search failed", () => {
      const { container } = render(<MiyoSearchCard status="failed" query="q" noteCount={null} />);
      const card = container.firstElementChild!;

      expect(card.className).toContain("tw-border-border");
      expect(card.className).not.toContain(ACCENT_BORDER);
      expect(container.querySelector(SPARKLE)).toBeNull();
    });

    it("says No notes when Miyo returned nothing", () => {
      render(<MiyoSearchCard status="completed" query="offsite agenda" noteCount={0} />);
      expect(screen.getByText("No notes")).toBeTruthy();
    });

    it("shows the error state without a shimmer or count when the search failed", () => {
      const { container } = render(
        <MiyoSearchCard status="failed" query="desk" noteCount={null} />
      );

      expect(screen.getByText("Miyo search failed").className).toContain("tw-text-error");
      expect(container.querySelector(SHIMMER)).toBeNull();
    });

    it("omits the count when the backend gave no parsable output", () => {
      render(<MiyoSearchCard status="completed" query="desk" noteCount={null} />);

      expect(screen.getByText("Searched with Miyo")).toBeTruthy();
      expect(screen.queryByText(/note/)).toBeNull();
    });

    it("omits the query text when the command carried none", () => {
      render(<MiyoSearchCard status="completed" query={null} noteCount={2} />);
      expect(screen.queryByText(/“/)).toBeNull();
    });
  });
});
