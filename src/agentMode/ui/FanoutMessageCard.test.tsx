import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { WireMessage } from "@/agentMode/protocol/state";
import {
  AgentPaneCapabilitiesProvider,
  NO_PANE_CAPABILITIES,
} from "@/agentMode/ui/AgentPaneContext";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AI_SENDER } from "@/constants";
import { fireEvent, render, screen } from "@testing-library/react";
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
}));

jest.mock("obsidian", () => ({
  Platform: { isMobile: false },
}));

describe("FanoutMessageCard", () => {
  describe("FanoutMessageCard()", () => {
    it("shows supplied duration metadata instead of the timestamp in the response footer", () => {
      const timestamp = "2026/08/07 20:31:10";
      const message: WireMessage = {
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

    describe("insert action", () => {
      const message: WireMessage = {
        id: "fanout-2",
        sender: AI_SENDER,
        message: "Summary response",
        timestamp: null,
        isVisible: true,
      };
      const turn: FanoutTurn = {
        answers: {},
        summary: { status: "done", text: "Summary response" },
      };
      const renderCard = (insertAtCursor?: (text: string) => void) =>
        render(
          <TooltipProvider>
            <AgentPaneCapabilitiesProvider value={{ ...NO_PANE_CAPABILITIES, insertAtCursor }}>
              <FanoutMessageCard message={message} turn={turn} app={{} as never} />
            </AgentPaneCapabilitiesProvider>
          </TooltipProvider>
        );

      it("inserts the shown answer at the cursor when the environment has an editor", () => {
        const insertAtCursor = jest.fn();
        renderCard(insertAtCursor);

        fireEvent.click(screen.getByTitle("Insert / Replace at cursor"));

        expect(insertAtCursor).toHaveBeenCalledWith("Summary response");
      });

      it("offers no insert action when the environment has no editor", () => {
        renderCard();

        expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
        expect(screen.getByTitle("Copy")).toBeTruthy();
      });
    });
  });
});
