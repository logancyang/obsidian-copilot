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
import { ChainType } from "@/chainFactory";
import { processPrompt } from "@/commands/customCommandUtils";
import { ChatControls, reloadCurrentProject } from "@/components/chat-components/ChatControls";
import ChatInput from "@/components/chat-components/ChatInput";
import ChatMessages from "@/components/chat-components/ChatMessages";
import { NewVersionBanner } from "@/components/chat-components/NewVersionBanner";
import { ProjectList } from "@/components/chat-components/ProjectList";
import { ABORT_REASON, COMMAND_IDS, EVENT_NAMES, LOADING_MESSAGES, USER_SENDER } from "@/constants";
import { AppContext, EventTargetContext } from "@/context";
import { ChatManager } from "@/core/ChatManager";
import { MessageRepository } from "@/core/MessageRepository";
import { useChatManager } from "@/hooks/useChatManager";
import { getAIResponse } from "@/langchainStream";
import ChainManager from "@/LLMProviders/chainManager";
import CopilotPlugin from "@/main";
import { Mention } from "@/mentions/Mention";
import { useIsPlusUser } from "@/plusUtils";
import {
  getComposerOutputPrompt,
  getSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { ChatUIState } from "@/state/ChatUIState";
import { FileParserManager } from "@/tools/FileParserManager";
import { ChatMessage } from "@/types/message";
import { err2String, formatDateTime } from "@/utils";
import { Buffer } from "buffer";
import { Notice, TFile } from "obsidian";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";

type ChatMode = "default" | "project";

interface ChatProps {
  chainManager: ChainManager;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
  fileParserManager: FileParserManager;
  plugin: CopilotPlugin;
  mode?: ChatMode;
  pendingMessages?: ChatMessage[] | null;
  onPendingMessagesProcessed?: () => void;
}

const Chat: React.FC<ChatProps> = ({
  chainManager,
  onSaveChat,
  updateUserMessageHistory,
  fileParserManager,
  plugin,
  pendingMessages,
  onPendingMessagesProcessed,
}) => {
  const settings = useSettingsValue();
  const eventTarget = useContext(EventTargetContext);

  // Create new architecture instances
  const [chatUIState] = useState(() => {
    const messageRepo = new MessageRepository();
    const chatManager = new ChatManager(messageRepo, chainManager, fileParserManager, plugin);
    return new ChatUIState(chatManager);
  });

  const { messages: chatHistory, addMessage } = useChatManager(chatUIState);
  const [currentModelKey] = useModelKey();
  const [currentChain] = useChainType();
  const [currentAiMessage, setCurrentAiMessage] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES.DEFAULT);
  const [contextNotes, setContextNotes] = useState<TFile[]>([]);
  const [includeActiveNote, setIncludeActiveNote] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [showChatUI, setShowChatUI] = useState(false);
  const [selectedTextContexts] = useSelectedTextContexts();

  const [previousMode, setPreviousMode] = useState<ChainType | null>(null);
  const [selectedChain, setSelectedChain] = useChainType();
  const isPlusUser = useIsPlusUser();

  const mention = Mention.getInstance();

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleChatVisibility = () => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };
    eventTarget?.addEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);

    // Cleanup function
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);
    };
  }, [eventTarget]);

  const appContext = useContext(AppContext);
  const app = plugin.app || appContext;

  const handleSendMessage = async ({
    toolCalls,
    urls,
    contextNotes: passedContextNotes,
  }: {
    toolCalls?: string[];
    urls?: string[];
    contextNotes?: TFile[];
  } = {}) => {
    if (!inputMessage && selectedImages.length === 0) return;

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
        const base64Image = Buffer.from(imageData).toString("base64");
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
      const composerPrompt = await getComposerOutputPrompt();
      if (inputMessage.includes("@composer") && composerPrompt !== "") {
        displayText =
          inputMessage + "\n\n<output_format>\n" + composerPrompt + "\n</output_format>";
      }

      // Add tool calls if present
      if (toolCalls) {
        displayText += " " + toolCalls.join("\n");
      }

      // Create message context
      const context = {
        notes,
        urls: urls || [],
        selectedTextContexts,
      };

      // Clear input and images
      setInputMessage("");
      setSelectedImages([]);
      setLoading(true);
      setLoadingMessage(LOADING_MESSAGES.DEFAULT);

      // Send message through ChatManager (this handles all the complex context processing)
      const messageId = await chatUIState.sendMessage(
        displayText,
        context,
        currentChain,
        includeActiveNote
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
          setCurrentAiMessage,
          setAbortController,
          { debug: settings.debug, updateLoadingMessage: setLoadingMessage }
        );
      }

      // Autosave again after AI response
      if (settings.autosaveChat) {
        handleSaveAsNote();
      }
    } catch (error) {
      console.error("Error sending message:", error);
      new Notice("Failed to send message. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMessage(LOADING_MESSAGES.DEFAULT);
    }
  };

  const handleSaveAsNote = useCallback(async () => {
    if (!app) {
      console.error("App instance is not available.");
      return;
    }

    // Filter visible messages - use chatUIState to get the latest messages
    const visibleMessages = chatUIState.getMessages();

    if (visibleMessages.length === 0) {
      new Notice("No messages to save.");
      return;
    }

    // Get the epoch of the first message
    const firstMessageEpoch = visibleMessages[0].timestamp?.epoch || Date.now();

    // Format the chat content
    const chatContent = visibleMessages
      .map(
        (message) =>
          `**${message.sender}**: ${message.message}\n[Timestamp: ${message.timestamp?.display}]`
      )
      .join("\n\n");

    try {
      // Check if the default folder exists or create it
      const folder = app.vault.getAbstractFileByPath(settings.defaultSaveFolder);
      if (!folder) {
        await app.vault.createFolder(settings.defaultSaveFolder);
      }

      const { fileName: timestampFileName } = formatDateTime(new Date(firstMessageEpoch));

      // Get the first user message
      const firstUserMessage = visibleMessages.find((message) => message.sender === USER_SENDER);

      // Get the first 10 words from the first user message and sanitize them
      const firstTenWords = firstUserMessage
        ? firstUserMessage.message
            .split(/\s+/)
            .slice(0, 10)
            .join(" ")
            .replace(/[\\/:*?"<>|]/g, "") // Remove invalid filename characters
            .trim()
        : "Untitled Chat";

      // Parse the custom format and replace variables
      let customFileName = settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}";

      // Create the file name (limit to 100 characters to avoid excessively long names)
      customFileName = customFileName
        .replace("{$topic}", firstTenWords.slice(0, 100).replace(/\s+/g, "_"))
        .replace("{$date}", timestampFileName.split("_")[0])
        .replace("{$time}", timestampFileName.split("_")[1]);

      // Sanitize the final filename
      const sanitizedFileName = customFileName.replace(/[\\/:*?"<>|]/g, "_");

      // Add project ID as prefix for project-specific chat histories
      const currentProject = getCurrentProject();
      const filePrefix = currentProject ? `${currentProject.id}__` : "";
      const noteFileName = `${settings.defaultSaveFolder}/${filePrefix}${sanitizedFileName}.md`;

      // Add the timestamp, model, and project properties to the note content
      const noteContentWithTimestamp = `---
epoch: ${firstMessageEpoch}
modelKey: ${currentModelKey}
${currentProject ? `projectId: ${currentProject.id}` : ""}
${currentProject ? `projectName: ${currentProject.name}` : ""}
tags:
  - ${settings.defaultConversationTag}
---

${chatContent}`;

      // Check if the file already exists
      const existingFile = app.vault.getAbstractFileByPath(noteFileName);
      if (existingFile instanceof TFile) {
        // If the file exists, update its content
        await app.vault.modify(existingFile, noteContentWithTimestamp);
      } else {
        // If the file doesn't exist, create a new one
        await app.vault.create(noteFileName, noteContentWithTimestamp);
        new Notice(`Chat saved as note: ${noteFileName}`);
      }
    } catch (error) {
      console.error("Error saving chat as note:", err2String(error));
      new Notice("Failed to save chat as note. Check console for details.");
    }
  }, [
    app,
    chatUIState,
    currentModelKey,
    settings.defaultConversationTag,
    settings.defaultSaveFolder,
    settings.defaultConversationNoteName,
  ]);

  const handleStopGenerating = useCallback(
    (reason?: ABORT_REASON) => {
      if (abortController) {
        if (settings.debug) {
          console.log(`stopping generation..., reason: ${reason}`);
        }
        abortController.abort(reason);
        setLoading(false);
        setLoadingMessage(LOADING_MESSAGES.DEFAULT);
        // Keep the partial AI message visible
        // Don't clear setCurrentAiMessage here
      }
    },
    [abortController, settings.debug]
  );

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

      setLoading(true);
      try {
        const success = await chatUIState.regenerateMessage(
          messageToRegenerate.id!,
          setCurrentAiMessage,
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
        console.error("Error regenerating message:", error);
        new Notice("Failed to regenerate message. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [chatHistory, chatUIState, settings.debug, settings.autosaveChat, handleSaveAsNote, addMessage]
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
            setLoading(true);
            try {
              const llmMessage = chatUIState.getLLMMessage(messageToEdit.id!);
              if (llmMessage) {
                await getAIResponse(
                  llmMessage,
                  chainManager,
                  addMessage,
                  setCurrentAiMessage,
                  setAbortController,
                  { debug: settings.debug, updateLoadingMessage: setLoadingMessage }
                );
              }
            } catch (error) {
              console.error("Error regenerating AI response:", error);
              new Notice("Failed to regenerate AI response. Please try again.");
            } finally {
              setLoading(false);
            }
          }
        }

        // Autosave the chat if the setting is enabled
        if (settings.autosaveChat) {
          handleSaveAsNote();
        }
      } catch (error) {
        console.error("Error editing message:", error);
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
    ]
  );

  const createEffect = (
    eventType: string,
    promptFn: (selectedText: string, eventSubtype?: string) => string | Promise<string>
  ) => {
    return () => {
      const debug = getSettings().debug;
      const handleSelection = async (event: CustomEvent) => {
        const messageWithPrompt = await promptFn(
          event.detail.selectedText,
          event.detail.eventSubtype
        );

        // Send the prompt message through ChatManager (simplified approach)
        try {
          const messageId = await chatUIState.sendMessage(
            messageWithPrompt,
            { notes: [], urls: [], selectedTextContexts: [] },
            currentChain,
            includeActiveNote
          );

          // Get the LLM message for AI processing
          const llmMessage = chatUIState.getMessage(messageId);
          if (llmMessage) {
            setLoading(true);
            await getAIResponse(
              llmMessage,
              chainManager,
              addMessage,
              setCurrentAiMessage,
              setAbortController,
              {
                debug,
                ignoreSystemMessage: true,
              }
            );
            setLoading(false);
          }
        } catch (error) {
          console.error("Error processing adhoc prompt:", error);
          setLoading(false);
        }
      };

      eventTarget?.addEventListener(eventType, handleSelection);

      // Cleanup function to remove the event listener when the component unmounts
      return () => {
        eventTarget?.removeEventListener(eventType, handleSelection);
      };
    };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    createEffect(COMMAND_IDS.APPLY_ADHOC_PROMPT, async (selectedText, customPrompt) => {
      if (!customPrompt) {
        return selectedText;
      }
      const result = await processPrompt(
        customPrompt,
        selectedText,
        app.vault,
        app.workspace.getActiveFile()
      );
      return result.processedPrompt; // Extract just the processed prompt string
    }),
    []
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
            console.error("Error loading project context:", error);
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
            console.error("Error reloading project context:", error);
            new Notice(`${originP.name} updated but context reload failed`);
          });
      } else {
        new Notice(`${originP.name} updated successfully`);
      }

      return true;
    },
    [settings.projectList]
  );

  const handleInsertToChat = useCallback((prompt: string) => {
    setInputMessage((prev) => `${prev} ${prompt} `);
  }, []);

  const handleRemoveSelectedText = useCallback((id: string) => {
    removeSelectedTextContext(id);
  }, []);

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
        console.error("Error deleting message:", error);
        new Notice("Failed to delete message. Please try again.");
      }
    },
    [chatHistory, chatUIState]
  );

  const handleNewChat = useCallback(async () => {
    handleStopGenerating(ABORT_REASON.NEW_CHAT);

    // First autosave the current chat if the setting is enabled
    if (settings.autosaveChat) {
      await handleSaveAsNote();
    }

    // Clear messages through the new architecture
    chatUIState.clearMessages();

    // Additional UI state reset specific to this component
    setCurrentAiMessage("");
    setContextNotes([]);
    clearSelectedTextContexts();
    // Only modify includeActiveNote if in a non-COPILOT_PLUS_CHAIN mode
    // In COPILOT_PLUS_CHAIN mode, respect the settings.includeActiveNoteAsContext value
    if (selectedChain !== ChainType.COPILOT_PLUS_CHAIN) {
      setIncludeActiveNote(false);
    } else {
      setIncludeActiveNote(settings.includeActiveNoteAsContext);
    }
  }, [
    handleStopGenerating,
    chatUIState,
    settings.autosaveChat,
    settings.includeActiveNoteAsContext,
    selectedChain,
    handleSaveAsNote,
  ]);

  const handleLoadHistory = useCallback(() => {
    plugin.loadCopilotChatHistory();
  }, [plugin]);

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
      if (selectedChain === ChainType.COPILOT_PLUS_CHAIN) {
        setIncludeActiveNote(settings.includeActiveNoteAsContext);
      } else {
        // In other modes, always disable including active note
        setIncludeActiveNote(false);
      }
    }
  }, [settings.includeActiveNoteAsContext, selectedChain]);

  // Load pending messages when component initializes
  useEffect(() => {
    if (pendingMessages && pendingMessages.length > 0) {
      chatUIState.loadMessages(pendingMessages);
      onPendingMessagesProcessed?.();
    }
  }, [pendingMessages, chatUIState, onPendingMessagesProcessed]);

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
          onInsertToChat={handleInsertToChat}
          onReplaceChat={setInputMessage}
          showHelperComponents={selectedChain !== ChainType.PROJECT_CHAIN}
        />
        <ChatControls
          onNewChat={handleNewChat}
          onSaveAsNote={() => handleSaveAsNote()}
          onLoadHistory={handleLoadHistory}
          onModeChange={(newMode) => {
            setPreviousMode(selectedChain);
            // Hide chat UI when switching to project mode
            if (newMode === ChainType.PROJECT_CHAIN) {
              setShowChatUI(false);
            }
          }}
        />
        <ChatInput
          ref={inputRef}
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
          mention={mention}
          selectedImages={selectedImages}
          onAddImage={(files: File[]) => setSelectedImages((prev) => [...prev, ...files])}
          setSelectedImages={setSelectedImages}
          disableModelSwitch={selectedChain === ChainType.PROJECT_CHAIN}
          selectedTextContexts={selectedTextContexts}
          onRemoveSelectedText={handleRemoveSelectedText}
        />
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
                inputRef={inputRef}
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

export default Chat;
