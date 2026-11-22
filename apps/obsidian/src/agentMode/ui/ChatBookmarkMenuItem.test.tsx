import { ChatBookmarkMenuItem } from "@/agentMode/ui/ChatBookmarkMenuItem";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { AppContext } from "@/context";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

function renderItem(
  getBookmarkState: () => Promise<ChatBookmarkState>,
  onSetBookmarked: (bookmarked: boolean) => void = () => {},
  app: App = new App()
) {
  return render(
    <AppContext.Provider value={app}>
      <DropdownMenu open modal={false}>
        <DropdownMenuContent>
          <ChatBookmarkMenuItem
            getBookmarkState={getBookmarkState}
            onSetBookmarked={onSetBookmarked}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </AppContext.Provider>
  );
}

describe("ChatBookmarkMenuItem", () => {
  describe("ChatBookmarkMenuItem()", () => {
    beforeAll(() => {
      Element.prototype.scrollIntoView = () => {};
    });

    it("offers to add a chat that is not bookmarked and adds it when selected", async () => {
      const onSetBookmarked = jest.fn();
      renderItem(async () => "not-bookmarked", onSetBookmarked);

      fireEvent.click(await screen.findByRole("menuitem", { name: "Add to bookmarks" }));

      expect(onSetBookmarked).toHaveBeenCalledWith(true);
    });

    it("offers to remove a bookmarked chat and removes it when selected", async () => {
      const onSetBookmarked = jest.fn();
      renderItem(async () => "bookmarked", onSetBookmarked);

      fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from bookmarks" }));

      expect(onSetBookmarked).toHaveBeenCalledWith(false);
    });

    it("shows nothing until the bookmark state has been read", () => {
      renderItem(() => new Promise<never>(() => {}));

      expect(screen.queryByRole("menuitem")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 shows a muted Add to bookmarks when the Bookmarks core plugin is off and opens it in Settings when selected", async () => {
      const search = document.createElement("input");
      search.type = "search";
      const containerEl = document.createElement("div");
      containerEl.appendChild(search);
      const setting = { open: jest.fn(), openTabById: jest.fn(), activeTab: { containerEl } };
      const app = Object.assign(new App(), {
        setting,
        internalPlugins: {
          getPluginById: () => ({ enabled: false, instance: { name: "Bookmarks" } }),
        },
      });
      const onSetBookmarked = jest.fn();
      renderItem(async () => "off", onSetBookmarked, app);

      const item = await screen.findByRole("menuitem", { name: /Add to bookmarks/ });
      expect(item.className).toContain("tw-text-faint");
      fireEvent.click(item);

      expect(setting.openTabById).toHaveBeenCalledWith("plugins");
      expect(search.value).toBe("Bookmarks");
      expect(onSetBookmarked).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 is left out when Obsidian's Bookmarks internals are unavailable", async () => {
      let resolve: (state: ChatBookmarkState) => void = () => {};
      renderItem(() => new Promise((r) => (resolve = r)));

      await act(async () => resolve("unavailable"));

      expect(screen.queryByRole("menuitem")).toBeNull();
    });
  });
});
