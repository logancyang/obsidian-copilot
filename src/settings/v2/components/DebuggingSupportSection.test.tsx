import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { DebuggingSupportSection } from "./DebuggingSupportSection";

// The section owns no state — it takes seven props and wires them to controls.
// What can break is the wiring itself: two switches sit next to three buttons,
// and an action pointed at the wrong one is invisible in the gallery, which
// renders the same states without ever pressing anything.
function renderSection() {
  const props = {
    debug: false,
    onDebugChange: jest.fn(),
    frameLogEnabled: true,
    onFrameLogChange: jest.fn(),
    frameLogPath: "/tmp/obsidian-copilot/acp-frames/3f9a/acp-frames.ndjson",
    onReportIssue: jest.fn(),
    onOpenFrameLog: jest.fn(),
    onClearFrameLog: jest.fn(),
  };
  render(<DebuggingSupportSection {...props} />);
  return props;
}

describe("DebuggingSupportSection", () => {
  describe("DebuggingSupportSection()", () => {
    it("hands each control's action to the callback it was given", () => {
      const props = renderSection();

      fireEvent.click(screen.getByRole("button", { name: "Report an issue" }));
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));

      expect(props.onReportIssue).toHaveBeenCalledTimes(1);
      expect(props.onOpenFrameLog).toHaveBeenCalledTimes(1);
      expect(props.onClearFrameLog).toHaveBeenCalledTimes(1);
    });

    it("keeps the two switches on separate callbacks", () => {
      const props = renderSection();
      const [debugSwitch, frameLogSwitch] = screen.getAllByRole("switch");

      fireEvent.click(debugSwitch);

      expect(props.onDebugChange).toHaveBeenCalledWith(true);
      expect(props.onFrameLogChange).not.toHaveBeenCalled();

      fireEvent.click(frameLogSwitch);

      expect(props.onFrameLogChange).toHaveBeenCalledWith(false);
      expect(props.onDebugChange).toHaveBeenCalledTimes(1);
    });

    it("names where the activity log is written, so it can be found without this component reading the disk", () => {
      const props = renderSection();

      expect(screen.getByText(new RegExp(props.frameLogPath))).toBeTruthy();
    });
  });
});
