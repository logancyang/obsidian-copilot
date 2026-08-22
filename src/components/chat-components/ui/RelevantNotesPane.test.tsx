import { RelevantNotesPane, type RelevantNotesPaneProps } from "./RelevantNotesPane";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const BASE_PROPS: RelevantNotesPaneProps = {
  guidance: null,
  isPending: false,
  noteCount: 1,
  noteRows: <div>Related note</div>,
  miyoDownloadUrl: "https://www.miyo.md/",
  canOpenMiyoApp: true,
  onOpenMiyoApp: jest.fn(),
  onOpenMiyoSettings: jest.fn(),
};

describe("RelevantNotesPane", () => {
  describe("RelevantNotesPane()", () => {
    it("shows neutral loading feedback while the Miyo request is pending (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(
        <RelevantNotesPane
          {...BASE_PROPS}
          guidance="setup"
          isPending
          noteCount={0}
          noteRows={null}
        />
      );

      expect(screen.getByText("Finding relevant notes…")).toBeTruthy();
      expect(screen.queryByText("Check your Miyo setup")).toBeNull();
      expect(screen.queryByText("No relevant notes found")).toBeNull();
    });

    it("renders scored results without setup guidance", () => {
      render(<RelevantNotesPane {...BASE_PROPS} />);

      expect(screen.getByText("Related note")).toBeTruthy();
      expect(screen.queryByText(/Miyo/)).toBeNull();
    });

    it("shows download guidance without graph-only rows when Miyo is disabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const { container } = render(
        <RelevantNotesPane {...BASE_PROPS} guidance="download" noteCount={0} noteRows={null} />
      );

      expect(screen.queryByText("Related note")).toBeNull();
      expect(screen.getByText("Add semantic matches with Miyo")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Download Miyo" }).getAttribute("href")).toBe(
        "https://www.miyo.md/"
      );
      expect(container.querySelector("[data-miyo-guidance]")?.className).toContain("tw-max-w-xs");
    });

    it("shows empty setup guidance and opens Copilot's Miyo tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const onOpenMiyoSettings = jest.fn();
      const { container } = render(
        <RelevantNotesPane
          {...BASE_PROPS}
          guidance="unavailable"
          noteCount={0}
          noteRows={null}
          onOpenMiyoSettings={onOpenMiyoSettings}
        />
      );

      expect(screen.queryByText("Related note")).toBeNull();
      expect(screen.getByText("Check your Miyo setup")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Open Miyo" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open Miyo settings" }));
      expect(onOpenMiyoSettings).toHaveBeenCalledTimes(1);
      expect(container.querySelector("[data-miyo-guidance]")?.className).toContain("tw-max-w-xs");
    });

    it("shows a centered no-matches card without setup actions beside link rows (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const { container } = render(<RelevantNotesPane {...BASE_PROPS} guidance="no-matches" />);

      expect(screen.getByText("No semantic matches yet")).toBeTruthy();
      expect(screen.getByText("Related note")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Open Miyo settings" })).toBeNull();
      expect(container.querySelector("[data-miyo-guidance]")?.className).toContain("tw-max-w-xs");
    });

    it("shows a centered not-indexed card without setup actions beside link rows (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const onOpenMiyoApp = jest.fn();
      const { container } = render(
        <RelevantNotesPane {...BASE_PROPS} guidance="not-indexed" onOpenMiyoApp={onOpenMiyoApp} />
      );

      expect(screen.getByText("This note isn't indexed in Miyo")).toBeTruthy();
      expect(
        screen.getByText(
          "It may still be indexing or be excluded from Miyo. Open Miyo to review this folder's indexing and exclusion settings."
        )
      ).toBeTruthy();
      expect(screen.getByText("Related note")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Open Miyo" }));
      expect(onOpenMiyoApp).toHaveBeenCalledTimes(1);
      expect(container.querySelector("[data-miyo-guidance]")?.className).toContain("tw-max-w-xs");
    });

    it("routes the not-indexed action to Copilot settings when a local Miyo app cannot be opened (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const onOpenMiyoSettings = jest.fn();
      render(
        <RelevantNotesPane
          {...BASE_PROPS}
          guidance="not-indexed"
          canOpenMiyoApp={false}
          onOpenMiyoSettings={onOpenMiyoSettings}
        />
      );

      expect(screen.queryByRole("button", { name: "Open Miyo" })).toBeNull();
      expect(
        screen.getByText(
          "It may still be indexing or be excluded from Miyo. Review the configured Miyo connection or server in Copilot."
        )
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Review Miyo connection" }));
      expect(onOpenMiyoSettings).toHaveBeenCalledTimes(1);
    });

    it("centers download guidance when there are no notes or Miyo scores (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(
        <RelevantNotesPane {...BASE_PROPS} guidance="download" noteCount={0} noteRows={null} />
      );

      expect(screen.getByText("Add semantic matches with Miyo")).toBeTruthy();
      expect(screen.queryByText("No relevant notes found")).toBeNull();
    });
  });
});
