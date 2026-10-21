import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { navigateToPlusPage, useCanUseMultiAgent } from "@/plusUtils";
import { useSettingsValue } from "@/settings/model";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
const mockUseSettingsValue = useSettingsValue as jest.Mock;
const mockNavigateToPlusPage = navigateToPlusPage as jest.MockedFunction<typeof navigateToPlusPage>;

function renderControls({ showMultiAgentUpsell = true } = {}) {
  return render(
    <TooltipProvider>
      <AgentChatControls onNewChat={() => {}} showMultiAgentUpsell={showMultiAgentUpsell} />
    </TooltipProvider>
  );
}

function renderSessionControls(
  props: Partial<React.ComponentProps<typeof AgentChatControls>> = {}
) {
  return render(
    <AppContext.Provider value={new App()}>
      <TooltipProvider>
        <AgentChatControls
          onNewChat={() => {}}
          chatHistoryItems={[]}
          onLoadChat={async () => {}}
          onUpdateChatTitle={async () => {}}
          onDeleteChat={async () => {}}
          {...props}
        />
      </TooltipProvider>
    </AppContext.Provider>
  );
}

function openMoreActions(): HTMLElement {
  fireEvent.pointerDown(screen.getByTitle("More Actions"), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

const UPSELL_COPY = "Mention multiple agents with @ (needs Plus tier or above)";

describe("AgentChatControls", () => {
  beforeAll(() => {
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  describe("AgentChatControls()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockUseSettingsValue.mockReturnValue({ autosaveChat: true });
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
      expect(screen.queryByTitle("More Actions")).toBeNull();
    });

    it("keeps the bar to the usage meter, New Chat, Save Chat as Note, Chat History, and More Actions", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      mockUseSettingsValue.mockReturnValue({ autosaveChat: false });
      renderSessionControls({
        usageMeter: <span title="Context usage" />,
        onSaveAsNote: () => {},
      });

      const titles = Array.from(document.querySelectorAll("[title]")).map((el) =>
        el.getAttribute("title")
      );
      expect(titles).toEqual([
        "Context usage",
        "New Chat",
        "Save Chat as Note",
        "Chat History",
        "More Actions",
      ]);
    });

    it("copies the chat link from the More Actions menu", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      const onCopyChatLink = jest.fn();
      renderSessionControls({ onCopyChatLink });

      fireEvent.click(within(openMoreActions()).getByRole("menuitem", { name: "Copy chat link" }));

      expect(onCopyChatLink).toHaveBeenCalledTimes(1);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/702 disables Copy chat link and Add to bookmarks in an empty chat and explains on hover that a message is needed", async () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      const onSetChatBookmarked = jest.fn(async () => {});
      renderSessionControls({ onSetChatBookmarked });

      const menu = openMoreActions();
      for (const name of ["Copy chat link", "Add to bookmarks"]) {
        const item = within(menu).getByRole("menuitem", { name });
        expect(item.getAttribute("aria-disabled")).toBe("true");
        fireEvent.focus(item.parentElement!);
        expect((await screen.findByRole("tooltip")).textContent).toBe(
          "Send a message to the chat first."
        );
        fireEvent.blur(item.parentElement!);
      }
      expect(onSetChatBookmarked).not.toHaveBeenCalled();
    });

    it("bookmarks the open chat from the More Actions menu", async () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      const onSetChatBookmarked = jest.fn(async () => {});
      renderSessionControls({
        getChatBookmarkState: async () => "not-bookmarked",
        onSetChatBookmarked,
      });

      const menu = openMoreActions();
      fireEvent.click(await within(menu).findByRole("menuitem", { name: "Add to bookmarks" }));

      expect(onSetChatBookmarked).toHaveBeenCalledWith(true);
    });

    it("opens the More Actions menu in the chat's own window when another window is active", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      renderSessionControls();
      const otherWindowDocument = document.implementation.createHTMLDocument();
      const globals = window as unknown as { activeDocument: Document };
      globals.activeDocument = otherWindowDocument;
      try {
        openMoreActions();
      } finally {
        globals.activeDocument = document;
      }

      expect(otherWindowDocument.querySelector('[role="menu"]')).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 reports an error about the open chat from the More Actions menu", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      const onReportError = jest.fn();
      renderSessionControls({ onReportError });

      const item = within(openMoreActions()).getByRole("menuitem", { name: "Report error" });
      expect(item.getAttribute("aria-disabled")).toBeNull();
      fireEvent.click(item);

      expect(onReportError).toHaveBeenCalledTimes(1);
    });

    it("offers a Save Chat as Note button in the bar only when autosave is off", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      const onSaveAsNote = jest.fn();
      mockUseSettingsValue.mockReturnValue({ autosaveChat: true });
      const { unmount } = renderSessionControls({ onSaveAsNote });
      expect(screen.queryByTitle("Save Chat as Note")).toBeNull();
      unmount();

      mockUseSettingsValue.mockReturnValue({ autosaveChat: false });
      renderSessionControls({ onSaveAsNote });
      fireEvent.click(screen.getByTitle("Save Chat as Note"));

      expect(onSaveAsNote).toHaveBeenCalledTimes(1);
    });
  });
});
