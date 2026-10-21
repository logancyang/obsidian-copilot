import type { MiyoNote } from "@/miyo/agentMode/miyoSearchRun";
import { MiyoSearchCard, type MiyoSearchCardProps } from "@/miyo/agentMode/ui/MiyoSearchCard";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const SHIMMER = ".copilot-shimmer-text";
const SPARKLE = ".lucide-sparkle";
const ACCENT_BORDER = "interactive-accent";
const ISSUE_750 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/750";

const notes = (count: number): MiyoNote[] =>
  Array.from({ length: count }, (_, i) => ({ path: `notes/Note ${i + 1}.md` }));

function renderCard(props: Partial<MiyoSearchCardProps> & Pick<MiyoSearchCardProps, "status">) {
  const onToggle = jest.fn();
  const onOpenNote = jest.fn();
  const result = render(
    <MiyoSearchCard
      query="q"
      notes={null}
      open={false}
      onToggle={onToggle}
      onOpenNote={onOpenNote}
      {...props}
    />
  );
  return { ...result, onToggle, onOpenNote };
}

describe("MiyoSearchCard", () => {
  describe("MiyoSearchCard()", () => {
    it("shows the Miyo logo, the query actually sent and the note count for a completed search", () => {
      const { container } = renderCard({
        status: "completed",
        query: "back pain standing desk",
        notes: notes(4),
      });

      expect(screen.getByText("Searched with Miyo")).toBeTruthy();
      expect(screen.getByText("“back pain standing desk”")).toBeTruthy();
      expect(screen.getByText("4 notes")).toBeTruthy();
      expect(container.querySelector("svg path")).toBeTruthy();
      expect(container.querySelector(SHIMMER)).toBeNull();
    });

    it("says a stopped search stopped, without a note count or shimmer (https://github.com/Brevilabs/obsidian-copilot-private/issues/747)", () => {
      const { container } = renderCard({ status: "cancelled", notes: notes(3) });

      expect(screen.getByText("Miyo search stopped")).toBeTruthy();
      expect(screen.queryByText(/note/)).toBeNull();
      expect(container.querySelector(SHIMMER)).toBeNull();
    });

    it("uses the singular for one note", () => {
      renderCard({ status: "completed", query: "q", notes: notes(1) });
      expect(screen.getByText("1 note")).toBeTruthy();
    });

    it("shimmers the label with no count while the search is running", () => {
      const { container } = renderCard({
        status: "in_progress",
        query: "tariff code",
        notes: null,
      });

      expect(container.querySelector(SHIMMER)?.textContent).toBe("Searching with Miyo");
      expect(screen.getByText("“tariff code”")).toBeTruthy();
      expect(screen.queryByText(/note/)).toBeNull();
    });

    it("stops the label shimmer for reduced motion", () => {
      const { container } = renderCard({ status: "pending", query: "q", notes: null });

      expect(container.querySelector(SHIMMER)?.className).toContain(
        "motion-reduce:tw-animate-none"
      );
    });

    it.each(["pending", "in_progress", "completed", "failed"] as const)(
      "draws the logo in the normal text color with no animation when the status is %s",
      (status) => {
        const { container } = renderCard({ status, query: "q", notes: null });
        const logo = container.querySelector("svg")!;

        expect(logo.getAttribute("class")).toContain("tw-text-normal");
        expect(logo.getAttribute("class")).not.toContain("animate");
      }
    );

    it.each(["pending", "in_progress", "completed"] as const)(
      "tints the border with the accent when the status is %s",
      (status) => {
        const { container } = renderCard({ status, query: "q", notes: notes(2) });
        const card = container.firstElementChild!;

        expect(card.className).toContain(ACCENT_BORDER);
        expect(card.className).toContain("tw-border-solid");
      }
    );

    it("uses a plain border when the search failed", () => {
      const { container } = renderCard({ status: "failed", query: "q", notes: null });
      const card = container.firstElementChild!;

      expect(card.className).toContain("tw-border-border");
      expect(card.className).not.toContain(ACCENT_BORDER);
    });

    it.each(["pending", "in_progress", "completed", "failed"] as const)(
      "draws no star after the logo, label and query when the status is %s",
      (status) => {
        const { container } = renderCard({ status, query: "q", notes: notes(3) });

        expect(container.querySelector(SPARKLE)).toBeNull();
        expect(container.querySelectorAll("svg:not(.lucide-chevron-right)")).toHaveLength(1);
      }
    );

    it("keeps the count at full size and clips a long query so the count stays visible", () => {
      const query = "what did I decide about the migration plan for the shared calendar service";
      renderCard({ status: "completed", query, notes: notes(12) });

      expect(screen.getByText("12 notes").className).toContain("tw-shrink-0");
      expect(screen.getByText(`“${query}”`).className).toContain("tw-truncate");
      expect(screen.getByText("Searched with Miyo").parentElement?.className).toContain(
        "tw-overflow-hidden"
      );
      expect(screen.getByText("12 notes").previousElementSibling?.textContent).toContain(query);
    });

    it("says No notes when Miyo returned nothing", () => {
      renderCard({ status: "completed", query: "offsite agenda", notes: notes(0) });
      expect(screen.getByText("No notes")).toBeTruthy();
    });

    it("shows the error state without a shimmer or count when the search failed", () => {
      const { container } = renderCard({ status: "failed", query: "desk", notes: null });

      expect(screen.getByText("Miyo search failed").className).toContain("tw-text-error");
      expect(container.querySelector(SHIMMER)).toBeNull();
    });

    it("shows the error text under the failed label (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)", () => {
      renderCard({
        status: "failed",
        query: "desk",
        notes: null,
        error: "Miyo search failed. Details: net::ERR_CONNECTION_REFUSED",
      });

      expect(
        screen.getByText("Miyo search failed. Details: net::ERR_CONNECTION_REFUSED")
      ).toBeTruthy();
      expect(screen.getByText("“desk”")).toBeTruthy();
    });

    it("shows no error line when a failed search carried no error text", () => {
      const { container } = renderCard({
        status: "failed",
        query: "desk",
        notes: null,
        error: null,
      });
      expect(container.firstElementChild?.firstElementChild?.children).toHaveLength(2);
    });

    it("omits the count when the backend gave no parsable output", () => {
      renderCard({ status: "completed", query: "desk", notes: null });

      expect(screen.getByText("Searched with Miyo")).toBeTruthy();
      expect(screen.queryByText(/note/)).toBeNull();
    });

    it("omits the query text when the command carried none", () => {
      renderCard({ status: "completed", query: null, notes: notes(2) });
      expect(screen.queryByText(/“/)).toBeNull();
    });
    it(`folds a completed search's notes behind a toggle that reports it is collapsed (${ISSUE_750})`, () => {
      const { onToggle } = renderCard({ status: "completed", notes: notes(2) });
      const header = screen.getByRole("button", { name: /Searched with Miyo/ });

      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("Note 1")).toBeNull();

      fireEvent.click(header);
      fireEvent.keyDown(header, { key: "Enter" });
      expect(onToggle).toHaveBeenCalledTimes(2);
    });

    it(`lists each found note by name and folder in a scroll box about four rows tall when open (${ISSUE_750})`, () => {
      renderCard({
        status: "completed",
        notes: [{ path: "Projects/Desk/Standing desk setup.md" }, { path: "Reading list.md" }],
        open: true,
      });

      expect(
        screen.getByRole("button", { name: /Searched with Miyo/ }).getAttribute("aria-expanded")
      ).toBe("true");
      expect(screen.getByText("Standing desk setup")).toBeTruthy();
      expect(screen.getByText("Projects/Desk").className).toContain("tw-text-muted");
      expect(screen.getByText("Reading list")).toBeTruthy();
      const list = screen.getByRole("list");
      expect(list.className).toContain("tw-max-h-28");
      expect(list.className).toContain("tw-overflow-y-auto");
    });

    it(`opens a vault note by its vault path when its row is clicked (${ISSUE_750})`, () => {
      const { onOpenNote, onToggle } = renderCard({
        status: "completed",
        notes: [{ path: "Projects/Standing desk setup.md" }],
        open: true,
      });

      fireEvent.click(screen.getByRole("button", { name: /Standing desk setup/ }));

      expect(onOpenNote).toHaveBeenCalledWith("Projects/Standing desk setup.md");
      expect(onToggle).not.toHaveBeenCalled();
    });

    it(`lists a note from another Miyo folder with that folder but offers no way to open it (${ISSUE_750})`, () => {
      const { onOpenNote } = renderCard({
        status: "completed",
        notes: [{ folder: "Reading Notes", path: "Research/Sleep.md" }],
        open: true,
      });

      fireEvent.click(screen.getByText("Sleep"));

      expect(screen.getByText("Reading Notes/Research")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Sleep/ })).toBeNull();
      expect(onOpenNote).not.toHaveBeenCalled();
    });

    it.each([
      ["running", { status: "in_progress", notes: null }],
      ["failed", { status: "failed", notes: null, error: "net::ERR_CONNECTION_REFUSED" }],
      ["empty", { status: "completed", notes: [] }],
      ["unreadable", { status: "completed", notes: null }],
    ] as const)(
      `offers no toggle or list for a %s search even when asked to open (${ISSUE_750})`,
      (_name, props) => {
        renderCard({ ...props, open: true });

        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByRole("list")).toBeNull();
      }
    );
  });
});
