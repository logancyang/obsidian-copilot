import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { navigateToPlusPage, useCanUseMultiAgent } from "@/plusUtils";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

jest.mock("@/plusUtils", () => ({
  useCanUseMultiAgent: jest.fn(),
  navigateToPlusPage: jest.fn(),
}));

// Autosave on, so the Save-Chat button only appears when a chat autosave
// refuses to write; the upsell suite below is unaffected by it.
jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn().mockReturnValue({ autosaveChat: true }),
}));

const mockUseCanUseMultiAgent = useCanUseMultiAgent as jest.MockedFunction<
  typeof useCanUseMultiAgent
>;
const mockNavigateToPlusPage = navigateToPlusPage as jest.MockedFunction<typeof navigateToPlusPage>;

/** The control-bar buttons need a Radix `TooltipProvider` ancestor, which the
 * chat-view root supplies in the app. */
function renderControls({
  showMultiAgentUpsell = true,
  ...props
}: Partial<React.ComponentProps<typeof AgentChatControls>> = {}) {
  return render(
    <TooltipProvider>
      <AgentChatControls
        onNewChat={() => {}}
        showMultiAgentUpsell={showMultiAgentUpsell}
        {...props}
      />
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

    it("offers Save with autosave on for a chat whose saved structure is unavailable", () => {
      // Autosave refuses to rewrite such a chat, so hiding Save would leave the
      // user no way to put a fresh copy on disk.
      // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Persistence and reload".
      mockUseCanUseMultiAgent.mockReturnValue(true);
      renderControls({ onSaveAsNote: jest.fn(), historyRestoreStatus: "unavailable" });

      expect(screen.queryByTitle("Save Chat as Note")).not.toBeNull();
    });

    it("hides Save with autosave on for a chat that keeps saving itself", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      renderControls({ onSaveAsNote: jest.fn(), historyRestoreStatus: "restored" });

      expect(screen.queryByTitle("Save Chat as Note")).toBeNull();
    });
  });
});
