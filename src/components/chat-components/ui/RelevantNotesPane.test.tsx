import { RelevantNotesPane, type RelevantNotesPaneProps } from "./RelevantNotesPane";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const BASE_ACTIONS: RelevantNotesPaneProps["actions"] = {
  miyoDownloadUrl: "https://www.miyo.md/",
  onOpenMiyoSettings: jest.fn(),
  onRefresh: jest.fn(),
  reviewIndexing: {
    destination: "miyo",
    onSelect: jest.fn(),
  },
};

const BASE_PROPS: RelevantNotesPaneProps = {
  status: "matches",
  noteRows: [<div key="related">Related note</div>],
  actions: BASE_ACTIONS,
};

describe("RelevantNotesPane", () => {
  describe("RelevantNotesPane()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("shows neutral loading feedback while the Miyo request is pending (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(<RelevantNotesPane {...BASE_PROPS} status="loading" noteRows={[]} />);

      expect(screen.getByText("Finding relevant notes…")).toBeTruthy();
      expect(screen.queryByText("Miyo is not connected")).toBeNull();
      expect(screen.queryByText("No relevant notes found")).toBeNull();
    });

    it("renders Miyo matches without setup guidance (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(<RelevantNotesPane {...BASE_PROPS} />);

      expect(screen.getByText("Related note")).toBeTruthy();
      expect(screen.queryByText(/Miyo/)).toBeNull();
    });

    it("shows download guidance without rows when Miyo is disabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const { container } = render(
        <RelevantNotesPane {...BASE_PROPS} status="disabled" noteRows={[]} />
      );

      expect(screen.queryByText("Related note")).toBeNull();
      expect(screen.getByText("Add semantic matches with Miyo")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Download Miyo" }).getAttribute("href")).toBe(
        "https://www.miyo.md/"
      );
      fireEvent.click(screen.getByRole("button", { name: "Set up in Copilot" }));
      expect(BASE_ACTIONS.onOpenMiyoSettings).toHaveBeenCalledTimes(1);
      expect(container.querySelector("[data-miyo-guidance]")?.className).toContain("tw-max-w-xs");
    });

    it("shows unavailable guidance and opens Copilot's Miyo tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const { container } = render(
        <RelevantNotesPane {...BASE_PROPS} status="unavailable" noteRows={[]} />
      );

      expect(screen.queryByText("Related note")).toBeNull();
      expect(screen.getByText("Miyo is not connected")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Open Miyo settings" }));
      expect(BASE_ACTIONS.onOpenMiyoSettings).toHaveBeenCalledTimes(1);
      expect(container.querySelector("[data-miyo-guidance]")?.className).toContain("tw-max-w-xs");
    });

    it("shows a centered no-matches card without result rows or setup actions (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const { container } = render(<RelevantNotesPane {...BASE_PROPS} status="no-matches" />);

      expect(screen.getByText("No semantic matches yet")).toBeTruthy();
      expect(screen.queryByText("Related note")).toBeNull();
      expect(screen.queryByRole("button", { name: "Open Miyo settings" })).toBeNull();
      expect(container.querySelector("[data-miyo-guidance]")?.className).toContain("tw-max-w-xs");
    });

    it("shows local indexing guidance without result rows and delegates its actions (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const { container } = render(<RelevantNotesPane {...BASE_PROPS} status="not-indexed" />);

      expect(screen.getByText("This note isn't indexed in Miyo")).toBeTruthy();
      expect(
        screen.getByText(
          "It may still be indexing or be excluded from Miyo. Open Miyo to review this folder's indexing and exclusion settings."
        )
      ).toBeTruthy();
      expect(screen.queryByText("Related note")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open Miyo" }));
      expect(BASE_ACTIONS.reviewIndexing.onSelect).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      expect(BASE_ACTIONS.onRefresh).toHaveBeenCalledTimes(1);
      expect(container.querySelector("[data-miyo-guidance]")?.className).toContain("tw-max-w-xs");
    });

    it("shows connection-review copy for an unindexed remote source (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(
        <RelevantNotesPane
          {...BASE_PROPS}
          status="not-indexed"
          actions={{
            ...BASE_ACTIONS,
            reviewIndexing: { ...BASE_ACTIONS.reviewIndexing, destination: "settings" },
          }}
        />
      );

      expect(screen.queryByRole("button", { name: "Open Miyo" })).toBeNull();
      expect(
        screen.getByText(
          "It may still be indexing or be excluded from Miyo. Review the configured Miyo connection or server in Copilot."
        )
      ).toBeTruthy();
      expect(screen.queryByText("Related note")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Review Miyo connection" }));
      expect(BASE_ACTIONS.reviewIndexing.onSelect).toHaveBeenCalledTimes(1);
    });

    it("renders the neutral empty state when no source note is active (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(<RelevantNotesPane {...BASE_PROPS} status="idle" noteRows={[]} />);

      expect(screen.getByText("No relevant notes found")).toBeTruthy();
    });
  });
});
