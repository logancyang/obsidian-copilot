import { RelevantNotesToolbar } from "@/components/chat-components/ui/RelevantNotesToolbar";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("RelevantNotesToolbar", () => {
  describe("RelevantNotesToolbar()", () => {
    it("names the note the results are relevant to", () => {
      render(<RelevantNotesToolbar activeFileName="Weekly review" />);

      expect(screen.getByText("Weekly review")).toBeTruthy();
    });

    it("shows a placeholder when no note is open", () => {
      render(<RelevantNotesToolbar activeFileName={undefined} />);

      expect(screen.getByText("—")).toBeTruthy();
    });

    it("reflects that live update is on", () => {
      render(
        <RelevantNotesToolbar
          activeFileName="Weekly review"
          liveUpdate={{ enabled: true, onChange: jest.fn() }}
        />
      );

      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    });

    it("reports the requested live update state when toggled", () => {
      const onChange = jest.fn();
      render(
        <RelevantNotesToolbar
          activeFileName="Weekly review"
          liveUpdate={{ enabled: false, onChange }}
        />
      );

      fireEvent.click(screen.getByRole("switch"));

      expect(onChange).toHaveBeenCalledWith(true);
    });

    it("names the switch after the word beside it so it is announced as Live (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      render(
        <RelevantNotesToolbar
          activeFileName="Weekly review"
          liveUpdate={{ enabled: true, onChange: jest.fn() }}
        />
      );

      expect(screen.getByRole("switch", { name: "Live" })).toBeTruthy();
    });

    it("toggles live update when the word beside the switch is clicked (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const onChange = jest.fn();
      render(
        <RelevantNotesToolbar
          activeFileName="Weekly review"
          liveUpdate={{ enabled: true, onChange }}
        />
      );

      fireEvent.click(screen.getByText("Live"));

      expect(onChange).toHaveBeenCalledWith(false);
    });

    it("hides live update when there is no index to follow (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      render(<RelevantNotesToolbar activeFileName="Weekly review" />);

      expect(screen.queryByRole("switch")).toBeNull();
      expect(screen.queryByText("Live")).toBeNull();
    });
  });
});
