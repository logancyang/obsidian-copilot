import {
  clearSelectedTextContexts,
  getCurrentProject,
  ProjectConfig,
  removeSelectedTextContext,
  setCurrentProject,
  useChainType,
  useModelKey,
  useSelectedTextContexts,
} from "@/aiParams";
import { resetSessionSystemPromptSettings } from "@/system-prompts";
import { ChainType } from "@/chainFactory";
import { useProjectContextStatus } from "@/hooks/useProjectContextStatus";
import { logInfo, logError } from "@/logger";

import { ChatControls, reloadCurrentProject } from "@/components/chat-components/ChatControls";
import ChatInput from "@/components/chat-components/ChatInput";
import ChatMessages from "@/components/chat-components/ChatMessages";
import { NewVersionBanner } from "@/components/chat-components/NewVersionBanner";
import { ProjectList } from "@/components/chat-components/ProjectList";
import ProgressCard from "@/components/project/progress-card";
import {
  ABORT_REASON,
  AI_SENDER,
  EVENT_NAMES,
  LOADING_MESSAGES,
  RESTRICTION_MESSAGES,
  USER_SENDER,
} from "@/constants";
import { AppContext, EventTargetContext } from "@/context";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { useChatManager } from "@/hooks/useChatManager";
import { getAIResponse } from "@/langchainStream";
import ChainManager from "@/LLMProviders/chainManager";
import { clearRecordedPromptPayload } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import CopilotPlugin from "@/main";
import { useIsPlusUser } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { ChatUIState } from "@/state/ChatUIState";
import { FileParserManager } from "@/tools/FileParserManager";
import { ChatMessage } from "@/types/message";
import { err2String, isPlusChain } from "@/utils";
import { arrayBufferToBase64 } from "@/utils/base64";
import { Notice, TFile } from "obsidian";
import { ContextManageModal } from "@/components/modals/project/context-manage-modal";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";

type ChatMode = "default" | "project";

interface ChatProps {
  chainManager: ChainManager;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
  fileParserManager: FileParserManager;
  plugin: CopilotPlugin;
  mode?: ChatMode;
  chatUIState: ChatUIState;
}

// Internal component that has access to the ChatInput context
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

  const { messages: chatHistory, addMessage: rawAddMessage } = useChatManager(chatUIState);
  const [currentModelKey] = useModelKey();
  const [currentChain] = useChainType();
  const [currentAiMessage, setCurrentAiMessage] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [latestTokenCount, setLatestTokenCount] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Wrapper for addMessage that tracks token usage from AI responses
  const addMessage = useCallback(
    (message: ChatMessage) => {
      rawAddMessage(message);
      // Track token usage from AI messages
      if (message.sender === AI_SENDER && message.responseMetadata?.tokenUsage?.totalTokens) {
        setLatestTokenCount(message.responseMetadata.tokenUsage.totalTokens);
      }
    },
    [rawAddMessage]
  );

  // Function to set the abort controller ref (for getAIResponse compatibility)
  const setAbortController = useCallback((controller: AbortController | null) => {
    abortControllerRef.current = controller;
  }, []);

  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES.DEFAULT);
  const [contextNotes, setContextNotes] = useState<TFile[]>([]);
  const [includeActiveNote, setIncludeActiveNote] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [showChatUI, setShowChatUI] = useState(false);
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);
  // null: keep default behavior; true: show; false: hide
  const [progressCardVisible, setProgressCardVisible] = useState<boolean | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(false);

  // Safe setter utilities - automatically wrap state setters to prevent updates after unmount
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
  const projectContextStatus = useProjectContextStatus();

  // Calculate whether to show ProgressCard based on status and user preference
  const shouldShowProgressCard = () => {
    if (selectedChain !== ChainType.PROJECT_CHAIN) return false;

    // If user has explicitly set visibility, respect that choice
    if (progressCardVisible !== null) {
      return progressCardVisible;
    }

    // Default behavior: show for loading/error, hide for success
    return projectContextStatus === "loading" || projectContextStatus === "error";
  };

  // Reset user preference when status changes to allow default behavior
  useEffect(() => {
    setProgressCardVisible(null);
  }, [projectContextStatus]);

  // Clear token count when chat is cleared or replaced (e.g., loading chat history)
  useEffect(() => {
    if (chatHistory.length === 0) {
      setLatestTokenCount(null);
    }
  }, [chatHistory]);

  const [previousMode, setPreviousMode] = useState<ChainType | null>(null);
  const [selectedChain, setSelectedChain] = useChainType();
  const isPlusUser = useIsPlusUser();

  const appContext = useContext(AppContext);
  const app = plugin.app || appContext;

  const handleSendMessage = async ({
    toolCalls,
    urls,
    contextNotes: passedContextNotes,
    contextTags,
    contextFolders,
  }: {
    toolCalls?: string[];
    urls?: string[];
    contextNotes?: TFile[];
    contextTags?: string[];
    contextFolders?: string[];
  } = {}) => {
    if (!inputMessage && selectedImages.length === 0) return;

    // Check for URL restrictions in non-Plus chains and show notice, but continue processing
    const hasUrlsInContext = urls && urls.length > 0;

    if (hasUrlsInContext && !isPlusChain(currentChain)) {
      // Show notice but continue processing the message without URL context
      new Notice(RESTRICTION_MESSAGES.URL_PROCESSING_RESTRICTED);
    }

    try {
      // Create message content array
      const content: any[] = [];

      // Add text content if present
      if (inputMessage) {
        content.push({
          type: "text",
          text: inputMessage,
        });
      }

      // Add images if present
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

      // Prepare context notes and deduplicate by path
      const allNotes = [...(passedContextNotes || []), ...contextNotes];
      const notes = allNotes.filter(
        (note, index, array) => array.findIndex((n) => n.path === note.path) === index
      );

      // Handle composer prompt
      let displayText = inputMessage;

      // Add tool calls if present
      if (toolCalls) {
        displayText += " " + toolCalls.join("\n");
      }

      // Create message context - filter out URLs for non-Plus chains
      const context = {
        notes,
        urls: isPlusChain(currentChain) ? urls || [] : [],
        tags: contextTags || [],
        folders: contextFolders || [],
        selectedTextContexts,
      };

      // Clear input and images
      setInputMessage("");
      setSelectedImages([]);
      safeSet.setLoading(true);
      safeSet.setLoadingMessage(LOADING_MESSAGES.DEFAULT);

      // Send message through ChatManager (this handles all the complex context processing)
      const messageId = await chatUIState.sendMessage(
        displayText,
        context,
        currentChain,
        includeActiveNote,
        content.length > 0 ? content : undefined
      );

      // Add to user message history
      if (inputMessage) {
        updateUserMessageHistory(inputMessage);
      }

      // Autosave if enabled
      if (settings.autosaveChat) {
        handleSaveAsNote();
      }

      // Get the LLM message for AI processing
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

      // Autosave again after AI response
      if (settings.autosaveChat) {
        handleSaveAsNote();
      }
    } catch (error) {
      logError("Error sending message:", error);
      new Notice("Failed to send message. Please try again.");
    } finally {
      safeSet.setLoading(false);
      safeSet.setLoadingMessage(LOADING_MESSAGES.DEFAULT);
    }
  };

  const handleSaveAsNote = useCallback(async () => {
    if (!app) {
      logError("App instance is not available.");
      return;
    }

    try {
      // Use the new ChatManager persistence functionality
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
        // Keep the partial AI message visible
        // Don't clear setCurrentAiMessage here
      }
    },
    [safeSet]
  );

  // Cleanup on unmount - abort any ongoing streaming
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any ongoing streaming when component unmounts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort(ABORT_REASON.UNMOUNT);
      }
    };
  }, []); // No dependencies - only run on mount/unmount

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

      // Clear current AI message and set loading state
      safeSet.setCurrentAiMessage("");
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
          console.log("Message regenerated successfully");
        }

        // Autosave the chat if the setting is enabled
        if (settings.autosaveChat) {
          handleSaveAsNote();
        }
      } catch (error) {
        logError("Error regenerating message:", error);
        new Notice("Failed to regenerate message. Please try again.");
      } finally {
        safeSet.setLoading(false);
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
        const success = await chatUIState.editMessage(
          messageToEdit.id!,
          newMessage,
          currentChain,
          includeActiveNote
        );

        if (!success) {
          new Notice("Failed to edit message. Please try again.");
          return;
        }

        // For user messages, immediately truncate any AI responses and regenerate
        if (messageToEdit.sender === USER_SENDER) {
          // Check if there were AI responses after this message
          const hadAIResponses = messageIndex < chatHistory.length - 1;

          // Truncate all messages after this user message (removes old AI responses)
          await chatUIState.truncateAfterMessageId(messageToEdit.id!);

          // If there were AI responses, generate new ones
          if (hadAIResponses) {
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
            }
          }
        }

        // Autosave the chat if the setting is enabled
        if (settings.autosaveChat) {
          handleSaveAsNote();
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
      includeActiveNote,
      addMessage,
      chainManager,
      settings.debug,
      settings.autosaveChat,
      handleSaveAsNote,
      safeSet,
      setAbortController,
    ]
  );

  // Expose handleSaveAsNote to parent
  useEffect(() => {
    if (onSaveChat) {
      onSaveChat(handleSaveAsNote);
    }
  }, [onSaveChat, handleSaveAsNote]);

  const handleAddProject = useCallback(
    (project: ProjectConfig) => {
      const currentProjects = settings.projectList || [];
      const existingIndex = currentProjects.findIndex((p) => p.name === project.name);

      if (existingIndex >= 0) {
        throw new Error(`Project "${project.name}" already exists, please use a different name`);
      }

      const newProjectList = [...currentProjects, project];
      updateSetting("projectList", newProjectList);

      // Check if this project is now the current project
      const currentProject = getCurrentProject();
      if (currentProject?.id === project.id) {
        // Reload the project context for the newly added project
        reloadCurrentProject()
          .then(() => {
            new Notice(`${project.name} added and context loaded`);
          })
          .catch((error: Error) => {
            logError("Error loading project context:", error);
            new Notice(`${project.name} added but context loading failed`);
          });
      } else {
        new Notice(`${project.name} added successfully`);
      }

      return true;
    },
    [settings.projectList]
  );

  const handleEditProject = useCallback(
    (originP: ProjectConfig, updateP: ProjectConfig) => {
      const currentProjects = settings.projectList || [];
      const existingProject = currentProjects.find((p) => p.name === originP.name);

      if (!existingProject) {
        throw new Error(`Project "${originP.name}" does not exist`);
      }

      const newProjectList = currentProjects.map((p) => (p.name === originP.name ? updateP : p));
      updateSetting("projectList", newProjectList);

      // If this is the current project, update the current project atom
      const currentProject = getCurrentProject();
      if (currentProject?.id === originP.id) {
        setCurrentProject(updateP);

        // Reload the project context
        reloadCurrentProject()
          .then(() => {
            new Notice(`${originP.name} updated and context reloaded`);
          })
          .catch((error: Error) => {
            logError("Error reloading project context:", error);
            new Notice(`${originP.name} updated but context reload failed`);
          });
      } else {
        new Notice(`${originP.name} updated successfully`);
      }

      return true;
    },
    [settings.projectList]
  );

  const handleRemoveSelectedText = useCallback((id: string) => {
    removeSelectedTextContext(id);
  }, []);

  useEffect(() => {
    const handleChatVisibility = () => {
      chatInput.focusInput();
    };
    eventTarget?.addEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);

    // Cleanup function
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);
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
    handleStopGenerating(ABORT_REASON.NEW_CHAT);

    // Analyze chat messages for memory if enabled
    if (settings.enableRecentConversations) {
      try {
        // Get the current chat model from the chain manager
        const chatModel = chainManager.chatModelManager.getChatModel();
        plugin.userMemoryManager.addRecentConversation(chatUIState.getMessages(), chatModel);
      } catch (error) {
        logInfo("Failed to analyze chat messages for memory:", error);
      }
    }

    // First autosave the current chat if the setting is enabled
    if (settings.autosaveChat) {
      await handleSaveAsNote();
    }

    // Clear messages through the new architecture
    chatUIState.clearMessages();

    // Reset all session-level system prompt settings to global defaults
    resetSessionSystemPromptSettings();

    // Additional UI state reset specific to this component
    safeSet.setCurrentAiMessage("");
    setContextNotes([]);
    setLatestTokenCount(null); // Clear token count on new chat
    clearSelectedTextContexts();
    // Respect the includeActiveNote setting for all non-project chains
    if (selectedChain === ChainType.PROJECT_CHAIN) {
      setIncludeActiveNote(false);
    } else {
      setIncludeActiveNote(settings.includeActiveNoteAsContext);
    }
  }, [
    handleStopGenerating,
    chainManager.chatModelManager,
    chatUIState,
    settings.autosaveChat,
    settings.enableRecentConversations,
    settings.includeActiveNoteAsContext,
    selectedChain,
    handleSaveAsNote,
    safeSet,
    plugin.userMemoryManager,
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
        await handleLoadChatHistory(); // Refresh the list
      } catch (error) {
        logError("Error updating chat title:", error);
        new Notice("Failed to update chat title.");
        throw error; // Re-throw to let the popover handle the error state
      }
    },
    [plugin, handleLoadChatHistory]
  );

  const handleDeleteChat = useCallback(
    async (id: string) => {
      try {
        await plugin.deleteChatHistory(id);
        await handleLoadChatHistory(); // Refresh the list
      } catch (error) {
        logError("Error deleting chat:", error);
        new Notice("Failed to delete chat.");
        throw error; // Re-throw to let the popover handle the error state
      }
    },
    [plugin, handleLoadChatHistory]
  );

  const handleLoadChat = useCallback(
    async (id: string) => {
      try {
        await plugin.loadChatById(id);
        // Reset all session-level system prompt settings to global defaults when loading a chat
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

  // Event listener for abort stream events
  useEffect(() => {
    const handleAbortStream = (event: CustomEvent) => {
      const reason = event.detail?.reason || ABORT_REASON.NEW_CHAT;
      handleStopGenerating(reason);
    };

    eventTarget?.addEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);

    // Cleanup function
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    };
  }, [eventTarget, handleStopGenerating]);

  // Use the includeActiveNoteAsContext setting
  useEffect(() => {
    if (settings.includeActiveNoteAsContext !== undefined) {
      // Only apply the setting if not in Project mode
      if (selectedChain === ChainType.PROJECT_CHAIN) {
        setIncludeActiveNote(false);
      } else {
        setIncludeActiveNote(settings.includeActiveNoteAsContext);
      }
    }
  }, [settings.includeActiveNoteAsContext, selectedChain]);

  // Note: pendingMessages loading has been removed as ChatManager now handles
  // message persistence and loading automatically based on project context

  const renderChatComponents = () => (
    <>
      <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
        <NewVersionBanner currentVersion={plugin.manifest.version} />
        <ChatMessages
          chatHistory={chatHistory}
          currentAiMessage={currentAiMessage}
          loading={loading}
          loadingMessage={loadingMessage}
          app={app}
          onRegenerate={handleRegenerate}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReplaceChat={setInputMessage}
          showHelperComponents={selectedChain !== ChainType.PROJECT_CHAIN}
        />
        {shouldShowProgressCard() ? (
          <div className="tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-rounded-xl">
            <ProgressCard
              plugin={plugin}
              setHiddenCard={() => {
                setProgressCardVisible(false);
              }}
              onEditContext={() => {
                const currentProject = getCurrentProject();
                if (currentProject) {
                  // Open the context management modal for editing the project
                  new ContextManageModal(
                    app,
                    (updatedProject) => {
                      handleEditProject(currentProject, updatedProject);
                    },
                    currentProject
                  ).open();
                }
              }}
            />
          </div>
        ) : (
          <>
            <ChatControls
              onNewChat={handleNewChat}
              onSaveAsNote={() => handleSaveAsNote()}
              onLoadHistory={handleLoadChatHistory}
              onModeChange={(newMode) => {
                setPreviousMode(selectedChain);
                // Hide chat UI when switching to project mode
                if (newMode === ChainType.PROJECT_CHAIN) {
                  setShowChatUI(false);
                }
              }}
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
              handleSendMessage={handleSendMessage}
              isGenerating={loading}
              onStopGenerating={() => handleStopGenerating(ABORT_REASON.USER_STOPPED)}
              app={app}
              contextNotes={contextNotes}
              setContextNotes={setContextNotes}
              includeActiveNote={includeActiveNote}
              setIncludeActiveNote={setIncludeActiveNote}
              selectedImages={selectedImages}
              onAddImage={(files: File[]) => setSelectedImages((prev) => [...prev, ...files])}
              setSelectedImages={setSelectedImages}
              disableModelSwitch={selectedChain === ChainType.PROJECT_CHAIN}
              selectedTextContexts={selectedTextContexts}
              onRemoveSelectedText={handleRemoveSelectedText}
              showProgressCard={() => {
                setProgressCardVisible(true);
              }}
            />
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div className="tw-h-full">
        <div className="tw-relative tw-flex tw-h-full tw-flex-col">
          {selectedChain === ChainType.PROJECT_CHAIN && (
            <div className={`${selectedChain === ChainType.PROJECT_CHAIN ? "tw-z-modal" : ""}`}>
              <ProjectList
                projects={settings.projectList || []}
                defaultOpen={true}
                app={app}
                hasMessages={false}
                onProjectAdded={handleAddProject}
                onEditProject={handleEditProject}
                onClose={() => {
                  if (previousMode) {
                    setSelectedChain(previousMode);
                    setPreviousMode(null);
                  } else {
                    // default back to chat or plus mode
                    setSelectedChain(
                      isPlusUser ? ChainType.COPILOT_PLUS_CHAIN : ChainType.LLM_CHAIN
                    );
                  }
                }}
                showChatUI={(v) => setShowChatUI(v)}
                onProjectClose={() => {
                  setProgressCardVisible(null);
                }}
              />
            </div>
          )}
          {(selectedChain !== ChainType.PROJECT_CHAIN ||
            (selectedChain === ChainType.PROJECT_CHAIN && showChatUI)) &&
            renderChatComponents()}
        </div>
      </div>
    </div>
  );
};

// Main Chat component with context provider
const Chat: React.FC<ChatProps> = (props) => {
  return (
    <ChatInputProvider>
      <ChatWithContext {...props} />
    </ChatInputProvider>
  );
};

// Chat component that uses context
const ChatWithContext: React.FC<ChatProps> = (props) => {
  const chatInput = useChatInput();
  return <ChatInternal {...props} chatInput={chatInput} />;
};

export default Chat;
