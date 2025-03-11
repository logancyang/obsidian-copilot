import { useChainType, useModelKey } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { updateChatMemory } from "@/chatUtils";
import { ChatControls } from "@/components/chat-components/ChatControls";
import ChatInput from "@/components/chat-components/ChatInput";
import ChatMessages from "@/components/chat-components/ChatMessages";
import { ABORT_REASON, COMMAND_IDS, EVENT_NAMES, LOADING_MESSAGES, USER_SENDER } from "@/constants";
import { AppContext, EventTargetContext } from "@/context";
import { ContextProcessor } from "@/contextProcessor";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { getAIResponse } from "@/langchainStream";
import ChainManager from "@/LLMProviders/chainManager";
import CopilotPlugin from "@/main";
import { Mention } from "@/mentions/Mention";
import { resetComposerPromptCache } from "@/composerUtils";
import { getSettings, useSettingsValue } from "@/settings/model";
import SharedState, { ChatMessage, useSharedState } from "@/sharedState";
import { FileParserManager } from "@/tools/FileParserManager";
import { err2String, formatDateTime } from "@/utils";
import { Notice, TFile } from "obsidian";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";

interface ChatProps {
  sharedState: SharedState;
  chainManager: ChainManager;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
  fileParserManager: FileParserManager;
  plugin: CopilotPlugin;
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
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [contextNotes, setContextNotes] = useState<TFile[]>([]);
  const [includeActiveNote, setIncludeActiveNote] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);

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

  const processContextNotes = async (
    customPromptProcessor: CustomPromptProcessor,
    fileParserManager: FileParserManager
  ) => {
    const activeNote = app.workspace.getActiveFile();
    return await contextProcessor.processContextNotes(
      customPromptProcessor,
      fileParserManager,
      app.vault,
      contextNotes,
      includeActiveNote,
      activeNote,
      currentChain
    );
  };

  const handleSendMessage = async ({
    toolCalls,
    urls,
    contextNotes,
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

    const notes = [...(contextNotes || [])];
    const activeNote = app.workspace.getActiveFile();
    if (includeActiveNote && activeNote && !notes.some((note) => note.path === activeNote.path)) {
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
      },
    };

    // Clear input and images
    setInputMessage("");
    setSelectedImages([]);

    // Add messages to chat history
    addMessage(userMessage);
    setLoading(true);
    setLoadingMessage(LOADING_MESSAGES.DEFAULT);

    // First, process the original user message for custom prompts
    const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);
    let processedUserMessage = await customPromptProcessor.processCustomPrompt(
      inputMessage || "",
      "",
      app.workspace.getActiveFile() as TFile | undefined
    );

    // Extract Mentions (such as URLs) from original input message only if using Copilot Plus chain
    const urlContextAddition =
      currentChain === ChainType.COPILOT_PLUS_CHAIN
        ? await mention.processUrls(inputMessage || "")
        : { urlContext: "", imageUrls: [] };

    // Add context notes
    const noteContextAddition = await processContextNotes(customPromptProcessor, fileParserManager);

    // Combine everything
    processedUserMessage =
      processedUserMessage + urlContextAddition.urlContext + noteContextAddition;

    let messageWithToolCalls = inputMessage;
    // Add tool calls last
    if (toolCalls) {
      messageWithToolCalls += " " + toolCalls.join("\n");
    }

    const promptMessageHidden: ChatMessage = {
      message: processedUserMessage,
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
      },
    };

    // Add hidden user message to chat history
    addMessage(promptMessageHidden);

    // Add to user message history if there's text
    if (inputMessage) {
      updateUserMessageHistory(inputMessage);
      setHistoryIndex(-1);
    }

    await getAIResponse(
      promptMessageHidden,
      chainManager,
      addMessage,
      setCurrentAiMessage,
      setAbortController,
      { debug: settings.debug, updateLoadingMessage: setLoadingMessage }
    );
    setLoading(false);
    setLoadingMessage(LOADING_MESSAGES.DEFAULT);
  };

  const navigateHistory = (direction: "up" | "down"): string => {
    const history = plugin.userMessageHistory;
    if (direction === "up" && historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      return history[history.length - 1 - historyIndex - 1];
    } else if (direction === "down" && historyIndex > -1) {
      setHistoryIndex(historyIndex - 1);
      return historyIndex === 0 ? "" : history[history.length - 1 - historyIndex + 1];
    }
    return inputMessage;
  };

  const handleSaveAsNote = useCallback(
    async (openNote = false) => {
      if (!app) {
        console.error("App instance is not available.");
        return;
      }

      // Filter visible messages
      const visibleMessages = chatHistory.filter((message) => message.isVisible);

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
        const noteFileName = `${settings.defaultSaveFolder}/${sanitizedFileName}.md`;

        // Add the timestamp and model properties to the note content
        const noteContentWithTimestamp = `---
epoch: ${firstMessageEpoch}
modelKey: ${currentModelKey}
tags:
  - ${settings.defaultConversationTag}
---

${chatContent}`;

        // Check if the file already exists
        const existingFile = app.vault.getAbstractFileByPath(noteFileName);
        if (existingFile instanceof TFile) {
          // If the file exists, update its content
          await app.vault.modify(existingFile, noteContentWithTimestamp);
          new Notice(`Chat updated in existing note: ${noteFileName}`);
        } else {
          // If the file doesn't exist, create a new one
          await app.vault.create(noteFileName, noteContentWithTimestamp);
          new Notice(`Chat saved as new note: ${noteFileName}`);
        }

        if (openNote) {
          const file = app.vault.getAbstractFileByPath(noteFileName);
          if (file instanceof TFile) {
            const leaf = app.workspace.getLeaf();
            leaf.openFile(file);
          }
        }
      } catch (error) {
        console.error("Error saving chat as note:", err2String(error));
        new Notice("Failed to save chat as note. Check console for details.");
      }
    },
    [
      app,
      chatHistory,
      currentModelKey,
      settings.defaultConversationTag,
      settings.defaultSaveFolder,
      settings.defaultConversationNoteName,
    ]
  );

  const handleStopGenerating = useCallback(
    (reason?: ABORT_REASON) => {
      if (abortController) {
        if (settings.debug) {
          console.log(`stopping generation..., reason: ${reason}`);
        }
        abortController.abort(reason);
        setLoading(false);
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
    },
    [addMessage, chainManager, chatHistory, clearMessages, settings.debug]
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
    },
    [addMessage, chainManager.memoryManager, chatHistory, clearMessages, handleRegenerate]
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

  const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    createEffect(COMMAND_IDS.APPLY_CUSTOM_PROMPT, async (selectedText, customPrompt) => {
      if (!customPrompt) {
        return selectedText;
      }
      return await customPromptProcessor.processCustomPrompt(
        customPrompt,
        selectedText,
        app.workspace.getActiveFile() ?? undefined
      );
    }),
    []
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    createEffect(COMMAND_IDS.APPLY_ADHOC_PROMPT, async (selectedText, customPrompt) => {
      if (!customPrompt) {
        return selectedText;
      }
      return await customPromptProcessor.processCustomPrompt(
        customPrompt,
        selectedText,
        app.workspace.getActiveFile() as TFile | undefined
      );
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

  const handleInsertToChat = useCallback((prompt: string) => {
    setInputMessage((prev) => `${prev} ${prompt} `);
  }, []);

  const handleNewChat = useCallback(async () => {
    handleStopGenerating(ABORT_REASON.NEW_CHAT);
    if (settings.autosaveChat && chatHistory.length > 0) {
      await handleSaveAsNote(true);
    }
    clearMessages();
    chainManager.memoryManager.clearChatMemory();
    // Reset the composer prompt cache when starting a new chat
    resetComposerPromptCache();
    setCurrentAiMessage("");
    setContextNotes([]);
    setIncludeActiveNote(false);
  }, [
    handleStopGenerating,
    settings.autosaveChat,
    chatHistory.length,
    clearMessages,
    chainManager.memoryManager,
    handleSaveAsNote,
  ]);

  return (
    <div className="chat-container">
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
      />
      <div className="bottom-container">
        <ChatControls onNewChat={handleNewChat} onSaveAsNote={() => handleSaveAsNote(true)} />
        <ChatInput
          ref={inputRef}
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={handleSendMessage}
          isGenerating={loading}
          onStopGenerating={() => handleStopGenerating(ABORT_REASON.USER_STOPPED)}
          app={app}
          navigateHistory={navigateHistory}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          mention={mention}
          selectedImages={selectedImages}
          onAddImage={(files: File[]) => setSelectedImages((prev) => [...prev, ...files])}
          setSelectedImages={setSelectedImages}
        />
      </div>
    </div>
  );
};

export default Chat;
