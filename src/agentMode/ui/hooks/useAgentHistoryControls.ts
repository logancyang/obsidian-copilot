import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";
import { useCallback, useEffect, useRef, useState } from "react";

const EMPTY_CHAT_HISTORY_ITEMS = Object.freeze([]) as unknown as ChatHistoryItem[];

export interface AgentHistoryControls {
  chatHistoryItems: ChatHistoryItem[];
  chatHistorySettled: boolean;
  loadChatHistory: () => Promise<void>;
  loadChat: (id: string) => Promise<void>;
  updateChatTitle: (id: string, newTitle: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  openSourceFile: (id: string) => Promise<void>;
}
export function useAgentHistoryControls(
  manager: AgentSessionManager,
  plugin: CopilotPlugin,
  scope?: ProjectScopeId
): AgentHistoryControls {
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);
  const effectiveScope = scope ?? GLOBAL_SCOPE;
  const [loadedScope, setLoadedScope] = useState<ProjectScopeId>(effectiveScope);
  const visibleChatHistoryItems =
    loadedScope === effectiveScope ? chatHistoryItems : EMPTY_CHAT_HISTORY_ITEMS;
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

  const loadChatHistory = useCallback(async () => {
    const requestScope = scope ?? GLOBAL_SCOPE;
    await runWithNotice("load chat history", async () => {
      const items = await manager.getChatHistoryItems(scope);
      if (isMountedRef.current && latestScopeRef.current === requestScope) {
        setLoadedScope(requestScope);
        setChatHistoryItems(items);
      }
    });
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
      try {
        await runWithNotice(
          "delete chat",
          async () => {
            new Notice(await manager.deleteChatHistory(id));
          },
          true
        );
      } finally {
        await loadChatHistory();
      }
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
