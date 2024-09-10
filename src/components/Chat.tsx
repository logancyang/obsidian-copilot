import ChainManager from "@/LLMProviders/chainManager";
import { useAIState } from "@/aiState";
import { ChainType } from "@/chainFactory";
import ChatIcons from "@/components/ChatComponents/ChatIcons";
import ChatInput from "@/components/ChatComponents/ChatInput";
import ChatMessages from "@/components/ChatComponents/ChatMessages";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { AppContext } from "@/context";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { getAIResponse } from "@/langchainStream";
import CopilotPlugin from "@/main";
import { CopilotSettings } from "@/settings/SettingsPage";
import SharedState, { ChatMessage, useSharedState } from "@/sharedState";
import {
  createChangeToneSelectionPrompt,
  createTranslateSelectionPrompt,
  eli5SelectionPrompt,
  emojifyPrompt,
  fixGrammarSpellingSelectionPrompt,
  formatDateTime,
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
  getSendChatContextNotesPrompt,
  getTagsFromNote,
  glossaryPrompt,
  removeUrlsFromSelectionPrompt,
  rewriteLongerSelectionPrompt,
  rewritePressReleaseSelectionPrompt,
  rewriteShorterSelectionPrompt,
  rewriteTweetSelectionPrompt,
  rewriteTweetThreadSelectionPrompt,
  sendNotesContentPrompt,
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
  getChatVisibility: () => Promise<boolean>;
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
  getChatVisibility,
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
  const [historyIndex, setHistoryIndex] = useState(-1);

  const app = plugin.app || useContext(AppContext);

  const handleSendMessage = async () => {
    if (!inputMessage) return;

    const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault, settings);
    const processedUserMessage = await customPromptProcessor.processCustomPrompt(
      inputMessage,
      "",
      app.workspace.getActiveFile() as TFile | undefined
    );

    const userMessage: ChatMessage = {
      message: inputMessage,
      sender: USER_SENDER,
      isVisible: true,
    };

    const promptMessageHidden: ChatMessage = {
      message: processedUserMessage,
      sender: USER_SENDER,
      isVisible: false,
    };

    // Add user message to chat history
    addMessage(userMessage);
    addMessage(promptMessageHidden);

    // Add to user message history
    updateUserMessageHistory(inputMessage);
    setHistoryIndex(-1);

    // Clear input
    setInputMessage("");

    // Display running dots to indicate loading
    setLoading(true);
    await getAIResponse(
      promptMessageHidden,
      chainManager,
      addMessage,
      setCurrentAiMessage,
      setAbortController,
      { debug }
    );
    setLoading(false);
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

    // Save the chat history as a new note in the vault
    // Only visible messages are included
    const chatContent = chatHistory
      .filter((message) => message.isVisible)
      .map((message) => `**${message.sender}**: ${message.message}`)
      .join("\n\n");

    try {
      // Check if the default folder exists or create it
      const folder = app.vault.getAbstractFileByPath(defaultSaveFolder);
      if (!folder) {
        await app.vault.createFolder(defaultSaveFolder);
      }

      const now = new Date();
      const { fileName: timestampFileName, epoch } = formatDateTime(now);

      // Get the first user message
      const firstUserMessage = chatHistory.find(
        (message) => message.sender === USER_SENDER && message.isVisible
      );

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
epoch: ${epoch}
modelKey: ${currentModelKey}
---

${chatContent}`;

      const newNote: TFile = await app.vault.create(noteFileName, noteContentWithTimestamp);
      if (openNote) {
        const leaf = app.workspace.getLeaf();
        leaf.openFile(newNote);
      }
      new Notice(`Chat saved as note in folder: ${defaultSaveFolder}.`);
    } catch (error) {
      console.error("Error saving chat as note:", error);
    }
  };

  const handleSendActiveNoteToPrompt = async () => {
    if (!app) {
      console.error("App instance is not available.");
      return;
    }

    let noteFiles: TFile[] = [];
    if (debug) {
      console.log("Chat note context path:", settings.chatNoteContextPath);
      console.log("Chat note context tags:", settings.chatNoteContextTags);
    }
    if (settings.chatNoteContextPath) {
      // Recursively get all note TFiles in the path
      noteFiles = await getNotesFromPath(app.vault, settings.chatNoteContextPath);
    }
    if (settings.chatNoteContextTags?.length > 0) {
      // Get all notes with the specified tags
      // If path is provided, get all notes with the specified tags in the path
      // If path is not provided, get all notes with the specified tags
      noteFiles = await getNotesFromTags(app.vault, settings.chatNoteContextTags, noteFiles);
    }
    const file = app.workspace.getActiveFile();
    // If no note context provided, default to the active note
    if (noteFiles.length === 0) {
      if (!file) {
        new Notice("No active note found.");
        console.error("No active note found.");
        return;
      }
      new Notice("No valid Chat context provided. Defaulting to the active note.");
      noteFiles = [file];
    }

    const notes = [];
    for (const file of noteFiles) {
      // Get the content of the note
      const content = await getFileContent(file, app.vault);
      const tags = await getTagsFromNote(file, app.vault);
      if (content) {
        notes.push({ name: getFileName(file), content, tags });
      }
    }

    // Send the content of the note to AI
    const promptMessageHidden: ChatMessage = {
      message: sendNotesContentPrompt(notes),
      sender: USER_SENDER,
      isVisible: false,
    };

    // Visible user message that is not sent to AI
    // const sendNoteContentUserMessage = `Please read the following notes [[${activeNoteContent}]] and be ready to answer questions about it.`;
    const sendNoteContentUserMessage = getSendChatContextNotesPrompt(
      notes,
      settings.chatNoteContextPath,
      settings.chatNoteContextTags
    );
    const promptMessageVisible: ChatMessage = {
      message: sendNoteContentUserMessage,
      sender: USER_SENDER,
      isVisible: true,
    };

    addMessage(promptMessageVisible);
    addMessage(promptMessageHidden);

    setLoading(true);
    await getAIResponse(
      promptMessageHidden,
      chainManager,
      addMessage,
      setCurrentAiMessage,
      setAbortController,
      { debug }
    );
    setLoading(false);
  };

  const forceRebuildActiveNoteContext = async () => {
    if (!app) {
      console.error("App instance is not available.");
      return;
    }

    const file = app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note found.");
      console.error("No active note found.");
      return;
    }
    const noteContent = await getFileContent(file, app.vault);
    const noteName = getFileName(file);
    if (!noteContent) {
      new Notice("No note content found.");
      console.error("No note content found.");
      return;
    }

    const fileMetadata = app.metadataCache.getFileCache(file);
    const noteFile = {
      path: file.path,
      basename: file.basename,
      mtime: file.stat.mtime,
      content: noteContent,
      metadata: fileMetadata?.frontmatter ?? {},
    };
    await chainManager.indexFile(noteFile);
    const activeNoteOnMessage: ChatMessage = {
      sender: AI_SENDER,
      message: `Indexing [[${noteName}]]...\n\n Please switch to "QA" in Mode Selection to ask questions about it.`,
      isVisible: true,
    };

    if (currentChain === ChainType.LONG_NOTE_QA_CHAIN) {
      setChain(ChainType.LONG_NOTE_QA_CHAIN, { noteFile });
    }

    addMessage(activeNoteOnMessage);
  };

  const refreshVaultContext = async () => {
    if (!app) {
      console.error("App instance is not available.");
      return;
    }

    await plugin.indexVaultToVectorStore();
    new Notice("Vault index refreshed.");
  };

  const clearCurrentAiMessage = () => {
    setCurrentAiMessage("");
  };

  const handleStopGenerating = () => {
    if (abortController) {
      if (plugin.settings.debug) {
        console.log("User stopping generation...");
      }
      abortController.abort();
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
        lastUserMessage.message,
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

    // Trigger regeneration of the AI message
    handleRegenerate(messageIndex + 1);
  };

  useEffect(() => {
    async function handleSelection(event: CustomEvent) {
      const wordCount = event.detail.selectedText.split(" ").length;
      const tokenCount = await chainManager.chatModelManager.countTokens(event.detail.selectedText);
      const tokenCountMessage: ChatMessage = {
        sender: AI_SENDER,
        message: `The selected text contains ${wordCount} words and ${tokenCount} tokens.`,
        isVisible: true,
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
        custom_temperature,
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
        };

        if (isVisible) {
          addMessage(promptMessage);
        }

        // Have a hardcoded custom temperature for some commands that need more strictness
        chainManager.langChainParams = {
          ...chainManager.langChainParams,
          ...(custom_temperature && { temperature: custom_temperature }),
        };

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

  return (
    <div className="chat-container">
      <ChatMessages
        chatHistory={chatHistory}
        currentAiMessage={currentAiMessage}
        loading={loading}
        app={app}
        onInsertAtCursor={handleInsertAtCursor}
        onRegenerate={handleRegenerate}
        onEdit={handleEdit}
      />
      <div className="bottom-container">
        <ChatIcons
          currentModelKey={currentModelKey}
          setCurrentModelKey={setModelKey}
          currentChain={currentChain}
          setCurrentChain={setChain}
          onNewChat={async (openNote: boolean) => {
            if (settings.autosaveChat && chatHistory.length > 0) {
              await handleSaveAsNote(openNote);
            }
            clearMessages();
            clearChatMemory();
            clearCurrentAiMessage();
          }}
          onSaveAsNote={() => handleSaveAsNote(true)}
          onSendActiveNoteToPrompt={handleSendActiveNoteToPrompt}
          onForceRebuildActiveNoteContext={forceRebuildActiveNoteContext}
          onRefreshVaultContext={refreshVaultContext}
          addMessage={addMessage}
          settings={settings}
          vault={app.vault}
          vault_qa_strategy={plugin.settings.indexVaultToVectorStore}
          debug={debug}
        />
        <ChatInput
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={handleSendMessage}
          getChatVisibility={getChatVisibility}
          isGenerating={loading}
          onStopGenerating={handleStopGenerating}
          app={app}
          settings={settings}
          navigateHistory={navigateHistory}
        />
      </div>
    </div>
  );
};

export default Chat;
