import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AI_SENDER } from "@/constants";
import { render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/agentMode/ui/FanoutTurnView", () => ({
  FanoutTurnView: () => <div>Summary response</div>,
}));

jest.mock("@/agentMode/ui/fanoutDropdown", () => ({
  defaultFanoutOption: () => "summary",
  fanoutDisplayName: (backendId: string) => backendId,
  FANOUT_SUMMARY_OPTION: "summary",
}));

jest.mock("@/agentMode/session/fanout/fanoutTypes", () => ({
  renderFanoutComposite: () => "Summary response",
}));

jest.mock("@/utils", () => ({
  cleanMessageForCopy: (text: string) => text,
  insertAtCursor: jest.fn(),
}));

jest.mock("obsidian", () => ({
  Platform: { isMobile: false },
}));

describe("FanoutMessageCard", () => {
  describe("FanoutMessageCard()", () => {
    it("shows supplied duration metadata instead of the timestamp in the response footer", () => {
      const timestamp = "2026/08/07 20:31:10";
      const message: AgentChatMessage = {
        id: "fanout-1",
        sender: AI_SENDER,
        message: "Summary response",
        timestamp: { epoch: 1, display: timestamp, fileName: "now" },
        isVisible: true,
      };
      const turn: FanoutTurn = {
        answers: {},
        summary: { status: "done", text: "Summary response" },
      };

      const { rerender } = render(
        <TooltipProvider>
          <FanoutMessageCard
            message={message}
            turn={turn}
            app={{} as never}
            footerStart={<span>Worked for 24s</span>}
          />
        </TooltipProvider>
      );

      const duration = screen.getByText("Worked for 24s");
      const footer = duration.closest(".tw-justify-between");
      expect(footer?.classList.contains("tw-items-center")).toBe(true);
      expect(footer?.contains(screen.getByTitle("Copy"))).toBe(true);
      expect(screen.queryByText(timestamp)).toBeNull();

      rerender(
        <TooltipProvider>
          <FanoutMessageCard message={message} turn={turn} app={{} as never} />
        </TooltipProvider>
      );
      expect(screen.getByText(timestamp)).toBeTruthy();
    });
  });
});
