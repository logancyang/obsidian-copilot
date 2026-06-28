import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";
import { useCallback, useEffect, useRef, useState } from "react";

// Frozen empty slice returned while the loaded items belong to a different scope
// than the one currently requested — a stable reference avoids a render churn.
const EMPTY_CHAT_HISTORY_ITEMS = Object.freeze([]) as unknown as ChatHistoryItem[];

export interface AgentHistoryControls {
  chatHistoryItems: ChatHistoryItem[];
  /**
   * True once a history load for the CURRENT scope has settled — success or
   * failure. Lets the project landing wait for a real answer before deciding
   * what to render below the composer (anti-flash), instead of mistaking the
   * not-yet-loaded empty list for "this project has no chats". On failure the
   * list stays empty and this still flips true: the landing degrades to its
   * zero-chat layout rather than a permanent blank.
   */
  chatHistorySettled: boolean;
  loadChatHistory: () => Promise<void>;
  loadChat: (id: string) => Promise<void>;
  updateChatTitle: (id: string, newTitle: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  openSourceFile: (id: string) => Promise<void>;
}

/**
 * History popover handlers (load list, open, rename, delete, open source) plus
 * the items state they refresh. Kept separate from chat-runtime state because
 * these are user-initiated one-shots, not backend-stream reactions.
 *
 * `scope` selects which chats the list loads (and reloads after rename/delete):
 * a project id shows only that project's chats, the global workspace (default)
 * shows the flat all-chats view. Changing `scope` re-fetches, so switching
 * project re-scopes the section.
 */
export function useAgentHistoryControls(
  manager: AgentSessionManager,
  plugin: CopilotPlugin,
  scope?: ProjectScopeId
): AgentHistoryControls {
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);
  // Track which scope the loaded items belong to. On a scope change the prop
  // updates synchronously but `loadChatHistory` is async, so the stored items
  // briefly belong to the *previous* scope — hide them until the refetch lands
  // rather than flash another project's (or the global flat) chats.
  const effectiveScope = scope ?? GLOBAL_SCOPE;
  const [loadedScope, setLoadedScope] = useState<ProjectScopeId>(effectiveScope);
  const visibleChatHistoryItems =
    loadedScope === effectiveScope ? chatHistoryItems : EMPTY_CHAT_HISTORY_ITEMS;
  // Which scope has had a load SETTLE (success or failure). Deliberately a
  // separate state from `loadedScope`: that one starts at `effectiveScope` (so
  // the initial empty list is "visible"), which would misreport "already
  // loaded" before the first fetch ever ran.
  const [settledScope, setSettledScope] = useState<ProjectScopeId | null>(null);
  const chatHistorySettled = settledScope === effectiveScope;

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Latest requested scope, for dropping out-of-order loads: if the scope flips
  // while an older fetch is in flight, that fetch must NOT write back its (now
  // stale) items/scope after the newer fetch has already landed — otherwise the
  // current scope's list would be replaced by the previous scope's and stick.
  const latestScopeRef = useRef(effectiveScope);
  useEffect(() => {
    latestScopeRef.current = effectiveScope;
  }, [effectiveScope]);

  // Wrap an async action so a failure logs and surfaces a Notice consistently.
  // `rethrow` is on for callbacks the popover uses to revert inline edits
  // (rename, delete) and off for fire-and-forget loads.
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

  const loadChatHistory = useCallback(async () => {
    const requestScope = scope ?? GLOBAL_SCOPE;
    await runWithNotice("load chat history", async () => {
      const items = await manager.getChatHistoryItems(scope);
      // Drop a stale result whose scope was superseded while it was in flight.
      if (isMountedRef.current && latestScopeRef.current === requestScope) {
        setLoadedScope(requestScope);
        setChatHistoryItems(items);
      }
    });
    // Mark settled even when the fetch failed (runWithNotice swallows the
    // error): the items just stay as they were. Same staleness guard as above.
    if (isMountedRef.current && latestScopeRef.current === requestScope) {
      setSettledScope(requestScope);
    }
  }, [manager, runWithNotice, scope]);

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

  const deleteChat = useCallback(
    async (id: string) => {
      await runWithNotice(
        "delete chat",
        async () => {
          await manager.deleteChatHistory(id);
          await loadChatHistory();
        },
        true
      );
    },
    [manager, loadChatHistory, runWithNotice]
  );

  const openSourceFile = useCallback(
    async (id: string) => {
      await runWithNotice("open chat source", () => plugin.openChatSourceFile(id));
    },
    [plugin, runWithNotice]
  );

  return {
    chatHistoryItems: visibleChatHistoryItems,
    chatHistorySettled,
    loadChatHistory,
    loadChat,
    updateChatTitle,
    deleteChat,
    openSourceFile,
  };
}
