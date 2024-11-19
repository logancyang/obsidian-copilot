import ChainManager from "@/LLMProviders/chainManager";
import { useAIState } from "@/aiState";
import { updateChatMemory } from "@/chatUtils";
import ChatInput from "@/components/ChatComponents/ChatInput";
import ChatMessages from "@/components/ChatComponents/ChatMessages";
import {
  ABORT_REASON,
  AI_SENDER,
  EVENT_NAMES,
  LOADING_MESSAGES,
  USER_SENDER,
  VAULT_VECTOR_STORE_STRATEGY,
} from "@/constants";
import { AppContext } from "@/context";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { getAIResponse } from "@/langchainStream";
import CopilotPlugin from "@/main";
import { Mention } from "@/mentions/Mention";
import { CopilotSettings } from "@/settings/SettingsPage";
import SharedState, { ChatMessage, useSharedState } from "@/sharedState";
import {
  createChangeToneSelectionPrompt,
  createTranslateSelectionPrompt,
  eli5SelectionPrompt,
  emojifyPrompt,
  fixGrammarSpellingSelectionPrompt,
  formatDateTime,
  glossaryPrompt,
  removeUrlsFromSelectionPrompt,
  rewriteLongerSelectionPrompt,
  rewritePressReleaseSelectionPrompt,
  rewriteShorterSelectionPrompt,
  rewriteTweetSelectionPrompt,
  rewriteTweetThreadSelectionPrompt,
  simplifyPrompt,
  summarizePrompt,
  tocPrompt,
} from "@/utils";
import { MarkdownView, Notice, TFile } from "obsidian";
import React, { useContext, useEffect, useState } from "react";

interface CreateEffectOptions {
  custom_temperature?: number;
  isVisible?: boolean;
  ignoreSystemMessage?: boolean;
}

interface ChatProps {
  sharedState: SharedState;
  settings: CopilotSettings;
  chainManager: ChainManager;
  emitter: EventTarget;
  defaultSaveFolder: string;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
  plugin: CopilotPlugin;
  debug: boolean;
}

const Chat: React.FC<ChatProps> = ({
  sharedState,
  settings,
  chainManager,
  emitter,
  defaultSaveFolder,
  onSaveChat,
  updateUserMessageHistory,
  plugin,
  debug,
}) => {
  const [chatHistory, addMessage, clearMessages] = useSharedState(sharedState);
  const [currentModelKey, setModelKey, currentChain, setChain, clearChatMemory] =
    useAIState(chainManager);
  const [currentAiMessage, setCurrentAiMessage] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES.DEFAULT);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [chatIsVisible, setChatIsVisible] = useState(false);
  const [contextNotes, setContextNotes] = useState<TFile[]>([]);
  const [includeActiveNote, setIncludeActiveNote] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);

  const mention = Mention.getInstance(plugin.settings.plusLicenseKey);

  useEffect(() => {
    const handleChatVisibility = (evt: CustomEvent<{ chatIsVisible: boolean }>) => {
      setChatIsVisible(evt.detail.chatIsVisible);
    };
    emitter.addEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);

    // Cleanup function
    return () => {
      emitter.removeEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);
    };
  }, []);

  const app = plugin.app || useContext(AppContext);

  const processContextNotes = async (customPromptProcessor: CustomPromptProcessor) => {
    // Get all variables that were processed by the custom prompt processor
    const processedVars = await customPromptProcessor.getProcessedVariables();
    const activeNote = app.workspace.getActiveFile();
    let additionalContext = "";

    // Process active note if included and not already processed
    if (includeActiveNote && activeNote) {
      const activeNoteVar = `activeNote`;
      const activeNotePath = `[[${activeNote.basename}]]`;

      if (!processedVars.has(activeNoteVar) && !processedVars.has(activeNotePath)) {
        const content = await app.vault.read(activeNote);
        additionalContext += `\n\nactiveNote:\n\n${activeNotePath}\n\n${content}`;
      }
    }

    // Process context notes that weren't already processed
    for (const note of contextNotes) {
      const notePath = `[[${note.basename}]]`;
      if (!processedVars.has(notePath)) {
        const content = await app.vault.read(note);
        additionalContext += `\n\n[[${note.basename}]]:\n\n${content}`;
      }
    }

    return additionalContext;
  };

  const handleSendMessage = async (toolCalls?: string[]) => {
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

    const userMessage: ChatMessage = {
      message: inputMessage || "Image message",
      originalMessage: inputMessage,
      sender: USER_SENDER,
      isVisible: true,
      timestamp: timestamp,
      content: content,
    };

    // Clear input and images
    setInputMessage("");
    setSelectedImages([]);

    // Add messages to chat history
    addMessage(userMessage);
    setLoading(true);
    setLoadingMessage(LOADING_MESSAGES.DEFAULT);

    // First, process the original user message for custom prompts
    const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault, settings);
    let processedUserMessage = await customPromptProcessor.processCustomPrompt(
      inputMessage || "",
      "",
      app.workspace.getActiveFile() as TFile | undefined
    );

    // Extract Mentions (such as URLs) from original input message only
    const mentionContextAddition = await mention.processMentions(inputMessage || "");

    // Add context notes
    const noteContextAddition = await processContextNotes(customPromptProcessor);

    // Combine everything in the correct order
    processedUserMessage = processedUserMessage + mentionContextAddition + noteContextAddition;

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
      { debug, updateLoadingMessage: setLoadingMessage }
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

  const handleSaveAsNote = async (openNote = false) => {
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
      const folder = app.vault.getAbstractFileByPath(defaultSaveFolder);
      if (!folder) {
        await app.vault.createFolder(defaultSaveFolder);
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

      // Create the file name (limit to 100 characters to avoid excessively long names)
      const sanitizedFileName = `${firstTenWords.slice(0, 100)}@${timestampFileName}`.replace(
        /\s+/g,
        "_"
      );
      const noteFileName = `${defaultSaveFolder}/${sanitizedFileName}.md`;

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
      console.error("Error saving chat as note:", error);
      new Notice("Failed to save chat as note. Check console for details.");
    }
  };

  const refreshVaultContext = async () => {
    if (!app) {
      console.error("App instance is not available.");
      return;
    }

    try {
      await plugin.vectorStoreManager.indexVaultToVectorStore();
      new Notice("Vault index refreshed.");
    } catch (error) {
      console.error("Error refreshing vault index:", error);
      new Notice("Failed to refresh vault index. Check console for details.");
    }
  };

  const clearCurrentAiMessage = () => {
    setCurrentAiMessage("");
  };

  const handleStopGenerating = (reason?: ABORT_REASON) => {
    if (abortController) {
      if (plugin.settings.debug) {
        console.log(`stopping generation..., reason: ${reason}`);
      }
      abortController.abort(reason);
      setLoading(false);
    }
  };

  const handleRegenerate = async (messageIndex: number) => {
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
        { debug }
      );
      if (regeneratedResponse && debug) {
        console.log("Message regenerated successfully");
      }
    } catch (error) {
      console.error("Error regenerating message:", error);
      new Notice("Failed to regenerate message. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (messageIndex: number, newMessage: string) => {
    const oldMessage = chatHistory[messageIndex].message;

    // Check if the message has actually changed
    if (oldMessage === newMessage) {
      return; // Exit the function if the message hasn't changed
    }

    const newChatHistory = [...chatHistory];
    newChatHistory[messageIndex].message = newMessage;
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
  };

  useEffect(() => {
    async function handleSelection(event: CustomEvent) {
      const wordCount = event.detail.selectedText.split(" ").length;
      const tokenCount = await chainManager.chatModelManager.countTokens(event.detail.selectedText);
      const tokenCountMessage: ChatMessage = {
        sender: AI_SENDER,
        message: `The selected text contains ${wordCount} words and ${tokenCount} tokens.`,
        isVisible: true,
        timestamp: formatDateTime(new Date()),
      };
      addMessage(tokenCountMessage);
    }

    emitter.addEventListener("countTokensSelection", handleSelection);

    // Cleanup function to remove the event listener when the component unmounts
    return () => {
      emitter.removeEventListener("countTokensSelection", handleSelection);
    };
  }, []);

  // Create an effect for each event type (Copilot command on selected text)
  const createEffect = (
    eventType: string,
    promptFn: (selectedText: string, eventSubtype?: string) => string | Promise<string>,
    options: CreateEffectOptions = {}
  ) => {
    return () => {
      const {
        isVisible = false,
        ignoreSystemMessage = true, // Ignore system message by default for commands
      } = options;
      const handleSelection = async (event: CustomEvent) => {
        const messageWithPrompt = await promptFn(
          event.detail.selectedText,
          event.detail.eventSubtype
        );
        // Create a user message with the selected text
        const promptMessage: ChatMessage = {
          message: messageWithPrompt,
          sender: USER_SENDER,
          isVisible: isVisible,
          timestamp: formatDateTime(new Date()),
        };

        if (isVisible) {
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
            ignoreSystemMessage,
          }
        );
        setLoading(false);
      };

      emitter.addEventListener(eventType, handleSelection);

      // Cleanup function to remove the event listener when the component unmounts
      return () => {
        emitter.removeEventListener(eventType, handleSelection);
      };
    };
  };

  useEffect(createEffect("fixGrammarSpellingSelection", fixGrammarSpellingSelectionPrompt), []);
  useEffect(createEffect("summarizeSelection", summarizePrompt), []);
  useEffect(createEffect("tocSelection", tocPrompt), []);
  useEffect(createEffect("glossarySelection", glossaryPrompt), []);
  useEffect(createEffect("simplifySelection", simplifyPrompt), []);
  useEffect(createEffect("emojifySelection", emojifyPrompt), []);
  useEffect(createEffect("removeUrlsFromSelection", removeUrlsFromSelectionPrompt), []);
  useEffect(
    createEffect("rewriteTweetSelection", rewriteTweetSelectionPrompt, { custom_temperature: 0.2 }),
    []
  );
  useEffect(
    createEffect("rewriteTweetThreadSelection", rewriteTweetThreadSelectionPrompt, {
      custom_temperature: 0.2,
    }),
    []
  );
  useEffect(createEffect("rewriteShorterSelection", rewriteShorterSelectionPrompt), []);
  useEffect(createEffect("rewriteLongerSelection", rewriteLongerSelectionPrompt), []);
  useEffect(createEffect("eli5Selection", eli5SelectionPrompt), []);
  useEffect(createEffect("rewritePressReleaseSelection", rewritePressReleaseSelectionPrompt), []);
  useEffect(
    createEffect("translateSelection", (selectedText, language) =>
      createTranslateSelectionPrompt(language)(selectedText)
    ),
    []
  );
  useEffect(
    createEffect("changeToneSelection", (selectedText, tone) =>
      createChangeToneSelectionPrompt(tone)(selectedText)
    ),
    []
  );

  const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault, settings);
  useEffect(
    createEffect(
      "applyCustomPrompt",
      async (selectedText, customPrompt) => {
        if (!customPrompt) {
          return selectedText;
        }
        return await customPromptProcessor.processCustomPrompt(
          customPrompt,
          selectedText,
          app.workspace.getActiveFile() as TFile | undefined
        );
      },
      { isVisible: debug, ignoreSystemMessage: true, custom_temperature: 0.1 }
    ),
    []
  );

  useEffect(
    createEffect(
      "applyAdhocPrompt",
      async (selectedText, customPrompt) => {
        if (!customPrompt) {
          return selectedText;
        }
        return await customPromptProcessor.processCustomPrompt(
          customPrompt,
          selectedText,
          app.workspace.getActiveFile() as TFile | undefined
        );
      },
      { isVisible: debug, ignoreSystemMessage: true, custom_temperature: 0.1 }
    ),
    []
  );

  const handleInsertAtCursor = async (message: string) => {
    let leaf = app.workspace.getMostRecentLeaf();
    if (!leaf) {
      new Notice("No active leaf found.");
      return;
    }

    if (!(leaf.view instanceof MarkdownView)) {
      leaf = app.workspace.getLeaf(false);
      await leaf.setViewState({ type: "markdown", state: leaf.view.getState() });
    }

    if (!(leaf.view instanceof MarkdownView)) {
      new Notice("Failed to open a markdown view.");
      return;
    }

    const editor = leaf.view.editor;
    const cursor = editor.getCursor();
    editor.replaceRange(message, cursor);
    new Notice("Message inserted into the active note.");
  };

  // Expose handleSaveAsNote to parent
  useEffect(() => {
    if (onSaveChat) {
      onSaveChat(handleSaveAsNote);
    }
  }, [onSaveChat]);

  const handleDelete = async (messageIndex: number) => {
    const newChatHistory = [...chatHistory];
    newChatHistory.splice(messageIndex, 1);
    clearMessages();
    newChatHistory.forEach(addMessage);

    // Update the chain's memory with the new chat history
    await updateChatMemory(newChatHistory, chainManager.memoryManager);
  };

  return (
    <div className="chat-container">
      <ChatMessages
        currentChain={currentChain}
        chatHistory={chatHistory}
        currentAiMessage={currentAiMessage}
        indexVaultToVectorStore={settings.indexVaultToVectorStore as VAULT_VECTOR_STORE_STRATEGY}
        loading={loading}
        loadingMessage={loadingMessage}
        app={app}
        onInsertAtCursor={handleInsertAtCursor}
        onRegenerate={handleRegenerate}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onSelectSuggestedPrompt={(prompt) => {
          setInputMessage(prompt);
        }}
      />
      <div className="bottom-container">
        <ChatInput
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={handleSendMessage}
          isGenerating={loading}
          onStopGenerating={() => handleStopGenerating(ABORT_REASON.USER_STOPPED)}
          app={app}
          settings={settings}
          navigateHistory={navigateHistory}
          chatIsVisible={chatIsVisible}
          currentModelKey={currentModelKey}
          setCurrentModelKey={setModelKey}
          currentChain={currentChain}
          setCurrentChain={setChain}
          onNewChat={async (openNote: boolean) => {
            handleStopGenerating(ABORT_REASON.NEW_CHAT);
            if (settings.autosaveChat && chatHistory.length > 0) {
              await handleSaveAsNote(openNote);
            }
            clearMessages();
            clearChatMemory();
            clearCurrentAiMessage();
          }}
          onSaveAsNote={() => handleSaveAsNote(true)}
          onRefreshVaultContext={refreshVaultContext}
          vault_qa_strategy={plugin.settings.indexVaultToVectorStore}
          addMessage={addMessage}
          vault={app.vault}
          isIndexLoadedPromise={plugin.vectorStoreManager.getIsIndexLoaded()}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          mention={mention}
          selectedImages={selectedImages}
          onAddImage={(files: File[]) => setSelectedImages((prev) => [...prev, ...files])}
          setSelectedImages={setSelectedImages}
          debug={debug}
        />
      </div>
    </div>
  );
};

export default Chat;
