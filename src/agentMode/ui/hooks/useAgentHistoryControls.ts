import { backendRegistry } from "@/agentMode/backends/registry";
import { formatChatDeleteNotice, formatChatsDeleteNotice } from "@/lib/chatDeleteText";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { buildChatDeepLink, getSavedChatDeepLinkId } from "@/utils/chatDeepLink";
import { extractChatTitle } from "@/utils/chatHistoryUtils";
import { getUrlBookmarks, isBookmarksPluginDisabled } from "@/utils/obsidianBookmarks";
import { type App, Notice, TFile } from "obsidian";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const EMPTY_CHAT_HISTORY_ITEMS = Object.freeze([]) as unknown as ChatHistoryItem[];

export interface AgentHistoryControls {
  chatHistoryItems: ChatHistoryItem[];
  archivedChatItems: ChatHistoryItem[];
  chatHistorySettled: boolean;
  loadChatHistory: () => Promise<void>;
  loadChat: (id: string) => Promise<void>;
  updateChatTitle: (id: string, newTitle: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  deleteChats: (ids: readonly string[]) => Promise<void>;
  setChatPinned: (id: string, pinned: boolean, pinnedAt?: number) => Promise<void>;
  setChatArchived: (id: string, archived: boolean) => Promise<void>;
  archiveChats: (ids: readonly string[]) => Promise<void>;
  openSourceFile: (id: string) => Promise<void>;
  copyChatLink: (id: string) => Promise<void>;
  getChatBookmarkState: (id: string) => Promise<ChatBookmarkState>;
  setChatBookmarked: (id: string, title: string, bookmarked: boolean) => Promise<void>;
  setActiveChatBookmarked: (bookmarked: boolean) => Promise<void>;
}

function keepOrEmpty(items: ChatHistoryItem[]): ChatHistoryItem[] {
  return items.length === 0 ? EMPTY_CHAT_HISTORY_ITEMS : items;
}

export type ChatBookmarkState = "unavailable" | "off" | "bookmarked" | "not-bookmarked";
async function getChatLink(app: App, notePath: string): Promise<string | null> {
  const id = await getSavedChatDeepLinkId(app, notePath);
  return id && buildChatDeepLink(app.vault.getName(), id);
}

export function useAgentHistoryControls(
  manager: AgentSessionManager,
  plugin: CopilotPlugin,
  scope?: ProjectScopeId
): AgentHistoryControls {
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);
  const effectiveScope = scope ?? GLOBAL_SCOPE;
  const [loadedScope, setLoadedScope] = useState<ProjectScopeId>(effectiveScope);
  const scopedChatHistoryItems =
    loadedScope === effectiveScope ? chatHistoryItems : EMPTY_CHAT_HISTORY_ITEMS;
  const visibleChatHistoryItems = useMemo(
    () => keepOrEmpty(scopedChatHistoryItems.filter((item) => item.archivedAt === undefined)),
    [scopedChatHistoryItems]
  );
  const archivedChatItems = useMemo(
    () => keepOrEmpty(scopedChatHistoryItems.filter((item) => item.archivedAt !== undefined)),
    [scopedChatHistoryItems]
  );
  const [settledScope, setSettledScope] = useState<ProjectScopeId | null>(null);
  const chatHistorySettled = settledScope === effectiveScope;

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const latestScopeRef = useRef(effectiveScope);
  useEffect(() => {
    latestScopeRef.current = effectiveScope;
  }, [effectiveScope]);

  const runWithNotice = useCallback(
    async <T>(label: string, action: () => Promise<T>, rethrow = false): Promise<T | void> => {
      try {
        return await action();
      } catch (error) {
        logError(`[AgentMode] ${label} failed`, error);
        new Notice(`Failed to ${label}.`);
        if (rethrow) throw error;
      }
    },
    []
  );

  // Only the newest history request may land, and a pin retires every earlier one: a load that
  // read the notes before the pin was written would otherwise drop the row back below the divider.
  // https://github.com/logancyang/obsidian-copilot/issues/3195
  const historyRequestRef = useRef(0);

  const loadChatHistory = useCallback(async () => {
    const requestScope = scope ?? GLOBAL_SCOPE;
    const request = ++historyRequestRef.current;
    const isCurrent = () =>
      isMountedRef.current &&
      latestScopeRef.current === requestScope &&
      historyRequestRef.current === request;
    await runWithNotice("load chat history", async () => {
      const items = await manager.getChatHistoryItems(scope);
      if (isCurrent()) {
        setLoadedScope(requestScope);
        setChatHistoryItems(items);
      }
    });
    if (isCurrent()) {
      setSettledScope(requestScope);
    }
  }, [manager, runWithNotice, scope]);

  // A chat note renamed or deleted outside Copilot would leave a row pointing at a path that no longer exists.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/801
  useEffect(() => {
    const { vault } = plugin.app;
    const listedIds = new Set(chatHistoryItems.map((item) => item.id));
    const reloadIfListed = (path: string) => {
      if (listedIds.has(path)) void loadChatHistory();
    };
    const refs = [
      vault.on("rename", (_file, oldPath) => reloadIfListed(oldPath)),
      vault.on("delete", (file) => reloadIfListed(file.path)),
    ];
    return () => refs.forEach((ref) => vault.offref(ref));
  }, [plugin, chatHistoryItems, loadChatHistory]);

  const loadChat = useCallback(
    async (id: string) => {
      await runWithNotice("load chat", () => plugin.loadChatById(id));
    },
    [plugin, runWithNotice]
  );

  const updateChatTitle = useCallback(
    async (id: string, newTitle: string) => {
      await runWithNotice(
        "update chat title",
        async () => {
          await manager.updateChatTitle(id, newTitle);
          await loadChatHistory();
        },
        true
      );
    },
    [manager, loadChatHistory, runWithNotice]
  );

  const deleteChatAndBookmark = useCallback(
    async (id: string) => {
      const link = await getChatLink(plugin.app, id);
      await manager.deleteChatHistory(id);
      // Obsidian's Bookmarks internals have no public API, so a failure there must not undo or hide a completed delete.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
      if (link) {
        await runWithNotice("remove chat bookmark", async () =>
          getUrlBookmarks(plugin.app)?.remove(link)
        );
      }
    },
    [manager, plugin, runWithNotice]
  );

  const deleteChat = useCallback(
    async (id: string) => {
      try {
        await runWithNotice(
          "delete chat",
          async () => {
            const item = chatHistoryItems.find((chat) => chat.id === id);
            await deleteChatAndBookmark(id);
            new Notice(
              formatChatDeleteNotice(item?.backendId ? backendRegistry[item.backendId] : undefined)
            );
          },
          true
        );
      } finally {
        await loadChatHistory();
      }
    },
    [chatHistoryItems, deleteChatAndBookmark, loadChatHistory, runWithNotice]
  );

  const deleteChats = useCallback(
    async (ids: readonly string[]) => {
      let deleted = 0;
      try {
        for (const id of ids) {
          const done = await runWithNotice("delete chat", async () => {
            await deleteChatAndBookmark(id);
            return true;
          });
          if (done) deleted++;
        }
        if (deleted > 0) new Notice(formatChatsDeleteNotice(deleted));
      } finally {
        await loadChatHistory();
      }
    },
    [deleteChatAndBookmark, loadChatHistory, runWithNotice]
  );

  const setChatPinned = useCallback(
    async (id: string, pinned: boolean, pinnedAt?: number) => {
      // A dragged pin takes its new place in the frame it is dropped; waiting for the note write snaps it back first.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/811
      if (pinnedAt !== undefined) {
        setChatHistoryItems((items) =>
          items.map((item) => (item.id === id ? { ...item, pinnedAt } : item))
        );
      }
      try {
        await runWithNotice(
          pinned ? "pin chat" : "unpin chat",
          async () => {
            const chat = await manager.setChatPinned(id, pinned, pinnedAt);
            if (!isMountedRef.current) return;
            historyRequestRef.current++;
            // A reload right after the frontmatter write reads the metadata cache's previous pin state.
            // https://github.com/logancyang/obsidian-copilot/issues/3195
            setChatHistoryItems((items) =>
              items.map((item) =>
                item.id === id ? { ...item, id: chat.id, pinnedAt: chat.pinnedAt } : item
              )
            );
          },
          true
        );
      } catch {
        // A dropped pin whose write failed would keep an order that was never saved, and the next drag would build on it.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/811
        if (pinnedAt !== undefined) await loadChatHistory();
      }
    },
    [manager, loadChatHistory, runWithNotice]
  );

  const setChatArchived = useCallback(
    async (id: string, archived: boolean) => {
      await runWithNotice(
        archived ? "archive chat" : "unarchive chat",
        async () => {
          const chat = await manager.setChatArchived(id, archived);
          if (!isMountedRef.current) return;
          historyRequestRef.current++;
          // A reload right after the frontmatter write reads the metadata cache's previous archive state.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/805
          setChatHistoryItems((items) =>
            items.map((item) =>
              item.id === id ? { ...item, id: chat.id, archivedAt: chat.archivedAt } : item
            )
          );
        },
        true
      );
    },
    [manager, runWithNotice]
  );

  const archiveChats = useCallback(
    async (ids: readonly string[]) => {
      for (const id of ids) {
        // One chat that fails to archive shows its own notice and must not leave the rest of the selection behind.
        // https://github.com/logancyang/obsidian-copilot/issues/3553
        await setChatArchived(id, true).catch(() => undefined);
      }
    },
    [setChatArchived]
  );

  const openSourceFile = useCallback(
    async (id: string) => {
      await runWithNotice("open chat source", () => plugin.openChatSourceFile(id));
    },
    [plugin, runWithNotice]
  );

  // A row left on its native id after its note is saved would let Delete drop only the session entry and leave the note behind.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/699
  const replaceChatRowId = useCallback((id: string, notePath: string) => {
    if (notePath === id || !isMountedRef.current) return;
    setChatHistoryItems((items) =>
      items.map((item) => (item.id === id ? { ...item, id: notePath } : item))
    );
  }, []);

  const copyChatLink = useCallback(
    (id: string) =>
      plugin.copyChatLink(async () => {
        const notePath = await manager.ensureChatNote(id);
        replaceChatRowId(id, notePath);
        return notePath;
      }),
    [manager, plugin, replaceChatRowId]
  );

  const getChatBookmarkState = useCallback(
    async (id: string): Promise<ChatBookmarkState> => {
      const state = await runWithNotice("read bookmarks", async () => {
        const bookmarks = getUrlBookmarks(plugin.app);
        // A turned-off Bookmarks plugin still shows the item, so users can find the feature and how to enable it.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
        if (!bookmarks) return isBookmarksPluginDisabled(plugin.app) ? "off" : "unavailable";
        const link = await getChatLink(plugin.app, id);
        return link && bookmarks.has(link) ? "bookmarked" : "not-bookmarked";
      });
      return state ?? "unavailable";
    },
    [plugin, runWithNotice]
  );

  const setChatBookmarked = useCallback(
    async (id: string, title: string, bookmarked: boolean) => {
      await runWithNotice(bookmarked ? "bookmark chat" : "remove bookmark", async () => {
        const bookmarks = getUrlBookmarks(plugin.app);
        if (!bookmarks) throw new Error("The Bookmarks core plugin is not enabled.");
        // A bookmark opens the chat through its link, which only a saved note has.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
        const notePath = bookmarked ? await manager.ensureChatNote(id) : id;
        const link = await getChatLink(plugin.app, notePath);
        if (!link) throw new Error(`No chat link for "${notePath}".`);
        if (bookmarked) {
          bookmarks.add(link, title);
          new Notice("Bookmarked.");
        } else {
          bookmarks.remove(link);
          new Notice("Removed from bookmarks.");
        }
        replaceChatRowId(id, notePath);
      });
    },
    [manager, plugin, runWithNotice, replaceChatRowId]
  );

  const setActiveChatBookmarked = useCallback(
    async (bookmarked: boolean) => {
      await runWithNotice(bookmarked ? "bookmark chat" : "remove bookmark", async () => {
        const session = manager.getActiveSession();
        const label = session?.getLabel();
        // A native session link only opens on this device: https://github.com/Brevilabs/obsidian-copilot-private/issues/601
        // Removal needs only the saved note, so a failed resave must not keep the bookmark.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/702
        const path = bookmarked
          ? (await manager.saveActiveSession())?.path
          : session && manager.getSessionSourcePath(session.internalId);
        const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
        // A bookmark opens the chat through its note's link, so a chat that failed to save gets none.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/702
        if (!(file instanceof TFile)) throw new Error("The active chat has no saved note.");
        // A renamed tab keeps its title in the session label, which the note's topic and filename miss.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/702
        await setChatBookmarked(file.path, label ?? extractChatTitle(plugin.app, file), bookmarked);
      });
    },
    [manager, plugin, runWithNotice, setChatBookmarked]
  );

  return {
    chatHistoryItems: visibleChatHistoryItems,
    archivedChatItems,
    chatHistorySettled,
    loadChatHistory,
    loadChat,
    updateChatTitle,
    deleteChat,
    deleteChats,
    setChatPinned,
    setChatArchived,
    archiveChats,
    openSourceFile,
    copyChatLink,
    getChatBookmarkState,
    setChatBookmarked,
    setActiveChatBookmarked,
  };
}
