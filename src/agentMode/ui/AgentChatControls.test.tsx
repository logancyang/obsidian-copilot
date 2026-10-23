import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { useSettingsValue } from "@/settings/model";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn().mockReturnValue({ autosaveChat: true }),
}));

const mockUseSettingsValue = useSettingsValue as jest.Mock;

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
  fireEvent.pointerDown(screen.getByTitle("More actions"), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

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

    it("does not show a lone link control before a session exists https://github.com/logancyang/obsidian-copilot/issues/3271", () => {
      render(
        <TooltipProvider>
          <AgentChatControls />
        </TooltipProvider>
      );
      expect(screen.queryByTitle("More actions")).toBeNull();
    });

    it("keeps the bar to the usage meter, New chat, Save chat as note, Chat history, and More actions", () => {
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
        "New chat",
        "Save chat as note",
        "Chat history",
        "More actions",
      ]);
    });

    it("shows the running-tasks count alone at the start of the bar (https://github.com/Brevilabs/obsidian-copilot-private/issues/749)", () => {
      const { container } = renderSessionControls({
        tasksIndicator: <span>2 tasks running</span>,
      });

      expect(container.firstElementChild?.firstElementChild?.textContent).toBe("2 tasks running");
    });

    it("copies the chat link from the More actions menu", () => {
      const onCopyChatLink = jest.fn();
      renderSessionControls({ onCopyChatLink });

      fireEvent.click(within(openMoreActions()).getByRole("menuitem", { name: "Copy chat link" }));

      expect(onCopyChatLink).toHaveBeenCalledTimes(1);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/702 disables Copy chat link and Add to bookmarks in an empty chat and explains on hover that a message is needed", async () => {
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

    it("bookmarks the open chat from the More actions menu", async () => {
      const onSetChatBookmarked = jest.fn(async () => {});
      renderSessionControls({
        getChatBookmarkState: async () => "not-bookmarked",
        onSetChatBookmarked,
      });

      const menu = openMoreActions();
      fireEvent.click(await within(menu).findByRole("menuitem", { name: "Add to bookmarks" }));

      expect(onSetChatBookmarked).toHaveBeenCalledWith(true);
    });

    it("opens the More actions menu in the chat's own window when another window is active", () => {
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 reports an error about the open chat from the More actions menu", () => {
      const onReportError = jest.fn();
      renderSessionControls({ onReportError });

      const item = within(openMoreActions()).getByRole("menuitem", { name: "Report an issue" });
      expect(item.getAttribute("aria-disabled")).toBeNull();
      fireEvent.click(item);

      expect(onReportError).toHaveBeenCalledTimes(1);
    });

    it("offers a Save chat as note button in the bar only when autosave is off", () => {
      const onSaveAsNote = jest.fn();
      mockUseSettingsValue.mockReturnValue({ autosaveChat: true });
      const { unmount } = renderSessionControls({ onSaveAsNote });
      expect(screen.queryByTitle("Save chat as note")).toBeNull();
      unmount();

      mockUseSettingsValue.mockReturnValue({ autosaveChat: false });
      renderSessionControls({ onSaveAsNote });
      fireEvent.click(screen.getByTitle("Save chat as note"));

      expect(onSaveAsNote).toHaveBeenCalledTimes(1);
    });
  });
});
