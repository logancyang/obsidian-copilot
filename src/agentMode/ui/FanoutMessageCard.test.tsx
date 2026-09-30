import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AI_SENDER } from "@/constants";
import { render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div>{text}</div>,
}));

jest.mock("@/agentMode/backends/registry", () => ({
  backendRegistry: {},
}));

jest.mock("@/utils", () => ({
  cleanMessageForCopy: (text: string) => text,
  insertAtCursor: jest.fn(),
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

      expect(screen.getByText("Summary response")).toBeTruthy();
      expect(screen.getByText("Worked for 24s")).toBeTruthy();
      expect(screen.getByTitle("Copy")).toBeTruthy();
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
