import { BookmarkChatButton } from "@/agentMode/ui/BookmarkChatButton";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

const noop = async () => {};

function renderButton(
  props: Partial<React.ComponentProps<typeof BookmarkChatButton>> = {},
  app: App = new App()
) {
  const view = (next: Partial<React.ComponentProps<typeof BookmarkChatButton>>) => (
    <AppContext.Provider value={app}>
      <TooltipProvider>
        <BookmarkChatButton
          getBookmarkState={next.getBookmarkState}
          onSetBookmarked={next.onSetBookmarked ?? noop}
        />
      </TooltipProvider>
    </AppContext.Provider>
  );
  const result = render(view(props));
  return { ...result, rerender: (next = props) => result.rerender(view(next)) };
}

async function findReadyButton(title: string): Promise<HTMLButtonElement> {
  const button = await screen.findByTitle<HTMLButtonElement>(title);
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

describe("BookmarkChatButton", () => {
  describe("BookmarkChatButton()", () => {
    it("offers to bookmark a chat that is not bookmarked and bookmarks it when clicked", async () => {
      const onSetBookmarked = jest.fn(noop);
      renderButton({ getBookmarkState: async () => "not-bookmarked", onSetBookmarked });

      const button = await findReadyButton("Bookmark Chat");
      expect(button.getAttribute("aria-pressed")).toBe("false");
      await act(async () => fireEvent.click(button));

      expect(onSetBookmarked).toHaveBeenCalledWith(true);
    });

    it("shows a bookmarked chat as pressed and removes its bookmark when clicked", async () => {
      const onSetBookmarked = jest.fn(noop);
      renderButton({ getBookmarkState: async () => "bookmarked", onSetBookmarked });

      const button = await findReadyButton("Remove Chat Bookmark");
      expect(button.getAttribute("aria-pressed")).toBe("true");
      await act(async () => fireEvent.click(button));

      expect(onSetBookmarked).toHaveBeenCalledWith(false);
    });

    it("shows the new bookmark state once a click has changed it", async () => {
      let state: ChatBookmarkState = "not-bookmarked";
      renderButton({
        getBookmarkState: async () => state,
        onSetBookmarked: async (bookmarked) => {
          state = bookmarked ? "bookmarked" : "not-bookmarked";
        },
      });

      const button = await findReadyButton("Bookmark Chat");
      await act(async () => fireEvent.click(button));

      expect(await screen.findByTitle("Remove Chat Bookmark")).toBeTruthy();
    });

    it("rereads the bookmark state on hover, so a bookmark removed in the Bookmarks pane shows as removed", async () => {
      let state: ChatBookmarkState = "bookmarked";
      renderButton({ getBookmarkState: async () => state });
      const button = await findReadyButton("Remove Chat Bookmark");

      state = "not-bookmarked";
      await act(async () => fireEvent.pointerEnter(button));

      expect(await screen.findByTitle("Bookmark Chat")).toBeTruthy();
    });

    it("is disabled while the chat has nothing to bookmark", () => {
      renderButton({ getBookmarkState: undefined });

      expect(screen.getByTitle<HTMLButtonElement>("Bookmark Chat").disabled).toBe(true);
    });

    it("ignores a bookmark state read for a previous chat that resolves after the chat changed", async () => {
      let resolveStale: (state: ChatBookmarkState) => void = () => {};
      const { rerender } = renderButton({
        getBookmarkState: () => new Promise((resolve) => (resolveStale = resolve)),
      });

      rerender({ getBookmarkState: async () => "not-bookmarked" });
      await screen.findByTitle("Bookmark Chat");
      await act(async () => resolveStale("bookmarked"));

      expect(screen.getByTitle<HTMLButtonElement>("Bookmark Chat").disabled).toBe(false);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 stays visible but muted when the Bookmarks core plugin is off and opens it in Settings when clicked", async () => {
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
      const onSetBookmarked = jest.fn(noop);
      renderButton({ getBookmarkState: async () => "off", onSetBookmarked }, app);

      const button = await findReadyButton("Bookmark Chat");
      expect(button.className).toContain("tw-text-faint");
      await act(async () => fireEvent.click(button));

      expect(setting.openTabById).toHaveBeenCalledWith("plugins");
      expect(search.value).toBe("Bookmarks");
      expect(onSetBookmarked).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 is left out when Obsidian's Bookmarks internals are unavailable", async () => {
      let resolve: (state: ChatBookmarkState) => void = () => {};
      renderButton({ getBookmarkState: () => new Promise((r) => (resolve = r)) });
      expect(screen.getByTitle("Bookmark Chat")).toBeTruthy();

      await act(async () => resolve("unavailable"));

      expect(screen.queryByTitle("Bookmark Chat")).toBeNull();
    });
  });
});
