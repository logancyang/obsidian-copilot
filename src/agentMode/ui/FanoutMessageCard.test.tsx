import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AI_SENDER } from "@/constants";
import { fireEvent, render, screen } from "@testing-library/react";
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 offers to continue from the multi-agent reply in a new chat only when given the action", () => {
      const onContinue = jest.fn();
      const message: AgentChatMessage = {
        id: "fanout-1",
        sender: AI_SENDER,
        message: "",
        timestamp: null,
        isVisible: true,
      };
      const turn: FanoutTurn = { answers: {}, summary: { status: "done", text: "Both agree" } };
      const card = (continueAction?: () => void) => (
        <TooltipProvider>
          <FanoutMessageCard
            message={message}
            turn={turn}
            app={{} as never}
            onContinue={continueAction}
          />
        </TooltipProvider>
      );

      const { rerender } = render(card(onContinue));
      fireEvent.click(screen.getByTitle("Continue from here in a new chat"));
      rerender(card());

      expect(onContinue).toHaveBeenCalledTimes(1);
      expect(screen.queryByTitle("Continue from here in a new chat")).toBeNull();
    });
  });
});
