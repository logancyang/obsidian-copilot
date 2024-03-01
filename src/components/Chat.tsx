import ChainManager from '@/LLMProviders/chainManager';
import { useAIState } from '@/aiState';
import { ChainType } from '@/chainFactory';
import ChatIcons from '@/components/ChatComponents/ChatIcons';
import ChatInput from '@/components/ChatComponents/ChatInput';
import ChatMessages from '@/components/ChatComponents/ChatMessages';
import { AI_SENDER, USER_SENDER } from '@/constants';
import { AppContext } from '@/context';
import { CustomPromptProcessor } from '@/customPromptProcessor';
import { getAIResponse } from '@/langchainStream';
import { CopilotSettings } from '@/settings/SettingsPage';
import SharedState, {
  ChatMessage, useSharedState,
} from '@/sharedState';
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
  tocPrompt
} from '@/utils';
import { EventEmitter } from 'events';
import { Notice, TFile, Vault } from 'obsidian';
import React, {
  useContext,
  useEffect,
  useState,
} from 'react';

interface CreateEffectOptions {
  custom_temperature?: number;
  isVisible?: boolean;
  ignoreSystemMessage?: boolean;
}

interface ChatProps {
  sharedState: SharedState;
  settings: CopilotSettings;
  chainManager: ChainManager;
  emitter: EventEmitter;
  getChatVisibility: () => Promise<boolean>;
  defaultSaveFolder: string;
  vault: Vault;
  debug: boolean;
}

const Chat: React.FC<ChatProps> = ({
  sharedState,
  settings,
  chainManager,
  emitter,
  getChatVisibility,
  defaultSaveFolder,
  vault,
  debug
}) => {
  const [
    chatHistory, addMessage, clearMessages,
  ] = useSharedState(sharedState);
  const [
    currentModel, setModel, currentChain, setChain, clearChatMemory,
  ] = useAIState(chainManager);
  const [currentAiMessage, setCurrentAiMessage] = useState('');
  const [inputMessage, setInputMessage] = useState('');
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [loading, setLoading] = useState(false);

  const app = useContext(AppContext);

  const handleSendMessage = async () => {
    if (!inputMessage) return;

    const userMessage: ChatMessage = {
      message: inputMessage,
      sender: USER_SENDER,
      isVisible: true,
    };

    // Add user message to chat history
    addMessage(userMessage);
    // Clear input
    setInputMessage('');

    // Display running dots to indicate loading
    setLoading(true);
    await getAIResponse(
      userMessage,
      chainManager,
      addMessage,
      setCurrentAiMessage,
      setAbortController,
      { debug },
    );
    setLoading(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevents adding a newline to the textarea
      handleSendMessage();
    }
  };

  const handleSaveAsNote = async () => {
    if (!app) {
      console.error('App instance is not available.');
      return;
    }
    // Save the chat history as a new note in the vault
    const chatContent = chatHistory.map((message) => `**${message.sender}**: ${message.message}`).join('\n\n');

    try {
      // Check if the default folder exists or create it
      const folder = app.vault.getAbstractFileByPath(defaultSaveFolder);
      if (!folder) {
        await app.vault.createFolder(defaultSaveFolder);
      }

      const now = new Date();
      const noteFileName = `${defaultSaveFolder}/Chat-${formatDateTime(now)}.md`;
      const newNote: TFile = await app.vault.create(noteFileName, chatContent);
      const leaf = app.workspace.getLeaf();
      leaf.openFile(newNote);
    } catch (error) {
      console.error('Error saving chat as note:', error);
    }
  };

  const handleSendActiveNoteToPrompt = async () => {
    if (!app) {
      console.error('App instance is not available.');
      return;
    }

    let noteFiles: TFile[] = [];
    if (debug) {
      console.log('Chat note context path:', settings.chatNoteContextPath);
      console.log('Chat note context tags:', settings.chatNoteContextTags);
    }
    if (settings.chatNoteContextPath) {
      // Recursively get all note TFiles in the path
      noteFiles = await getNotesFromPath(vault, settings.chatNoteContextPath);
    }
    if (settings.chatNoteContextTags?.length > 0) {
      // Get all notes with the specified tags
      // If path is provided, get all notes with the specified tags in the path
      // If path is not provided, get all notes with the specified tags
      noteFiles = await getNotesFromTags(vault, settings.chatNoteContextTags, noteFiles);
    }
    const file = app.workspace.getActiveFile();
    // If no note context provided, default to the active note
    if (noteFiles.length === 0) {
      if (!file) {
        new Notice('No active note found.');
        console.error('No active note found.');
        return;
      }
      new Notice('No valid Chat context provided. Defaulting to the active note.');
      noteFiles = [file];
    }

    const notes = [];
    for (const file of noteFiles) {
      // Get the content of the note
      const content = await getFileContent(file, vault);
      const tags = await getTagsFromNote(file, vault);
      if (content) {
        notes.push({ name: getFileName(file), content, tags});
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
      settings.chatNoteContextTags,
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
      { debug },
    );
    setLoading(false);
  };

  const forceRebuildActiveNoteContext = async () => {
    if (!app) {
      console.error('App instance is not available.');
      return;
    }

    const file = app.workspace.getActiveFile();
    if (!file) {
      new Notice('No active note found.');
      console.error('No active note found.');
      return;
    }
    const noteContent = await getFileContent(file, vault);
    const noteName = getFileName(file);
    if (!noteContent) {
      new Notice('No note content found.');
      console.error('No note content found.');
      return;
    }

    const fileMetadata = app.metadataCache.getFileCache(file)
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

  const clearCurrentAiMessage = () => {
    setCurrentAiMessage('');
  };

  const handleStopGenerating = () => {
    if (abortController) {
      console.log("User stopping generation...");
      abortController.abort();
    }
  };

  useEffect(() => {
    async function handleSelection(selectedText: string) {
      const wordCount = selectedText.split(' ').length;
      const tokenCount = await chainManager.chatModelManager.countTokens(selectedText);
      const tokenCountMessage: ChatMessage = {
        sender: AI_SENDER,
        message: `The selected text contains ${wordCount} words and ${tokenCount} tokens.`,
        isVisible: true,
      };
      addMessage(tokenCountMessage);
    }

    emitter.on('countTokensSelection', handleSelection);

    // Cleanup function to remove the event listener when the component unmounts
    return () => {
      emitter.removeListener('countTokensSelection', handleSelection);
    };
  }, []);

  // Create an effect for each event type (Copilot command on selected text)
  const createEffect = (
    eventType: string,
    promptFn: (selectedText: string, eventSubtype?: string) => string | Promise<string>,
    options: CreateEffectOptions = {},
  ) => {
    return () => {
      const {
        custom_temperature,
        isVisible = false,
        ignoreSystemMessage = true,  // Ignore system message by default for commands
      } = options;
      const handleSelection = async (selectedText: string, eventSubtype?: string) => {
        const messageWithPrompt = await promptFn(selectedText, eventSubtype);
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

      emitter.on(eventType, handleSelection);

      // Cleanup function to remove the event listener when the component unmounts
      return () => {
        emitter.removeListener(eventType, handleSelection);
      };
    };
  };

  useEffect(createEffect('fixGrammarSpellingSelection', fixGrammarSpellingSelectionPrompt), []);
  useEffect(createEffect('summarizeSelection', summarizePrompt), []);
  useEffect(createEffect('tocSelection', tocPrompt), []);
  useEffect(createEffect('glossarySelection', glossaryPrompt), []);
  useEffect(createEffect('simplifySelection', simplifyPrompt), []);
  useEffect(createEffect('emojifySelection', emojifyPrompt), []);
  useEffect(createEffect('removeUrlsFromSelection', removeUrlsFromSelectionPrompt), []);
  useEffect(
    createEffect(
      'rewriteTweetSelection', rewriteTweetSelectionPrompt, { custom_temperature: 0.2 },
    ),
    []
  );
  useEffect(
    createEffect(
      'rewriteTweetThreadSelection', rewriteTweetThreadSelectionPrompt, { custom_temperature: 0.2 },
    ),
    []
  );
  useEffect(createEffect('rewriteShorterSelection', rewriteShorterSelectionPrompt), []);
  useEffect(createEffect('rewriteLongerSelection', rewriteLongerSelectionPrompt), []);
  useEffect(createEffect('eli5Selection', eli5SelectionPrompt), []);
  useEffect(createEffect('rewritePressReleaseSelection', rewritePressReleaseSelectionPrompt), []);
  useEffect(
    createEffect('translateSelection', (selectedText, language) =>
      createTranslateSelectionPrompt(language)(selectedText)
    ),
    []
  );
  useEffect(
    createEffect('changeToneSelection', (selectedText, tone) =>
      createChangeToneSelectionPrompt(tone)(selectedText)
    ),
    []
  );

  const customPromptProcessor = CustomPromptProcessor.getInstance(vault);
  useEffect(
    createEffect(
      'applyCustomPrompt',
      async (selectedText, customPrompt) => {
        if (!customPrompt) {
          return selectedText;
        }
        return await customPromptProcessor.processCustomPrompt(customPrompt, selectedText);
      },
      { isVisible: debug, ignoreSystemMessage: true, custom_temperature: 0.1 },
    ),
    []
  );

  useEffect(
    createEffect(
      'applyAdhocPrompt',
      async (selectedText, customPrompt) => {
        if (!customPrompt) {
          return selectedText;
        }
        return await customPromptProcessor.processCustomPrompt(customPrompt, selectedText);
      },
      { isVisible: debug, ignoreSystemMessage: true, custom_temperature: 0.1 },
    ),
    []
  );


  return (
    <div className="chat-container">
      <ChatMessages
        chatHistory={chatHistory}
        currentAiMessage={currentAiMessage}
        loading={loading}
      />
      <div className='bottom-container'>
        <ChatIcons
          currentModel={currentModel}
          setCurrentModel={setModel}
          currentChain={currentChain}
          setCurrentChain={setChain}
          onStopGenerating={handleStopGenerating}
          onNewChat={
            () => {
              clearMessages();
              clearChatMemory();
              clearCurrentAiMessage();
            }
          }
          onSaveAsNote={handleSaveAsNote}
          onSendActiveNoteToPrompt={handleSendActiveNoteToPrompt}
          onForceRebuildActiveNoteContext={forceRebuildActiveNoteContext}
          addMessage={addMessage}
          vault={vault}
        />
        <ChatInput
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={handleSendMessage}
          handleKeyDown={handleKeyDown}
          getChatVisibility={getChatVisibility}
        />
      </div>
    </div>
  );
};

export default Chat;
