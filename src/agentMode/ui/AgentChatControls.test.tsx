import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { navigateToPlusPage, useCanUseMultiAgent } from "@/plusUtils";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/plusUtils", () => ({
  useCanUseMultiAgent: jest.fn(),
  navigateToPlusPage: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn().mockReturnValue({ autosaveChat: true }),
}));

const mockUseCanUseMultiAgent = useCanUseMultiAgent as jest.MockedFunction<
  typeof useCanUseMultiAgent
>;
const mockNavigateToPlusPage = navigateToPlusPage as jest.MockedFunction<typeof navigateToPlusPage>;

function renderControls({ showMultiAgentUpsell = true } = {}) {
  return render(
    <TooltipProvider>
      <AgentChatControls onNewChat={() => {}} showMultiAgentUpsell={showMultiAgentUpsell} />
    </TooltipProvider>
  );
}

const UPSELL_COPY = "Mention multiple agents with @ (needs Plus tier or above)";

describe("AgentChatControls", () => {
  describe("AgentChatControls()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("offers the multi-agent upsell when the user is not entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      renderControls();

      expect(screen.queryByText(UPSELL_COPY)).not.toBeNull();
    });

    it("leaves the left slot empty when the user is already entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      renderControls();

      expect(screen.queryByText(UPSELL_COPY)).toBeNull();
    });

    it("withholds the upsell from a caller that does not opt in, even when unentitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      renderControls({ showMultiAgentUpsell: false });

      expect(screen.queryByText(UPSELL_COPY)).toBeNull();
    });

    it("opens the multi-agent Plus destination when the upsell is clicked", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      renderControls();

      fireEvent.click(screen.getByText(UPSELL_COPY));

      expect(mockNavigateToPlusPage).toHaveBeenCalledWith("multi_agent");
    });

    it("does not show a lone link control before a session exists https://github.com/logancyang/obsidian-copilot/issues/3271", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      render(
        <TooltipProvider>
          <AgentChatControls />
        </TooltipProvider>
      );
      expect(screen.queryByTitle("Copy Chat Link")).toBeNull();
    });

    it("places the bookmark toggle right after the copy-link control", async () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      render(
        <AppContext.Provider value={new App()}>
          <TooltipProvider>
            <AgentChatControls
              onNewChat={() => {}}
              onCopyChatLink={() => {}}
              getChatBookmarkState={async () => "not-bookmarked"}
              onSetChatBookmarked={async () => {}}
            />
          </TooltipProvider>
        </AppContext.Provider>
      );

      const bookmark = await screen.findByTitle("Bookmark Chat");
      expect(screen.getByTitle("Copy Chat Link").nextElementSibling).toBe(bookmark);
    });

    it("leaves out the bookmark toggle when the caller does not support bookmarking", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      renderControls();

      expect(screen.queryByTitle("Bookmark Chat")).toBeNull();
    });
  });
});
