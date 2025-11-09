import { useCallback, useEffect, useReducer } from "react";
import { ChainType } from "@/chainFactory";
import { ChatMessage, MessageContext } from "@/types/message";
import { ChatUIState } from "@/state/ChatUIState";

/**
 * React hook for using ChatManager through ChatUIState
 *
 * This provides a clean React integration that:
 * - Manages local state synchronization with forced re-renders
 * - Provides memoized callback functions
 * - Handles subscriptions and cleanup
 * - Maintains compatibility with existing Chat component API
 */
export function useChatManager(chatUIState: ChatUIState) {
  // Use reducer to force re-renders on external state changes
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Subscribe to state changes and force re-render
  useEffect(() => {
    // Subscribe to updates
    const unsubscribe = chatUIState.subscribe(() => {
      // Force a re-render which will call getMessages() below
      forceUpdate();
    });

    return unsubscribe;
  }, [chatUIState]);

  // Always get fresh messages on each render
  // This ensures we always have the latest data
  const messages = chatUIState.getMessages();

  // ================================
  // MESSAGE OPERATIONS
  // ================================

  const sendMessage = useCallback(
    async (
      displayText: string,
      context: MessageContext,
      chainType: ChainType,
      includeActiveNote: boolean = false
    ): Promise<string> => {
      return await chatUIState.sendMessage(displayText, context, chainType, includeActiveNote);
    },
    [chatUIState]
  );

  const editMessage = useCallback(
    async (
      messageId: string,
      newText: string,
      chainType: ChainType,
      includeActiveNote: boolean = false
    ): Promise<boolean> => {
      return await chatUIState.editMessage(messageId, newText, chainType, includeActiveNote);
    },
    [chatUIState]
  );

  const regenerateMessage = useCallback(
    async (
      messageId: string,
      onUpdateCurrentMessage: (message: string) => void,
      onAddMessage: (message: ChatMessage) => void
    ): Promise<boolean> => {
      return await chatUIState.regenerateMessage(messageId, onUpdateCurrentMessage, onAddMessage);
    },
    [chatUIState]
  );

  const deleteMessage = useCallback(
    async (messageId: string): Promise<boolean> => {
      return await chatUIState.deleteMessage(messageId);
    },
    [chatUIState]
  );

  const clearMessages = useCallback((): void => {
    chatUIState.clearMessages();
  }, [chatUIState]);

  const truncateAfterMessageId = useCallback(
    async (messageId: string): Promise<void> => {
      await chatUIState.truncateAfterMessageId(messageId);
    },
    [chatUIState]
  );

  // ================================
  // COMPATIBILITY
  // ================================

  // For compatibility with existing Chat component
  const addMessage = useCallback(
    (message: ChatMessage): void => {
      chatUIState.addMessage(message);
    },
    [chatUIState]
  );

  // ================================
  // ADVANCED OPERATIONS
  // ================================

  const loadMessages = useCallback(
    (messages: ChatMessage[]): void => {
      chatUIState.loadMessages(messages);
    },
    [chatUIState]
  );

  const getMessage = useCallback(
    (id: string): ChatMessage | undefined => {
      return chatUIState.getMessage(id);
    },
    [chatUIState]
  );

  const getLLMMessages = useCallback((): ChatMessage[] => {
    return chatUIState.getLLMMessages();
  }, [chatUIState]);

  const getDebugInfo = useCallback(() => {
    return chatUIState.getDebugInfo();
  }, [chatUIState]);

  // ================================
  // RETURN API
  // ================================

  return {
    // Core state
    messages,

    // Modern API
    sendMessage,
    editMessage,
    regenerateMessage,
    deleteMessage,
    addMessage,
    clearMessages,
    truncateAfterMessageId,

    // Advanced operations
    loadMessages,
    getMessage,
    getLLMMessages,
    getDebugInfo,
  };
}
