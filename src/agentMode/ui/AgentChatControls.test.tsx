import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { navigateToPlusPage, useCanUseMultiAgent } from "@/plusUtils";
import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

jest.mock("@/plusUtils", () => ({
  useCanUseMultiAgent: jest.fn(),
  navigateToPlusPage: jest.fn(),
}));

// Autosave keeps the manual save action out of control-bar fixtures.
jest.mock("@/settings/model", () => ({
  useSettingsValue: jest
    .fn()
    .mockReturnValue({ autosaveChat: true, chatHistorySortStrategy: "recent" }),
}));

const mockUseCanUseMultiAgent = useCanUseMultiAgent as jest.MockedFunction<
  typeof useCanUseMultiAgent
>;
const mockNavigateToPlusPage = navigateToPlusPage as jest.MockedFunction<typeof navigateToPlusPage>;

/** The control-bar buttons need a Radix `TooltipProvider` ancestor, which the
 * chat-view root supplies in the app. */
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/429 exposes live session release through the actual history popover", async () => {
      const originalObserver = window.IntersectionObserver;
      window.IntersectionObserver = jest.fn(() => ({
        observe: jest.fn(),
        disconnect: jest.fn(),
      })) as unknown as typeof IntersectionObserver;
      try {
        const onCloseSession = jest.fn(async () => {});
        const onLoadChat = jest.fn(async () => {});
        const onDeleteChat = jest.fn(async () => {});
        render(
          <TooltipProvider>
            <AgentChatControls
              chatHistoryItems={[
                {
                  id: "research.md",
                  title: "Research notes",
                  createdAt: new Date(),
                  lastAccessedAt: new Date(),
                },
              ]}
              openChatIds={new Set(["research.md"])}
              onCloseSession={onCloseSession}
              onLoadChat={onLoadChat}
              onDeleteChat={onDeleteChat}
              onUpdateChatTitle={jest.fn(async () => {})}
            />
          </TooltipProvider>
        );
        fireEvent.click(screen.getByTitle("Chat History"));
        expect(screen.getByLabelText("Session open")).toBeTruthy();
        await act(async () =>
          fireEvent.click(screen.getByRole("button", { name: "Close session" }))
        );
        expect(onCloseSession).toHaveBeenCalledWith("research.md");
        expect(onLoadChat).not.toHaveBeenCalled();
        expect(onDeleteChat).not.toHaveBeenCalled();
        expect(screen.getByText("Research notes")).toBeTruthy();
      } finally {
        window.IntersectionObserver = originalObserver;
      }
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

    // The pre-conversation mounts (cold-start agent selection, not-ready
    // fallback) render this bar with no props, where an upsell would pitch a
    // second agent to a user without a working first one.
    it("withholds the upsell from a caller that does not opt in, even when unentitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      renderControls({ showMultiAgentUpsell: false });

      expect(screen.queryByText(UPSELL_COPY)).toBeNull();
    });

    it("opens the multi-agent Plus destination when the upsell is clicked", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      renderControls();

      fireEvent.click(screen.getByText(UPSELL_COPY));

      expect(mockNavigateToPlusPage).toHaveBeenCalledWith(PLUS_UTM_MEDIUMS.MULTI_AGENT);
    });
  });
});
