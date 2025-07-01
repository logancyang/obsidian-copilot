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
import { updateChatMemory } from "@/chatUtils";
import { processPrompt } from "@/commands/customCommandUtils";
import { ChatControls, reloadCurrentProject } from "@/components/chat-components/ChatControls";
import ChatInput from "@/components/chat-components/ChatInput";
import ChatMessages from "@/components/chat-components/ChatMessages";
import { NewVersionBanner } from "@/components/chat-components/NewVersionBanner";
import { ProjectList } from "@/components/chat-components/ProjectList";
import { ABORT_REASON, COMMAND_IDS, EVENT_NAMES, LOADING_MESSAGES, USER_SENDER } from "@/constants";
import { AppContext, EventTargetContext } from "@/context";
import { ContextProcessor } from "@/contextProcessor";
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
import SharedState, { ChatMessage, useSharedState } from "@/sharedState";
import { FileParserManager } from "@/tools/FileParserManager";
import { err2String, formatDateTime } from "@/utils";
import { Buffer } from "buffer";
import { Notice, TFile } from "obsidian";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";

type ChatMode = "default" | "project";

interface ChatProps {
  sharedState: SharedState;
  chainManager: ChainManager;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
  fileParserManager: FileParserManager;
  plugin: CopilotPlugin;
  mode?: ChatMode;
}

const Chat: React.FC<ChatProps> = ({
  sharedState,
  chainManager,
  onSaveChat,
  updateUserMessageHistory,
  fileParserManager,
  plugin,
}) => {
  const settings = useSettingsValue();
  const eventTarget = useContext(EventTargetContext);
  const [chatHistory, addMessage, clearMessages] = useSharedState(sharedState);
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

  const contextProcessor = ContextProcessor.getInstance();
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
    contextNotes: passedContextNotes, // Rename to avoid shadowing
  }: {
    toolCalls?: string[];
    urls?: string[];
    contextNotes?: TFile[];
  } = {}) => {
    if (!inputMessage && selectedImages.length === 0) return;

    const timestamp = formatDateTime(new Date());

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

    const notes = [...(passedContextNotes || [])];
    const activeNote = app.workspace.getActiveFile();
    // Only include active note if not in Project mode
    if (
      includeActiveNote &&
      selectedChain !== ChainType.PROJECT_CHAIN &&
      activeNote &&
      !notes.some((note) => note.path === activeNote.path)
    ) {
      notes.push(activeNote);
    }

    const userMessage: ChatMessage = {
      message: inputMessage || "Image message",
      originalMessage: inputMessage,
      sender: USER_SENDER,
      isVisible: true,
      timestamp: timestamp,
      content: content,
      context: {
        notes,
        urls: urls || [],
        selectedTextContexts,
      },
    };

    // Clear input and images
    setInputMessage("");
    setSelectedImages([]);

    // Add messages to chat history
    addMessage(userMessage);
    setLoading(true);
    setLoadingMessage(LOADING_MESSAGES.DEFAULT);

    // First, add composer instruction if necessary
    let processedInputMessage = inputMessage;
    const composerPrompt = await getComposerOutputPrompt();
    if (inputMessage.includes("@composer") && composerPrompt !== "") {
      processedInputMessage =
        inputMessage + "\n\n<output_format>\n" + composerPrompt + "\n</output_format>";
    }
    // process the original user message for custom prompts
    const { processedPrompt: processedUserMessage, includedFiles } = await processPrompt(
      processedInputMessage || "",
      "",
      app.vault,
      app.workspace.getActiveFile()
    );

    // Extract Mentions (such as URLs) from original input message only if using Copilot Plus chain
    const urlContextAddition =
      currentChain === ChainType.COPILOT_PLUS_CHAIN
        ? await mention.processUrls(inputMessage || "")
        : { urlContext: "", imageUrls: [] };

    // Create set of file paths that were included in the custom prompt
    const excludedNotePaths = new Set(includedFiles.map((file) => file.path));

    // Add context notes, excluding those already processed by custom prompt
    const noteContextAddition = await contextProcessor.processContextNotes(
      excludedNotePaths,
      fileParserManager,
      app.vault,
      notes,
      includeActiveNote,
      activeNote,
      currentChain
    );

    // Process selected text contexts
    const selectedTextContextAddition = contextProcessor.processSelectedTextContexts();

    // Combine everything
    const finalProcessedMessage =
      processedUserMessage +
      urlContextAddition.urlContext +
      noteContextAddition +
      selectedTextContextAddition;

    let messageWithToolCalls = inputMessage;
    // Add tool calls last
    if (toolCalls) {
      messageWithToolCalls += " " + toolCalls.join("\n");
    }

    const promptMessageHidden: ChatMessage = {
      message: finalProcessedMessage,
      originalMessage: messageWithToolCalls,
      sender: USER_SENDER,
      isVisible: false,
      timestamp: timestamp,
      content: content,
      context: {
        notes,
        urls:
          currentChain === ChainType.COPILOT_PLUS_CHAIN
            ? [...(urls || []), ...urlContextAddition.imageUrls]
            : urls || [],
        selectedTextContexts,
      },
    };

    // Add hidden user message to chat history
    addMessage(promptMessageHidden);

    // Add to user message history if there's text
    if (inputMessage) {
      updateUserMessageHistory(inputMessage);
    }

    // Autosave the chat if the setting is enabled
    if (settings.autosaveChat) {
      handleSaveAsNote();
    }

    await getAIResponse(
      promptMessageHidden,
      chainManager,
      addMessage,
      setCurrentAiMessage,
      setAbortController,
      { debug: settings.debug, updateLoadingMessage: setLoadingMessage }
    );
    // Autosave the chat if the setting is enabled
    if (settings.autosaveChat) {
      handleSaveAsNote();
    }
    setLoading(false);
    setLoadingMessage(LOADING_MESSAGES.DEFAULT);
  };

  const handleSaveAsNote = useCallback(async () => {
    if (!app) {
      console.error("App instance is not available.");
      return;
    }

    // Filter visible messages - use sharedState directly to ensure we get the latest messages
    const visibleMessages = sharedState.getMessages().filter((message) => message.isVisible);

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
${currentProject ? `  - project-${currentProject.name}` : ""}
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
    sharedState,
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
      const lastUserMessageIndex = messageIndex - 1;

      if (lastUserMessageIndex < 0 || chatHistory[lastUserMessageIndex].sender !== USER_SENDER) {
        new Notice("Cannot regenerate the first message or a user message.");
        return;
      }

      // Get the last user message
      const lastUserMessage = chatHistory[lastUserMessageIndex];

      // Remove all messages after the AI message to regenerate
      const newChatHistory = chatHistory.slice(0, messageIndex);
      clearMessages();
      newChatHistory.forEach(addMessage);

      // Update the chain's memory with the new chat history
      chainManager.memoryManager.clearChatMemory();
      for (let i = 0; i < newChatHistory.length; i += 2) {
        const userMsg = newChatHistory[i];
        const aiMsg = newChatHistory[i + 1];
        if (userMsg && aiMsg) {
          await chainManager.memoryManager
            .getMemory()
            .saveContext({ input: userMsg.message }, { output: aiMsg.message });
        }
      }

      setLoading(true);
      try {
        const regeneratedResponse = await chainManager.runChain(
          lastUserMessage,
          new AbortController(),
          setCurrentAiMessage,
          addMessage,
          { debug: settings.debug }
        );
        if (regeneratedResponse && settings.debug) {
          console.log("Message regenerated successfully");
        }
      } catch (error) {
        console.error("Error regenerating message:", error);
        new Notice("Failed to regenerate message. Please try again.");
      } finally {
        setLoading(false);
      }

      // Autosave the chat if the setting is enabled
      if (settings.autosaveChat) {
        handleSaveAsNote();
      }
    },
    [
      addMessage,
      chainManager,
      chatHistory,
      clearMessages,
      settings.debug,
      settings.autosaveChat,
      handleSaveAsNote,
    ]
  );

  const handleEdit = useCallback(
    async (messageIndex: number, newMessage: string) => {
      const oldMessage = chatHistory[messageIndex].message;

      // Check if the message has actually changed
      if (oldMessage === newMessage) {
        return;
      }

      const newChatHistory = [...chatHistory];

      // Find and update all related messages (both visible and hidden)
      for (let i = messageIndex; i < newChatHistory.length; i++) {
        if (newChatHistory[i].originalMessage === oldMessage) {
          newChatHistory[i].message = newMessage;
          newChatHistory[i].originalMessage = newMessage;
          newChatHistory[i].context = { notes: [], urls: [] };
        }
      }

      clearMessages();
      newChatHistory.forEach(addMessage);

      // Update the chain's memory with the new chat history
      await updateChatMemory(newChatHistory, chainManager.memoryManager);

      // Trigger regeneration of the AI message if the edited message was from the user
      if (
        newChatHistory[messageIndex].sender === USER_SENDER &&
        messageIndex < newChatHistory.length - 1
      ) {
        handleRegenerate(messageIndex + 1);
      }

      // Autosave the chat if the setting is enabled
      if (settings.autosaveChat) {
        handleSaveAsNote();
      }
    },
    [
      addMessage,
      chainManager.memoryManager,
      chatHistory,
      clearMessages,
      handleRegenerate,
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
        // Create a user message with the selected text
        const promptMessage: ChatMessage = {
          message: messageWithPrompt,
          sender: USER_SENDER,
          isVisible: debug,
          timestamp: formatDateTime(new Date()),
        };

        if (debug) {
          addMessage(promptMessage);
        }

        setLoading(true);
        await getAIResponse(
          promptMessage,
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

  const handleDelete = useCallback(
    async (messageIndex: number) => {
      const newChatHistory = [...chatHistory];
      newChatHistory.splice(messageIndex, 1);
      clearMessages();
      newChatHistory.forEach(addMessage);

      // Update the chain's memory with the new chat history
      await updateChatMemory(newChatHistory, chainManager.memoryManager);
    },
    [addMessage, chainManager.memoryManager, chatHistory, clearMessages]
  );

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

  const handleNewChat = useCallback(async () => {
    handleStopGenerating(ABORT_REASON.NEW_CHAT);
    // Delegate to the shared plugin method for consistent behavior
    await plugin.handleNewChat();

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
  }, [handleStopGenerating, plugin, settings.includeActiveNoteAsContext, selectedChain]);

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
