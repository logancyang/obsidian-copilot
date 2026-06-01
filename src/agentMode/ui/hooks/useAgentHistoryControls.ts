import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";
import { useCallback, useEffect, useRef, useState } from "react";

export interface AgentHistoryControls {
  chatHistoryItems: ChatHistoryItem[];
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
 */
export function useAgentHistoryControls(
  manager: AgentSessionManager,
  plugin: CopilotPlugin
): AgentHistoryControls {
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
    await runWithNotice("load chat history", async () => {
      const items = await manager.getChatHistoryItems();
      if (isMountedRef.current) setChatHistoryItems(items);
    });
  }, [manager, runWithNotice]);

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
    chatHistoryItems,
    loadChatHistory,
    loadChat,
    updateChatTitle,
    deleteChat,
    openSourceFile,
  };
}
