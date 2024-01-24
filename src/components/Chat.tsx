import ChainManager from '@/LLMProviders/chainManager';
import { useAIState } from '@/aiState';
import { ChainType } from '@/chainFactory';
import ChatIcons from '@/components/ChatComponents/ChatIcons';
import ChatInput from '@/components/ChatComponents/ChatInput';
import ChatMessages from '@/components/ChatComponents/ChatMessages';
import { AI_SENDER, USER_SENDER } from '@/constants';
import { AppContext } from '@/context';
import { getAIResponse } from '@/langchainStream';
import SharedState, {
  ChatMessage, useSharedState,
} from '@/sharedState';
import {
  createChangeToneSelectionPrompt,
  createTranslateSelectionPrompt,
  eli5SelectionPrompt,
  emojifyPrompt,
  fillInSelectionForCustomPrompt,
  fixGrammarSpellingSelectionPrompt,
  formatDateTime,
  getFileContent,
  getFileName,
  glossaryPrompt,
  removeUrlsFromSelectionPrompt,
  rewriteLongerSelectionPrompt,
  rewritePressReleaseSelectionPrompt,
  rewriteShorterSelectionPrompt,
  rewriteTweetSelectionPrompt,
  rewriteTweetThreadSelectionPrompt,
  sendNoteContentPrompt,
  simplifyPrompt,
  summarizePrompt,
  tocPrompt
} from '@/utils';
import VectorDBManager from '@/vectorDBManager';
import { EventEmitter } from 'events';
import { Notice, TFile } from 'obsidian';
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
  chainManager: ChainManager;
  emitter: EventEmitter;
  getChatVisibility: () => Promise<boolean>;
  defaultSaveFolder: string;
  debug: boolean;
}

const Chat: React.FC<ChatProps> = ({
  sharedState, chainManager, emitter, getChatVisibility, defaultSaveFolder, debug
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

    const file = app.workspace.getActiveFile();
    if (!file) {
      new Notice('No active note found.');
      console.error('No active note found.');
      return;
    }

    const noteContent = await getFileContent(file);
    const noteName = getFileName(file);
    if (!noteContent) {
      new Notice('No note content found.');
      console.error('No note content found.');
      return;
    }

    // Send the content of the note to AI
    const promptMessageHidden: ChatMessage = {
      message: sendNoteContentPrompt(noteName, noteContent),
      sender: USER_SENDER,
      isVisible: false,
    };

    // Visible user message that is not sent to AI
    const sendNoteContentUserMessage = `Please read this note [[${noteName}]] and be ready to answer questions about it.`;
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
    const noteContent = await getFileContent(file);
    const noteName = getFileName(file);
    if (!noteContent) {
      new Notice('No note content found.');
      console.error('No note content found.');
      return;
    }

    const docHash = VectorDBManager.getDocumentHash(noteContent);
    await chainManager.buildIndex(noteContent, docHash);
    const activeNoteOnMessage: ChatMessage = {
      sender: AI_SENDER,
      message: `Indexing [[${noteName}]]...\n\n Please switch to "QA" in Mode Selection to ask questions about it.`,
      isVisible: true,
    };

    if (currentChain === ChainType.RETRIEVAL_QA_CHAIN) {
      setChain(ChainType.RETRIEVAL_QA_CHAIN, { noteContent });
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
    promptFn: (selectedText: string, eventSubtype?: string) => string,
    options: CreateEffectOptions = {},
  ) => {
    return () => {
      const {
        custom_temperature,
        isVisible = false,
        ignoreSystemMessage = true,  // Ignore system message by default for commands
      } = options;
      const handleSelection = async (selectedText: string, eventSubtype?: string) => {
        // Create a user message with the selected text
        const promptMessage: ChatMessage = {
          message: promptFn(selectedText, eventSubtype),
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
  useEffect(
    createEffect(
      'applyCustomPromptSelection',
      (selectedText, prompt) =>
        fillInSelectionForCustomPrompt(prompt)(selectedText),
      // Not showing the custom prompt in the chat UI for now, Leaving it here as an option.
      // To check the prompt, use Debug mode in the setting.
      // { isVisible: true },
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
