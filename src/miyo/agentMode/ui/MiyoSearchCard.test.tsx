import { MiyoSearchCard } from "@/miyo/agentMode/ui/MiyoSearchCard";
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
      "tints the border with the accent when the status is %s",
      (status) => {
        const { container } = render(<MiyoSearchCard status={status} query="q" noteCount={2} />);
        const card = container.firstElementChild!;

        expect(card.className).toContain(ACCENT_BORDER);
        expect(card.className).toContain("tw-border-solid");
      }
    );

    it("uses a plain border when the search failed", () => {
      const { container } = render(<MiyoSearchCard status="failed" query="q" noteCount={null} />);
      const card = container.firstElementChild!;

      expect(card.className).toContain("tw-border-border");
      expect(card.className).not.toContain(ACCENT_BORDER);
    });

    it.each(["pending", "in_progress", "completed", "failed"] as const)(
      "draws no star after the logo, label and query when the status is %s",
      (status) => {
        const { container } = render(<MiyoSearchCard status={status} query="q" noteCount={3} />);

        expect(container.querySelector(SPARKLE)).toBeNull();
        expect(container.querySelectorAll("svg")).toHaveLength(1);
      }
    );

    it("keeps the count at full size and clips a long query so the count stays visible", () => {
      const query = "what did I decide about the migration plan for the shared calendar service";
      const { container } = render(
        <MiyoSearchCard status="completed" query={query} noteCount={12} />
      );

      expect(screen.getByText("12 notes").className).toContain("tw-shrink-0");
      expect(screen.getByText(`“${query}”`).className).toContain("tw-truncate");
      expect(screen.getByText("Searched with Miyo").parentElement?.className).toContain(
        "tw-overflow-hidden"
      );
      expect(container.firstElementChild?.lastElementChild?.textContent).toBe("12 notes");
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

    it("shows the error text under the failed label (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)", () => {
      render(
        <MiyoSearchCard
          status="failed"
          query="desk"
          noteCount={null}
          error="Miyo search failed. Details: net::ERR_CONNECTION_REFUSED"
        />
      );

      expect(
        screen.getByText("Miyo search failed. Details: net::ERR_CONNECTION_REFUSED")
      ).toBeTruthy();
      expect(screen.getByText("“desk”")).toBeTruthy();
    });

    it("shows no error line when a failed search carried no error text", () => {
      const { container } = render(
        <MiyoSearchCard status="failed" query="desk" noteCount={null} error={null} />
      );
      expect(container.firstElementChild?.children).toHaveLength(2);
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
