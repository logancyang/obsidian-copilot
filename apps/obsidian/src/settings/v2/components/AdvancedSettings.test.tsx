import { AdvancedSettings } from "@/settings/v2/components/AdvancedSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

jest.mock("@/settings/v2/components/LegacyChatPromptsNotice", () => ({
  LegacyChatPromptsNotice: () => null,
}));

const FRAME_LOG_PATH = "/tmp/obsidian-copilot/acp-frames/acp-frames.ndjson";
jest.mock("@/agentMode", () => ({ acpFrameSink: { getPath: () => FRAME_LOG_PATH } }));

const mockIsDesktopRuntime = jest.fn<boolean, []>();
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => mockIsDesktopRuntime() }));

describe("AdvancedSettings", () => {
  describe("AdvancedSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("hands Report an issue to the report callback it was given on desktop", async () => {
      mockIsDesktopRuntime.mockReturnValue(true);
      const onReportIssue = jest.fn();
      render(<AdvancedSettings onReportIssue={onReportIssue} />);
      await screen.findByText(new RegExp(FRAME_LOG_PATH));

      fireEvent.click(screen.getByRole("button", { name: "Report an issue" }));

      expect(onReportIssue).toHaveBeenCalledTimes(1);
      expect(Notice).not.toHaveBeenCalled();
    });

    it("says reporting is desktop-only and skips the report callback on mobile", () => {
      mockIsDesktopRuntime.mockReturnValue(false);
      const onReportIssue = jest.fn();
      render(<AdvancedSettings onReportIssue={onReportIssue} />);

      fireEvent.click(screen.getByRole("button", { name: "Report an issue" }));

      expect(onReportIssue).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Reporting an issue is available on desktop only.");
    });
  });
});
