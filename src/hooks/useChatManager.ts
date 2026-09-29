import { useCallback, useEffect, useState } from "react";
import { logError } from "@/logger";
import { ChainType } from "@/chainType";
import { ChatMessage, MessageContext } from "@/types/message";
import { ChatUIState } from "@/state/ChatUIState";

export function useChatManager(chatUIState: ChatUIState) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    setMessages([...chatUIState.getMessages()]);

    const unsubscribe = chatUIState.subscribe(() => {
      setMessages([...chatUIState.getMessages()]);
    });

    return unsubscribe;
  }, [chatUIState]);

  const sendMessage = useCallback(
    async (
      displayText: string,
      context: MessageContext,
      chainType: ChainType,
      includeActiveNote: boolean = false,
      includeActiveWebTab: boolean = false
    ): Promise<string> => {
      return await chatUIState.sendMessage(
        displayText,
        context,
        chainType,
        includeActiveNote,
        includeActiveWebTab
      );
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

  const addMessage = useCallback(
    (message: ChatMessage): void => {
      chatUIState.addMessage(message);
    },
    [chatUIState]
  );

  const loadMessages = useCallback(
    (messages: ChatMessage[]): void => {
      void chatUIState.loadMessages(messages).catch((err) => logError("loadMessages failed", err));
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

  return {
    messages,
    sourcePath: chatUIState.getSourcePath(),

    sendMessage,
    editMessage,
    regenerateMessage,
    deleteMessage,
    addMessage,
    clearMessages,
    truncateAfterMessageId,

    loadMessages,
    getMessage,
    getLLMMessages,
    getDebugInfo,
  };
}
