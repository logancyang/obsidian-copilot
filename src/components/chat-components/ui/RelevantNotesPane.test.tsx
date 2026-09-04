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
          "It may still be indexing or be excluded from Miyo. Update Miyo to the latest version to see why."
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
          "It may still be indexing or be excluded from Miyo. Update Miyo to the latest version to see why."
        )
      ).toBeTruthy();
      expect(screen.queryByText("Related note")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Review Miyo connection" }));
      expect(BASE_ACTIONS.reviewIndexing.onSelect).toHaveBeenCalledTimes(1);
    });

    it.each([
      { status: "no-text" as const, title: "Miyo found no text in this note" },
      { status: "indexing" as const, title: "Miyo is still indexing this note" },
    ])(
      "shows $status guidance without rows and refreshes on request (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)",
      ({ status, title }) => {
        render(<RelevantNotesPane {...BASE_PROPS} status={status} />);

        expect(screen.getByText(title)).toBeTruthy();
        expect(screen.queryByText("Related note")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
        expect(BASE_ACTIONS.onRefresh).toHaveBeenCalledTimes(1);
      }
    );

    it("shows Miyo's file error without rows and opens the local folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(
        <RelevantNotesPane
          {...BASE_PROPS}
          status="index-error"
          details={{ errorMessage: "Markdown parser failed" }}
        />
      );

      expect(screen.getByText("Miyo couldn't index this note")).toBeTruthy();
      expect(screen.getByText("Markdown parser failed")).toBeTruthy();
      expect(screen.queryByText("Related note")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open Miyo" }));
      expect(BASE_ACTIONS.reviewIndexing.onSelect).toHaveBeenCalledTimes(1);
    });

    it("keeps remote index errors actionable without claiming it can open the host folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(
        <RelevantNotesPane
          {...BASE_PROPS}
          status="index-error"
          details={{ errorMessage: "Markdown parser failed" }}
          actions={{
            ...BASE_ACTIONS,
            reviewIndexing: { ...BASE_ACTIONS.reviewIndexing, destination: "settings" },
          }}
        />
      );

      expect(
        screen.getByText("Markdown parser failed Review the folder in Miyo on the host machine.")
      ).toBeTruthy();
      expect(screen.queryByText("Related note")).toBeNull();
      expect(screen.queryByRole("button", { name: "Open Miyo" })).toBeNull();
    });

    it.each([
      ["exclude_folder" as const, "notes/private", "Excluded by folder notes/private."],
      ["exclude_pattern" as const, "**/journal/**", "Excluded by pattern **/journal/**."],
      ["include_folder" as const, "work", "Not included by folder work."],
      ["include_pattern" as const, "projects/**", "Not included by pattern projects/**."],
      ["extension" as const, undefined, "This file type isn't included in Miyo's folder settings."],
      ["hidden" as const, undefined, "Miyo excludes hidden files."],
      [undefined, undefined, "Miyo's folder filters exclude this note."],
    ])(
      "explains the %s exclusion and exposes folder settings only on local desktop (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)",
      (exclusionReason, exclusionRule, expectedDescription) => {
        const { rerender } = render(
          <RelevantNotesPane
            {...BASE_PROPS}
            status="excluded"
            details={{ exclusionReason, exclusionRule }}
          />
        );

        expect(screen.getByText("This note is excluded in Miyo")).toBeTruthy();
        expect(screen.getByText(expectedDescription)).toBeTruthy();
        expect(screen.queryByText("Related note")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Open folder settings in Miyo" }));
        expect(BASE_ACTIONS.reviewIndexing.onSelect).toHaveBeenCalledTimes(1);

        rerender(
          <RelevantNotesPane
            {...BASE_PROPS}
            status="excluded"
            details={{ exclusionReason, exclusionRule }}
            actions={{
              ...BASE_ACTIONS,
              reviewIndexing: { ...BASE_ACTIONS.reviewIndexing, destination: "settings" },
            }}
          />
        );

        expect(
          screen.getByText(
            `${expectedDescription} Adjust this folder's filters in Miyo on the host machine.`
          )
        ).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Open folder settings in Miyo" })).toBeNull();
      }
    );

    it("renders the neutral empty state when no source note is active (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(<RelevantNotesPane {...BASE_PROPS} status="idle" noteRows={[]} />);

      expect(screen.getByText("No relevant notes found")).toBeTruthy();
    });
  });
});
