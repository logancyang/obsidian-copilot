import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import type CopilotPlugin from "@/main";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { act, renderHook } from "@testing-library/react";
import { type App, Notice } from "obsidian";

const item = (id: string, backendId?: string): ChatHistoryItem =>
  ({ id, backendId }) as unknown as ChatHistoryItem;

function makeManager() {
  return {
    getChatHistoryItems: jest.fn(async () => [item("a"), item("b")]),
    updateChatTitle: jest.fn(async () => {}),
    deleteChatHistory: jest.fn(async () => {}),
    setChatPinned: jest.fn(async (id: string) => ({ id, pinnedAt: 5_000 })),
    ensureChatNote: jest.fn(async (id: string) => id),
  } as unknown as AgentSessionManager & {
    getChatHistoryItems: jest.Mock;
    updateChatTitle: jest.Mock;
    deleteChatHistory: jest.Mock;
    setChatPinned: jest.Mock;
    ensureChatNote: jest.Mock;
  };
}

const NATIVE_ID = buildNativeChatId("opencode", "s1");
const LINK_A = "obsidian://copilot-chat?vault=Notes&id=epoch%3A1000";
const LINK_SAVED = "obsidian://copilot-chat?vault=Notes&id=epoch%3A3000";

function makeBookmarks(urls: string[] = []) {
  const bookmarks = {
    urlBookmarkLookup: Object.fromEntries(
      urls.map((url) => [url, { type: "url", url, title: url }])
    ) as Record<string, { type: string; url: string; title: string; ctime?: number }>,
    addItem: jest.fn((item: { type: string; url: string; title: string }) => {
      bookmarks.urlBookmarkLookup[item.url] = item;
    }),
    removeItem: jest.fn((item: { url: string }) => {
      delete bookmarks.urlBookmarkLookup[item.url];
    }),
  };
  return bookmarks;
}

function makeBookmarkingPlugin(bookmarks: ReturnType<typeof makeBookmarks> | null) {
  const epochs: Record<string, number> = { "chats/agent__a.md": 1_000, "chats/saved.md": 3_000 };
  const app = {
    vault: { getName: () => "Notes" },
    metadataCache: {
      getCache: (path: string) =>
        path in epochs ? { frontmatter: { epoch: epochs[path] } } : null,
    },
    internalPlugins: {
      getEnabledPluginById: jest.fn((id: string) => (id === "bookmarks" ? bookmarks : null)),
      getPluginById: (id: string) => (id === "bookmarks" ? { enabled: bookmarks !== null } : null),
    },
  } as unknown as App;
  return { app } as unknown as CopilotPlugin;
}

const plugin = makeBookmarkingPlugin(null);

const renderControls = (manager: AgentSessionManager, scope?: string) =>
  renderHook(({ s }: { s?: string }) => useAgentHistoryControls(manager, plugin, s), {
    initialProps: { s: scope },
  });

describe("useAgentHistoryControls", () => {
  beforeEach(() => (Notice as unknown as jest.Mock).mockClear());

  describe("useAgentHistoryControls()", () => {
    it("loads the history of every chat when no scope is given", async () => {
      const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
      const { result } = renderControls(manager);

      await act(async () => {
        await result.current.loadChatHistory();
      });

      expect(manager.getChatHistoryItems).toHaveBeenCalledWith(undefined);
      expect(result.current.chatHistoryItems).toHaveLength(2);
    });

    it("loads only the chats of the given project scope", async () => {
      const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
      const { result } = renderControls(manager, "project-1");

      await act(async () => {
        await result.current.loadChatHistory();
      });

      expect(manager.getChatHistoryItems).toHaveBeenCalledWith("project-1");
    });

    it("hides the previous scope's chats after a scope change until the new scope's load lands", async () => {
      const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
      const { result, rerender } = renderControls(manager, "project-1");

      await act(async () => {
        await result.current.loadChatHistory();
      });
      expect(result.current.chatHistoryItems).toHaveLength(2);

      rerender({ s: "project-2" });
      expect(result.current.chatHistoryItems).toHaveLength(0);

      await act(async () => {
        await result.current.loadChatHistory();
      });
      expect(manager.getChatHistoryItems).toHaveBeenLastCalledWith("project-2");
      expect(result.current.chatHistoryItems).toHaveLength(2);
    });

    it("ignores a load that resolves after its scope was replaced by another scope", async () => {
      const resolvers: Record<string, (items: ChatHistoryItem[]) => void> = {};
      const manager = {
        getChatHistoryItems: jest.fn(
          (s?: string) =>
            new Promise<ChatHistoryItem[]>((resolve) => {
              resolvers[s ?? GLOBAL_SCOPE] = resolve;
            })
        ),
        updateChatTitle: jest.fn(async () => {}),
        deleteChatHistory: jest.fn(async () => {}),
      } as unknown as AgentSessionManager & { getChatHistoryItems: jest.Mock };

      const { result, rerender } = renderControls(manager, "project-1");

      let loadA!: Promise<void>;
      act(() => {
        loadA = result.current.loadChatHistory();
      });

      rerender({ s: "project-2" });
      let loadB!: Promise<void>;
      act(() => {
        loadB = result.current.loadChatHistory();
      });

      await act(async () => {
        resolvers["project-2"]([item("b1"), item("b2")]);
        await loadB;
      });
      expect(result.current.chatHistoryItems).toHaveLength(2);

      await act(async () => {
        resolvers["project-1"]([item("a1")]);
        await loadA;
      });
      expect(result.current.chatHistoryItems).toHaveLength(2);
    });

    it("reports the history as settled only once a load for the current scope completes", async () => {
      const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
      const { result, rerender } = renderControls(manager, "project-1");

      expect(result.current.chatHistorySettled).toBe(false);
      await act(async () => {
        await result.current.loadChatHistory();
      });
      expect(result.current.chatHistorySettled).toBe(true);

      rerender({ s: "project-2" });
      expect(result.current.chatHistorySettled).toBe(false);
      await act(async () => {
        await result.current.loadChatHistory();
      });
      expect(result.current.chatHistorySettled).toBe(true);
    });

    it("reports the history as settled with no chats when the load fails", async () => {
      const manager = makeManager() as AgentSessionManager & { getChatHistoryItems: jest.Mock };
      manager.getChatHistoryItems.mockRejectedValueOnce(new Error("vault read failed"));
      const { result } = renderControls(manager, "project-1");

      await act(async () => {
        await result.current.loadChatHistory();
      });

      expect(result.current.chatHistorySettled).toBe(true);
      expect(result.current.chatHistoryItems).toHaveLength(0);
    });

    it("deletes the chat and reloads the history of the same scope", async () => {
      const manager = makeManager() as AgentSessionManager & {
        getChatHistoryItems: jest.Mock;
        deleteChatHistory: jest.Mock;
      };
      const { result } = renderControls(manager, "project-1");

      await act(async () => {
        await result.current.deleteChat("a");
      });

      expect(manager.deleteChatHistory).toHaveBeenCalledWith("a");
      expect(manager.getChatHistoryItems).toHaveBeenCalledWith("project-1");
    });

    it.each([["claude", "Claude Code"]])(
      "shows one notice saying %s may keep its own copy after a successful delete",
      async (backendId, agent) => {
        const manager = makeManager();
        manager.getChatHistoryItems.mockResolvedValue([item("a", backendId)]);
        const { result } = renderControls(manager);
        await act(async () => {
          await result.current.loadChatHistory();
        });
        (Notice as unknown as jest.Mock).mockClear();

        await act(async () => {
          await result.current.deleteChat("a");
        });

        expect(Notice).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledWith(
          `Chat deleted from Copilot. ${agent} may keep its own copy.`
        );
      }
    );

    it("shows the failure notice, reloads the history, and rejects when Copilot's own delete fails", async () => {
      const manager = makeManager() as AgentSessionManager & {
        getChatHistoryItems: jest.Mock;
        deleteChatHistory: jest.Mock;
      };
      manager.deleteChatHistory.mockRejectedValue(
        new Error("Copilot could not delete: chat file (locked).")
      );
      const { result } = renderControls(manager);
      (Notice as unknown as jest.Mock).mockClear();

      await act(async () => {
        await expect(result.current.deleteChat("a")).rejects.toThrow("chat file (locked)");
      });

      expect(Notice).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith("Failed to delete chat.");
      expect(manager.getChatHistoryItems).toHaveBeenCalled();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3195 pins a chat on its row right away instead of reloading history the metadata cache has not caught up with", async () => {
      const manager = makeManager();
      const { result } = renderControls(manager);
      await act(async () => {
        await result.current.loadChatHistory();
      });

      await act(async () => {
        await result.current.setChatPinned("a", true);
      });

      expect(manager.setChatPinned).toHaveBeenCalledWith("a", true);
      expect(result.current.chatHistoryItems).toEqual([{ id: "a", pinnedAt: 5_000 }, item("b")]);
      expect(manager.getChatHistoryItems).toHaveBeenCalledTimes(1);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3195 keeps a pin when a history load that started before it resolves afterward", async () => {
      const manager = makeManager();
      const { result } = renderControls(manager);
      await act(async () => {
        await result.current.loadChatHistory();
      });
      let resolveStaleLoad!: (items: ChatHistoryItem[]) => void;
      manager.getChatHistoryItems.mockImplementationOnce(
        () => new Promise<ChatHistoryItem[]>((resolve) => (resolveStaleLoad = resolve))
      );
      let staleLoad!: Promise<void>;
      act(() => {
        staleLoad = result.current.loadChatHistory();
      });

      await act(async () => {
        await result.current.setChatPinned("a", true);
      });
      await act(async () => {
        resolveStaleLoad([item("a"), item("b")]);
        await staleLoad;
      });

      expect(result.current.chatHistoryItems).toEqual([{ id: "a", pinnedAt: 5_000 }, item("b")]);
    });

    it("shows only the latest history load when an earlier load resolves after it", async () => {
      const manager = makeManager();
      const resolvers: Array<(items: ChatHistoryItem[]) => void> = [];
      manager.getChatHistoryItems.mockImplementation(
        () => new Promise<ChatHistoryItem[]>((resolve) => resolvers.push(resolve))
      );
      const { result } = renderControls(manager);
      let firstLoad!: Promise<void>;
      let secondLoad!: Promise<void>;
      act(() => {
        firstLoad = result.current.loadChatHistory();
        secondLoad = result.current.loadChatHistory();
      });

      await act(async () => {
        resolvers[1]([item("new")]);
        await secondLoad;
      });
      await act(async () => {
        resolvers[0]([item("old")]);
        await firstLoad;
      });

      expect(result.current.chatHistoryItems).toEqual([item("new")]);
    });

    it("unpins a chat on its row right away", async () => {
      const manager = makeManager();
      manager.getChatHistoryItems.mockResolvedValue([{ id: "a", pinnedAt: 5_000 }]);
      manager.setChatPinned.mockImplementation(async (id: string) => ({ id, pinnedAt: undefined }));
      const { result } = renderControls(manager);
      await act(async () => {
        await result.current.loadChatHistory();
      });

      await act(async () => {
        await result.current.setChatPinned("a", false);
      });

      expect(result.current.chatHistoryItems).toEqual([{ id: "a", pinnedAt: undefined }]);
    });

    it("replaces a pinned chat that had no note with the note it was saved as", async () => {
      const manager = makeManager();
      manager.getChatHistoryItems.mockResolvedValue([{ id: "native:opencode:s1" }]);
      manager.setChatPinned.mockResolvedValue({ id: "chats/agent__s1.md", pinnedAt: 5_000 });
      const { result } = renderControls(manager);
      await act(async () => {
        await result.current.loadChatHistory();
      });

      await act(async () => {
        await result.current.setChatPinned("native:opencode:s1", true);
      });

      expect(result.current.chatHistoryItems).toEqual([
        { id: "chats/agent__s1.md", pinnedAt: 5_000 },
      ]);
    });

    it("shows a notice and leaves every row as it was when pinning fails", async () => {
      const manager = makeManager();
      manager.setChatPinned.mockRejectedValue(new Error("backend is not installed"));
      const { result } = renderControls(manager);
      await act(async () => {
        await result.current.loadChatHistory();
      });

      await act(async () => {
        await result.current.setChatPinned("a", true);
      });

      expect(Notice).toHaveBeenCalledWith("Failed to pin chat.");
      expect(result.current.chatHistoryItems).toEqual([item("a"), item("b")]);
    });

    it("removes the deleted chat's bookmark from the Bookmarks pane", async () => {
      const bookmarks = makeBookmarks([LINK_A, LINK_SAVED]);
      const { result } = renderHook(() =>
        useAgentHistoryControls(makeManager(), makeBookmarkingPlugin(bookmarks))
      );

      await act(async () => {
        await result.current.deleteChat("chats/agent__a.md");
      });

      expect(Object.keys(bookmarks.urlBookmarkLookup)).toEqual([LINK_SAVED]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 still deletes the chat and reloads history when removing its bookmark throws", async () => {
      const plugin = makeBookmarkingPlugin(makeBookmarks([LINK_A]));
      (
        plugin.app as unknown as { internalPlugins: { getEnabledPluginById: jest.Mock } }
      ).internalPlugins.getEnabledPluginById.mockImplementation(() => {
        throw new Error("internal plugin API changed");
      });
      const manager = makeManager();
      const { result } = renderHook(() => useAgentHistoryControls(manager, plugin));

      await act(async () => {
        await result.current.deleteChat("chats/agent__a.md");
      });

      expect(manager.deleteChatHistory).toHaveBeenCalledWith("chats/agent__a.md");
      expect(manager.getChatHistoryItems).toHaveBeenCalledTimes(1);
      expect(Notice).toHaveBeenCalledWith("Failed to remove chat bookmark.");
      expect(Notice).not.toHaveBeenCalledWith("Failed to delete chat.");
    });

    it("keeps the chat's bookmark when deleting the chat fails", async () => {
      const bookmarks = makeBookmarks([LINK_A]);
      const manager = makeManager();
      manager.deleteChatHistory.mockRejectedValue(new Error("file is locked"));
      const { result } = renderHook(() =>
        useAgentHistoryControls(manager, makeBookmarkingPlugin(bookmarks))
      );

      await act(async () => {
        await expect(result.current.deleteChat("chats/agent__a.md")).rejects.toThrow();
      });

      expect(Object.keys(bookmarks.urlBookmarkLookup)).toEqual([LINK_A]);
    });

    it("reports a saved chat as bookmarked when the Bookmarks pane holds its chat link", async () => {
      const { result } = renderHook(() =>
        useAgentHistoryControls(makeManager(), makeBookmarkingPlugin(makeBookmarks([LINK_A])))
      );

      await expect(result.current.getChatBookmarkState("chats/agent__a.md")).resolves.toBe(
        "bookmarked"
      );
    });

    it("reports a saved chat as not bookmarked when no bookmark holds its chat link", async () => {
      const { result } = renderHook(() =>
        useAgentHistoryControls(makeManager(), makeBookmarkingPlugin(makeBookmarks([LINK_SAVED])))
      );

      await expect(result.current.getChatBookmarkState("chats/agent__a.md")).resolves.toBe(
        "not-bookmarked"
      );
    });

    it("reports a chat with no saved note as not bookmarked, since it has no chat link yet", async () => {
      const { result } = renderHook(() =>
        useAgentHistoryControls(makeManager(), makeBookmarkingPlugin(makeBookmarks()))
      );

      await expect(result.current.getChatBookmarkState(NATIVE_ID)).resolves.toBe("not-bookmarked");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 reports bookmarks as off when the Bookmarks core plugin is turned off", async () => {
      const { result } = renderHook(() =>
        useAgentHistoryControls(makeManager(), makeBookmarkingPlugin(null))
      );

      await expect(result.current.getChatBookmarkState("chats/agent__a.md")).resolves.toBe("off");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 reports bookmarks as unavailable when the enabled Bookmarks plugin no longer has the expected shape", async () => {
      const { result } = renderHook(() =>
        useAgentHistoryControls(
          makeManager(),
          makeBookmarkingPlugin({} as ReturnType<typeof makeBookmarks>)
        )
      );

      await expect(result.current.getChatBookmarkState("chats/agent__a.md")).resolves.toBe(
        "unavailable"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 reports bookmarks as unavailable and shows a notice when reading Obsidian's bookmarks throws", async () => {
      const plugin = makeBookmarkingPlugin(makeBookmarks());
      (
        plugin.app as unknown as { internalPlugins: { getEnabledPluginById: jest.Mock } }
      ).internalPlugins.getEnabledPluginById.mockImplementation(() => {
        throw new Error("internal plugin API changed");
      });
      const { result } = renderHook(() => useAgentHistoryControls(makeManager(), plugin));

      await expect(result.current.getChatBookmarkState("chats/agent__a.md")).resolves.toBe(
        "unavailable"
      );
      expect(Notice).toHaveBeenCalledWith("Failed to read bookmarks.");
    });

    it("bookmarks a saved chat under the given title at its chat link and confirms with a notice", async () => {
      const bookmarks = makeBookmarks();
      const { result } = renderHook(() =>
        useAgentHistoryControls(makeManager(), makeBookmarkingPlugin(bookmarks))
      );

      await act(async () => {
        await result.current.setChatBookmarked("chats/agent__a.md", "Plan the launch", true);
      });

      expect(bookmarks.urlBookmarkLookup[LINK_A]).toEqual(
        expect.objectContaining({ type: "url", url: LINK_A, title: "Plan the launch" })
      );
      expect(Notice).toHaveBeenCalledWith("Bookmarked.");
    });

    it("removes a saved chat's bookmark and confirms with a notice", async () => {
      const bookmarks = makeBookmarks([LINK_A]);
      const { result } = renderHook(() =>
        useAgentHistoryControls(makeManager(), makeBookmarkingPlugin(bookmarks))
      );

      await act(async () => {
        await result.current.setChatBookmarked("chats/agent__a.md", "Plan the launch", false);
      });

      expect(bookmarks.urlBookmarkLookup).toEqual({});
      expect(Notice).toHaveBeenCalledWith("Removed from bookmarks.");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 saves a chat with no note before bookmarking the new note's link and shows the row as that note", async () => {
      const bookmarks = makeBookmarks();
      const manager = makeManager();
      manager.getChatHistoryItems.mockResolvedValue([{ id: NATIVE_ID }]);
      manager.ensureChatNote.mockResolvedValue("chats/saved.md");
      const { result } = renderHook(() =>
        useAgentHistoryControls(manager, makeBookmarkingPlugin(bookmarks))
      );
      await act(async () => {
        await result.current.loadChatHistory();
      });

      await act(async () => {
        await result.current.setChatBookmarked(NATIVE_ID, "Unsaved chat", true);
      });

      expect(manager.ensureChatNote).toHaveBeenCalledWith(NATIVE_ID);
      expect(Object.keys(bookmarks.urlBookmarkLookup)).toEqual([LINK_SAVED]);
      expect(result.current.chatHistoryItems).toEqual([{ id: "chats/saved.md" }]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/694 adds no bookmark and shows a notice when a chat with no note cannot be saved", async () => {
      const bookmarks = makeBookmarks();
      const manager = makeManager();
      manager.ensureChatNote.mockRejectedValue(new Error("backend is not installed"));
      const { result } = renderHook(() =>
        useAgentHistoryControls(manager, makeBookmarkingPlugin(bookmarks))
      );

      await act(async () => {
        await result.current.setChatBookmarked(NATIVE_ID, "Unsaved chat", true);
      });

      expect(bookmarks.addItem).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Failed to bookmark chat.");
    });

    it("copies the link of the saved chat note the chat id points to", async () => {
      let linkedNotePath: string | undefined;
      const copyChatLink = jest.fn(async (resolveNotePath: () => Promise<string>) => {
        linkedNotePath = await resolveNotePath();
      });
      const linkingPlugin = { copyChatLink } as unknown as CopilotPlugin;
      const { result } = renderHook(() => useAgentHistoryControls(makeManager(), linkingPlugin));

      await act(async () => {
        await result.current.copyChatLink("chats/agent__a.md");
      });

      expect(copyChatLink).toHaveBeenCalledTimes(1);
      expect(linkedNotePath).toBe("chats/agent__a.md");
    });
  });
});
