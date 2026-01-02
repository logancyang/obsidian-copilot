/**
 * useDiscussChat - React hook for Discuss chat integration
 *
 * Provides React state integration with DiscussChatState.
 * Follows useChatManager pattern.
 */

import { DiscussChatState } from "@/state/DiscussChatState";
import { DiscussMessage } from "@/types/discuss";
import { useCallback, useEffect, useState } from "react";
import { TFile } from "obsidian";

/**
 * React hook for integrating with DiscussChatState
 */
export function useDiscussChat(state: DiscussChatState) {
  const [messages, setMessages] = useState<DiscussMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [conversationTitle, setConversationTitle] = useState("");

  // Subscribe to state changes
  useEffect(() => {
    // Initial sync
    setMessages(state.getMessages());
    setIsStreaming(state.isCurrentlyStreaming());
    setStreamContent(state.getStreamContent());
    setConversationTitle(state.getConversationTitle());

    // Subscribe to updates
    const unsubscribe = state.subscribe(() => {
      setMessages(state.getMessages());
      setIsStreaming(state.isCurrentlyStreaming());
      setStreamContent(state.getStreamContent());
      setConversationTitle(state.getConversationTitle());
    });

    return unsubscribe;
  }, [state]);

  // Memoized callbacks
  const sendMessage = useCallback(
    async (text: string, forcedNotes: TFile[] = []) => {
      await state.sendMessage(text, forcedNotes);
    },
    [state]
  );

  const startNewConversation = useCallback(async () => {
    await state.startNewConversation();
  }, [state]);

  const loadConversation = useCallback(
    async (conversationId: string) => {
      await state.loadConversation(conversationId);
    },
    [state]
  );

  const renameConversation = useCallback(
    (title: string) => {
      state.setTitle(title);
    },
    [state]
  );

  const abortResponse = useCallback(() => {
    state.abortResponse();
  }, [state]);

  const generateSuggestedQuestions = useCallback(async () => {
    return state.generateSuggestedQuestions();
  }, [state]);

  return {
    // State
    messages,
    isStreaming,
    streamContent,
    conversationTitle,

    // Actions
    sendMessage,
    startNewConversation,
    loadConversation,
    renameConversation,
    abortResponse,
    generateSuggestedQuestions,
  };
}
