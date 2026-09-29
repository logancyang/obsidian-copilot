import {
  clearSelectedTextContexts,
  getSelectedTextContexts,
  removeSelectedTextContext,
  useChainType,
  useModelKey,
  useSelectedTextContexts,
} from "@/aiParams";
import { resetSessionSystemPromptSettings } from "@/system-prompts";
import { logInfo, logError } from "@/logger";
import type { WebTabContext } from "@/types/message";

import { ChatControls } from "@/components/chat-components/ChatControls";
import ChatInput from "@/components/chat-components/ChatModeInput";
import ChatMessages, { isChatEmpty } from "@/components/chat-components/ChatMessages";
import { AgentModeBanner } from "@/components/chat-components/ui/AgentModeBanner";
import { useChatModelPicker } from "@/components/chat-components/useChatModelPicker";
import {
  ABORT_REASON,
  AI_SENDER,
  EVENT_NAMES,
  LOADING_MESSAGES,
  RESTRICTION_MESSAGES,
  USER_SENDER,
} from "@/constants";
import { AppContext, ChatViewEventTarget, EventTargetContext } from "@/context";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { useChatManager } from "@/hooks/useChatManager";
import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { getAIResponse } from "@/langchainStream";
import ChainManager from "@/LLMProviders/chainManager";
import { clearRecordedPromptPayload } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { logFileManager } from "@/logFileManager";
import CopilotPlugin from "@/main";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { ChatManagerChatUIState } from "@/state/ChatUIState";
import { FileParserManager } from "@/tools/FileParserManager";
import { ChatMessage } from "@/types/message";
import { err2String, isPlusChain, modelSupportsVision } from "@/utils";
import { arrayBufferToBase64 } from "@/utils/base64";
import { appendUniqueFiles } from "@/utils/fileListUtils";
import { Notice, TFile } from "obsidian";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { useActiveWebTabState } from "@/components/chat-components/hooks/useActiveWebTabState";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface ChatProps {
  chainManager: ChainManager;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
  fileParserManager: FileParserManager;
  plugin: CopilotPlugin;
  chatUIState: ChatManagerChatUIState;
}

const ChatInternal: React.FC<ChatProps & { chatInput: ReturnType<typeof useChatInput> }> = ({
  chainManager,
  onSaveChat,
  updateUserMessageHistory,
  fileParserManager,
  plugin,
  chatUIState,
  chatInput,
}) => {
  const settings = useSettingsValue();
  const eventTarget = useContext(EventTargetContext);

  const {
    messages: chatHistory,
    sourcePath,
    addMessage: rawAddMessage,
  } = useChatManager(chatUIState);
  const [currentModelKey, setCurrentModelKey] = useModelKey();
  const [currentChain] = useChainType();
  const chatModelPicker = useChatModelPicker({
    value: currentModelKey,
    onChange: setCurrentModelKey,
  });
  const [currentAiMessage, setCurrentAiMessage] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);

  const addMessage = useCallback(
    (message: ChatMessage) => {
      const streamingId = streamingMessageIdRef.current;
      const shouldAttachId =
        streamingId && message.sender === AI_SENDER && !message.isErrorMessage && !message.id;
      const messageToAdd = shouldAttachId ? { ...message, id: streamingId } : message;

      rawAddMessage(messageToAdd);
    },
    [rawAddMessage]
  );

  const setAbortController = useCallback((controller: AbortController | null) => {
    abortControllerRef.current = controller;
  }, []);

  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES.DEFAULT);
  const [contextNotes, setContextNotes] = useState<TFile[]>([]);
  const [includeActiveNote, setIncludeActiveNote] = useState(
    settings.autoAddActiveContentToContext === true
  );
  const [includeActiveWebTab, setIncludeActiveWebTab] = useState(
    settings.autoAddActiveContentToContext === true
  );
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);
  const isMountedRef = useRef(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleChatPointerDownCapture = useCallback((): void => {
    plugin.chatSelectionHighlightController.persistFromPointerDown();
  }, [plugin]);

  const safeSet = useMemo<{
    setCurrentAiMessage: (value: string) => void;
    setLoadingMessage: (value: string) => void;
    setLoading: (value: boolean) => void;
  }>(
    () => ({
      setCurrentAiMessage: (value: string) => isMountedRef.current && setCurrentAiMessage(value),
      setLoadingMessage: (value: string) => isMountedRef.current && setLoadingMessage(value),
      setLoading: (value: boolean) => isMountedRef.current && setLoading(value),
    }),
    []
  );

  const [selectedTextContexts] = useSelectedTextContexts();

  const hasAnySelection = selectedTextContexts.length > 0;
  const effectiveIncludeActiveWebTab = includeActiveWebTab && !hasAnySelection;

  const { activeWebTabForMentions: currentActiveWebTab } = useActiveWebTabState();

  const latestTokenCount = useMemo(() => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const m = chatHistory[i];
      if (m.sender === AI_SENDER) return m.responseMetadata?.tokenUsage?.totalTokens ?? null;
    }
    return null;
  }, [chatHistory]);

  const [selectedChain] = useChainType();

  const appContext = useContext(AppContext);
  const app = plugin.app || appContext;

  const handleAddImage = useCallback((files: File[]) => {
    setSelectedImages((prev) => appendUniqueFiles(prev, files));
  }, []);

  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes,
    setContextNotes,
    selectedImages,
    onAddImage: handleAddImage,
    containerRef: chatContainerRef,
  });

  const handleSendMessage = async ({
    toolCalls,
    urls,
    contextNotes: passedContextNotes,
    contextTags,
    contextFolders,
    webTabs,
  }: {
    toolCalls?: string[];
    urls?: string[];
    contextNotes?: TFile[];
    contextTags?: string[];
    contextFolders?: string[];
    webTabs?: WebTabContext[];
  } = {}) => {
    if (!inputMessage && selectedImages.length === 0) return;

    const hasUrlsInContext = urls && urls.length > 0;

    if (hasUrlsInContext && !isPlusChain(currentChain)) {
      new Notice(RESTRICTION_MESSAGES.URL_PROCESSING_RESTRICTED);
    }

    if (selectedImages.length > 0) {
      const activeModel = chatModelPicker.models.find(
        (m) => getModelKeyFromModel(m) === chatModelPicker.value
      );
      if (Array.isArray(activeModel?.capabilities) && !modelSupportsVision(activeModel)) {
        const modelLabel = activeModel.displayName || activeModel.name;
        new Notice(
          `${modelLabel} doesn't support images. Switch to a vision-capable model to send images.`
        );
        return;
      }
    }

    try {
      type MessageContentItem =
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } };
      const content: MessageContentItem[] = [];

      if (inputMessage) {
        content.push({
          type: "text",
          text: inputMessage,
        });
      }

      for (const image of selectedImages) {
        const imageData = await image.arrayBuffer();
        const base64Image = arrayBufferToBase64(imageData);
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${image.type};base64,${base64Image}`,
          },
        });
      }

      const allNotes = [...(passedContextNotes || []), ...contextNotes];
      const notes = allNotes.filter(
        (note, index, array) => array.findIndex((n) => n.path === note.path) === index
      );

      let displayText = inputMessage.trim();

      if (toolCalls) {
        displayText += " " + toolCalls.join("\n");
      }

      const context = {
        notes,
        urls: isPlusChain(currentChain) ? urls || [] : [],
        tags: contextTags || [],
        folders: contextFolders || [],
        selectedTextContexts,
        webTabs: webTabs || [],
      };

      setInputMessage("");
      setSelectedImages([]);
      streamingMessageIdRef.current = `msg-${uuidv4()}`;
      safeSet.setLoading(true);
      safeSet.setLoadingMessage(LOADING_MESSAGES.DEFAULT);

      const messageId = await chatUIState.sendMessage(
        displayText,
        context,
        currentChain,
        includeActiveNote,
        effectiveIncludeActiveWebTab,
        content.length > 0 ? content : undefined,
        safeSet.setLoadingMessage
      );

      if (inputMessage) {
        updateUserMessageHistory(inputMessage);
      }

      if (settings.autosaveChat) {
        await handleSaveAsNote();
      }

      const llmMessage = chatUIState.getLLMMessage(messageId);
      if (llmMessage) {
        await getAIResponse(
          llmMessage,
          chainManager,
          addMessage,
          safeSet.setCurrentAiMessage,
          setAbortController,
          { debug: settings.debug, updateLoadingMessage: safeSet.setLoadingMessage }
        );
      }

      if (settings.autosaveChat) {
        await handleSaveAsNote();
      }
    } catch (error) {
      logError("Error sending message:", error);
      new Notice("Failed to send message. Please try again.");
    } finally {
      safeSet.setLoading(false);
      safeSet.setLoadingMessage(LOADING_MESSAGES.DEFAULT);
      streamingMessageIdRef.current = null;
    }
  };

  const handleSaveAsNote = useCallback(async () => {
    if (!app) {
      logError("App instance is not available.");
      return;
    }

    try {
      await chatUIState.saveChat(currentModelKey);
    } catch (error) {
      logError("Error saving chat as note:", err2String(error));
      new Notice("Failed to save chat as note. Check console for details.");
    }
  }, [app, chatUIState, currentModelKey]);

  const handleStopGenerating = useCallback(
    (reason?: ABORT_REASON) => {
      if (abortControllerRef.current) {
        logInfo(`stopping generation..., reason: ${reason}`);
        abortControllerRef.current.abort(reason);
        safeSet.setLoading(false);
        safeSet.setLoadingMessage(LOADING_MESSAGES.DEFAULT);
      }
    },
    [safeSet]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort(ABORT_REASON.UNMOUNT);
      }
    };
  }, []);

  const handleRegenerate = useCallback(
    async (messageIndex: number) => {
      if (messageIndex <= 0) {
        new Notice("Cannot regenerate the first message.");
        return;
      }

      const messageToRegenerate = chatHistory[messageIndex];
      if (!messageToRegenerate) {
        new Notice("Message not found.");
        return;
      }

      safeSet.setCurrentAiMessage("");
      streamingMessageIdRef.current = `msg-${uuidv4()}`;
      safeSet.setLoading(true);
      try {
        const success = await chatUIState.regenerateMessage(
          messageToRegenerate.id!,
          safeSet.setCurrentAiMessage,
          addMessage
        );

        if (!success) {
          new Notice("Failed to regenerate message. Please try again.");
        } else if (settings.debug) {
          logInfo("Message regenerated successfully");
        }

        if (settings.autosaveChat) {
          await handleSaveAsNote();
        }
      } catch (error) {
        logError("Error regenerating message:", error);
        new Notice("Failed to regenerate message. Please try again.");
      } finally {
        safeSet.setLoading(false);
        streamingMessageIdRef.current = null;
      }
    },
    [
      chatHistory,
      chatUIState,
      settings.debug,
      settings.autosaveChat,
      handleSaveAsNote,
      addMessage,
      safeSet,
    ]
  );

  const handleEdit = useCallback(
    async (messageIndex: number, newMessage: string) => {
      const messageToEdit = chatHistory[messageIndex];
      if (!messageToEdit || messageToEdit.message === newMessage) {
        return;
      }

      try {
        // Inline edits keep their stored attachments; the composer may point at another note.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/465
        const success = await chatUIState.editMessage(
          messageToEdit.id!,
          newMessage,
          currentChain,
          false
        );

        if (!success) {
          new Notice("Failed to edit message. Please try again.");
          return;
        }

        if (messageToEdit.sender === USER_SENDER) {
          const hadAIResponses = messageIndex < chatHistory.length - 1;

          await chatUIState.truncateAfterMessageId(messageToEdit.id!);

          if (hadAIResponses) {
            streamingMessageIdRef.current = `msg-${uuidv4()}`;
            safeSet.setLoading(true);
            try {
              const llmMessage = chatUIState.getLLMMessage(messageToEdit.id!);
              if (llmMessage) {
                await getAIResponse(
                  llmMessage,
                  chainManager,
                  addMessage,
                  safeSet.setCurrentAiMessage,
                  setAbortController,
                  { debug: settings.debug, updateLoadingMessage: safeSet.setLoadingMessage }
                );
              }
            } catch (error) {
              logError("Error regenerating AI response:", error);
              new Notice("Failed to regenerate AI response. Please try again.");
            } finally {
              safeSet.setLoading(false);
              streamingMessageIdRef.current = null;
            }
          }
        }

        if (settings.autosaveChat) {
          await handleSaveAsNote();
        }
      } catch (error) {
        logError("Error editing message:", error);
        new Notice("Failed to edit message. Please try again.");
      }
    },
    [
      chatHistory,
      chatUIState,
      currentChain,
      addMessage,
      chainManager,
      settings.debug,
      settings.autosaveChat,
      handleSaveAsNote,
      safeSet,
      setAbortController,
    ]
  );

  useEffect(() => {
    if (onSaveChat) {
      onSaveChat(handleSaveAsNote);
    }
  }, [onSaveChat, handleSaveAsNote]);

  const handleRemoveSelectedText = useCallback(
    (id: string) => {
      const currentContexts = getSelectedTextContexts();
      const removed = currentContexts.find((ctx) => ctx.id === id);
      removeSelectedTextContext(id);

      if (removed?.sourceType === "web") {
        plugin.suppressCurrentWebSelection(removed.url);
      }
    },
    [plugin]
  );

  useEffect(() => {
    plugin.chatSelectionHighlightController.clearIfNoNoteContexts(selectedTextContexts);
  }, [selectedTextContexts, plugin]);

  useEffect(() => {
    const handleChatVisibility = () => {
      chatInput.focusInput();
    };
    eventTarget?.addEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);

    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);
    };
  }, [eventTarget, chatInput]);

  useEffect(() => {
    const bus = eventTarget instanceof ChatViewEventTarget ? eventTarget : null;
    const handleInsertText = (e: Event) => {
      bus?.consumePendingInsertText();
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof text === "string") chatInput.insertTextWithPills(text, true);
    };
    eventTarget?.addEventListener(EVENT_NAMES.INSERT_TEXT_TO_CHAT, handleInsertText);
    const pending = bus?.consumePendingInsertText();
    if (typeof pending === "string") chatInput.insertTextWithPills(pending, true);
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.INSERT_TEXT_TO_CHAT, handleInsertText);
    };
  }, [eventTarget, chatInput]);

  const handleDelete = useCallback(
    async (messageIndex: number) => {
      const messageToDelete = chatHistory[messageIndex];
      if (!messageToDelete) {
        new Notice("Message not found.");
        return;
      }

      try {
        const success = await chatUIState.deleteMessage(messageToDelete.id!);
        if (!success) {
          new Notice("Failed to delete message. Please try again.");
        }
      } catch (error) {
        logError("Error deleting message:", error);
        new Notice("Failed to delete message. Please try again.");
      }
    },
    [chatHistory, chatUIState]
  );

  const handleNewChat = useCallback(async () => {
    clearRecordedPromptPayload();
    await logFileManager.clear();
    handleStopGenerating(ABORT_REASON.NEW_CHAT);

    if (settings.enableRecentConversations) {
      try {
        const chatModel = chainManager.chatModelManager.getChatModel();
        plugin.userMemoryManager.addRecentConversation(chatUIState.getMessages(), chatModel);
      } catch (error) {
        logInfo("Failed to analyze chat messages for memory:", error);
      }
    }

    if (settings.autosaveChat) {
      await handleSaveAsNote();
    }

    chatUIState.clearMessages();

    resetSessionSystemPromptSettings();

    safeSet.setCurrentAiMessage("");
    setContextNotes([]);
    const webSelectionUrl = selectedTextContexts.find((ctx) => ctx.sourceType === "web")?.url;
    clearSelectedTextContexts();
    plugin.chatSelectionHighlightController.clearForNewChat();
    plugin.suppressCurrentWebSelection(webSelectionUrl);
    setIncludeActiveNote(settings.autoAddActiveContentToContext);
    setIncludeActiveWebTab(settings.autoAddActiveContentToContext);
  }, [
    handleStopGenerating,
    chainManager.chatModelManager,
    chatUIState,
    settings.autosaveChat,
    settings.enableRecentConversations,
    settings.autoAddActiveContentToContext,
    handleSaveAsNote,
    safeSet,
    plugin,
    selectedTextContexts,
  ]);

  const handleLoadChatHistory = useCallback(async () => {
    try {
      const historyItems = await plugin.getChatHistoryItems();
      setChatHistoryItems(historyItems);
    } catch (error) {
      logError("Error loading chat history:", error);
      new Notice("Failed to load chat history.");
    }
  }, [plugin]);

  const handleUpdateChatTitle = useCallback(
    async (id: string, newTitle: string) => {
      try {
        await plugin.updateChatTitle(id, newTitle);
        await handleLoadChatHistory();
      } catch (error) {
        logError("Error updating chat title:", error);
        new Notice("Failed to update chat title.");
        throw error;
      }
    },
    [plugin, handleLoadChatHistory]
  );

  const handleDeleteChat = useCallback(
    async (id: string) => {
      try {
        await plugin.deleteChatHistory(id);
        await handleLoadChatHistory();
      } catch (error) {
        logError("Error deleting chat:", error);
        new Notice("Failed to delete chat.");
        throw error;
      }
    },
    [plugin, handleLoadChatHistory]
  );

  const handleLoadChat = useCallback(
    async (id: string) => {
      try {
        await plugin.loadChatById(id);
        resetSessionSystemPromptSettings();
      } catch (error) {
        logError("Error loading chat:", error);
        new Notice("Failed to load chat.");
      }
    },
    [plugin]
  );

  const handleOpenSourceFile = useCallback(
    async (id: string) => {
      try {
        await plugin.openChatSourceFile(id);
      } catch (error) {
        logError("Error opening source file:", error);
        new Notice("Failed to open source file.");
      }
    },
    [plugin]
  );

  useEffect(() => {
    const handleAbortStream = (event: CustomEvent<{ reason?: ABORT_REASON }>) => {
      const reason = event.detail?.reason || ABORT_REASON.NEW_CHAT;
      handleStopGenerating(reason);
    };

    eventTarget?.addEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);

    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    };
  }, [eventTarget, handleStopGenerating]);

  const [prevAutoAddTuple, setPrevAutoAddTuple] = useState({
    autoAdd: settings.autoAddActiveContentToContext,
    chain: selectedChain,
  });
  if (
    prevAutoAddTuple.autoAdd !== settings.autoAddActiveContentToContext ||
    prevAutoAddTuple.chain !== selectedChain
  ) {
    setPrevAutoAddTuple({
      autoAdd: settings.autoAddActiveContentToContext,
      chain: selectedChain,
    });
    if (settings.autoAddActiveContentToContext !== undefined) {
      setIncludeActiveNote(settings.autoAddActiveContentToContext);
      setIncludeActiveWebTab(settings.autoAddActiveContentToContext);
    }
  }

  const renderChatComponents = () => (
    <>
      <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
        {isChatEmpty(chatHistory, currentAiMessage) && (
          <div className="tw-mx-auto tw-flex tw-w-full tw-max-w-lg tw-flex-1 tw-items-center tw-px-4">
            <AgentModeBanner onOpenAgent={safeAsyncHandler(() => plugin.activateAgentView())} />
          </div>
        )}
        <ChatMessages
          sourcePath={sourcePath}
          chatHistory={chatHistory}
          currentAiMessage={currentAiMessage}
          streamingMessageId={streamingMessageIdRef.current}
          loading={loading}
          loadingMessage={loadingMessage}
          app={app}
          onRegenerate={safeAsyncHandler(handleRegenerate)}
          onEdit={safeAsyncHandler(handleEdit)}
          onDelete={safeAsyncHandler(handleDelete)}
        />
        <ChatControls
          chatLinkId={sourcePath || undefined}
          onCopyChatLink={(id) => plugin.copyChatLink(id)}
          onNewChat={() => void handleNewChat()}
          onSaveAsNote={() => handleSaveAsNote()}
          onLoadHistory={() => void handleLoadChatHistory()}
          chatHistory={chatHistoryItems}
          onUpdateChatTitle={handleUpdateChatTitle}
          onDeleteChat={handleDeleteChat}
          onLoadChat={handleLoadChat}
          onOpenSourceFile={handleOpenSourceFile}
          latestTokenCount={latestTokenCount}
        />
        <ChatInput
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={safeAsyncHandler(handleSendMessage)}
          isGenerating={loading}
          onStopGenerating={() => handleStopGenerating(ABORT_REASON.USER_STOPPED)}
          app={app}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          includeActiveWebTab={includeActiveWebTab}
          setIncludeActiveWebTab={setIncludeActiveWebTab}
          activeWebTab={currentActiveWebTab}
          selectedImages={selectedImages}
          onAddImage={handleAddImage}
          setSelectedImages={setSelectedImages}
          modelPickerOverride={chatModelPicker}
          selectedTextContexts={selectedTextContexts}
          onRemoveSelectedText={handleRemoveSelectedText}
        />
      </div>
    </>
  );

  return (
    <div
      ref={chatContainerRef}
      onPointerDownCapture={handleChatPointerDownCapture}
      className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden"
    >
      <div className="tw-h-full">
        <div className="tw-relative tw-flex tw-h-full tw-flex-col">
          {isDragActive && (
            <div className="tw-absolute tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-dashed tw-bg-primary tw-opacity-80">
              <span>Drop files here...</span>
            </div>
          )}
          {renderChatComponents()}
        </div>
      </div>
    </div>
  );
};

const Chat: React.FC<ChatProps> = (props) => {
  return (
    <ChatInputProvider>
      <ChatWithContext {...props} />
    </ChatInputProvider>
  );
};

const ChatWithContext: React.FC<ChatProps> = (props) => {
  const chatInput = useChatInput();
  return <ChatInternal {...props} chatInput={chatInput} />;
};

export default Chat;
