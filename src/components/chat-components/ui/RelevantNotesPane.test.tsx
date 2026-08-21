import { RelevantNotesPane, type RelevantNotesPaneProps } from "./RelevantNotesPane";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const BASE_PROPS: RelevantNotesPaneProps = {
  guidance: null,
  noteCount: 1,
  noteRows: <div>Related note</div>,
  miyoDownloadUrl: "https://www.miyo.md/",
  onOpenMiyoSettings: jest.fn(),
};

describe("RelevantNotesPane", () => {
  describe("RelevantNotesPane()", () => {
    it("renders scored results without setup guidance", () => {
      render(<RelevantNotesPane {...BASE_PROPS} />);

      expect(screen.getByText("Related note")).toBeTruthy();
      expect(screen.queryByText(/Miyo/)).toBeNull();
    });

    it("shows honest download guidance when no Miyo scores exist, including beside link rows (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(<RelevantNotesPane {...BASE_PROPS} guidance="download" />);

      expect(screen.getByText("Related note")).toBeTruthy();
      expect(screen.getByText("Add semantic matches with Miyo")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Download Miyo" }).getAttribute("href")).toBe(
        "https://www.miyo.md/"
      );
    });

    it("shows setup guidance beside link rows and opens Copilot's Miyo tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const onOpenMiyoSettings = jest.fn();
      render(
        <RelevantNotesPane
          {...BASE_PROPS}
          guidance="setup"
          onOpenMiyoSettings={onOpenMiyoSettings}
        />
      );

      expect(screen.getByText("Related note")).toBeTruthy();
      expect(screen.getByText("Check your Miyo setup")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Open Miyo" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open Miyo settings" }));
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
