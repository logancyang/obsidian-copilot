import ChatIcons from '@/components/ChatComponents/ChatIcons';
import ChatInput from '@/components/ChatComponents/ChatInput';
import ChatMessages from '@/components/ChatComponents/ChatMessages';
import { DEFAULT_SYSTEM_PROMPT, USER_SENDER } from '@/constants';
import { AppContext } from '@/context';
import { LangChainParams, getAIResponse } from '@/langchainStream';
import { CopilotSettings } from '@/main';
import SharedState, { ChatMessage, useSharedState } from '@/sharedState';
import {
  createChangeToneSelectionPrompt,
  createTranslateSelectionPrompt,
  eli5SelectionPrompt,
  emojifyPrompt,
  fixGrammarSpellingSelectionPrompt,
  formatDateTime,
  getChatContext,
  getFileContent,
  getFileName,
  glossaryPrompt,
  removeUrlsFromSelectionPrompt,
  rewriteLongerSelectionPrompt,
  rewritePressReleaseSelectionPrompt,
  rewriteShorterSelectionPrompt,
  rewriteTweetSelectionPrompt,
  rewriteTweetThreadSelectionPrompt,
  sanitizeSettings,
  simplifyPrompt,
  summarizePrompt,
  tocPrompt,
  useNoteAsContextPrompt
} from '@/utils';
import { EventEmitter } from 'events';
import { TFile } from 'obsidian';
import React, {
  useContext,
  useEffect,
  useState,
} from 'react';


interface ChatProps {
  sharedState: SharedState;
  settings: CopilotSettings;
  model: string;
  emitter: EventEmitter;
  stream: boolean;
  getChatVisibility: () => Promise<boolean>;
  userSystemPrompt: string;
  debug: boolean;
}

const Chat: React.FC<ChatProps> = ({
  sharedState, settings, model, emitter, stream, getChatVisibility,
  userSystemPrompt, debug
}) => {
  const [
    chatHistory, addMessage, clearMessages
  ] = useSharedState(sharedState);
  const [inputMessage, setInputMessage] = useState('');
  const [currentAiMessage, setCurrentAiMessage] = useState('');
  const [currentModel, setCurrentModel] = useState(model);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const app = useContext(AppContext);
  const {
    openAiApiKey,
    temperature,
    maxTokens,
    contextTurns,
  } = sanitizeSettings(settings);

  const systemPrompt = userSystemPrompt || DEFAULT_SYSTEM_PROMPT;
  const langChainParams: LangChainParams = {
    key: openAiApiKey,
    model: currentModel,
    temperature: Number(temperature),
    maxTokens: Number(maxTokens),
    systemMessage: systemPrompt,
  }
  // The number of past conversation turns to use as context for the AI
  // The number of messages is doubled.
  const chatContext = getChatContext(chatHistory, Number(contextTurns)*2);

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

    await getAIResponse(
      userMessage,
      chatContext,
      langChainParams,
      setCurrentAiMessage,
      addMessage,
      setAbortController,
      stream,
      debug,
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      const now = new Date();
      const noteFileName = `Chat-${formatDateTime(now)}.md`;
      const newNote: TFile = await app.vault.create(noteFileName, chatContent);
      const leaf = app.workspace.getLeaf();
      leaf.openFile(newNote);
    } catch (error) {
      console.error('Error saving chat as note:', error);
    }
  };

  const useActiveNoteAsContext = async () => {
    if (!app) {
      console.error('App instance is not available.');
      return;
    }

    const file = app.workspace.getActiveFile();
    if (!file) {
      console.error('No active note found.');
      return;
    }
    const noteContent = await getFileContent(file);
    const noteName = getFileName(file);

    // Set the context based on the noteContent
    const prompt = useNoteAsContextPrompt(noteName, noteContent);

    // Send the prompt as a user message
    const promptMessage: ChatMessage = {
      sender: USER_SENDER,
      message: prompt,
      isVisible: false,
    };
    addMessage(promptMessage);

    // Hide the prompt from the user
    await getAIResponse(
      promptMessage,
      chatContext,
      langChainParams,
      setCurrentAiMessage,
      addMessage,
      setAbortController,
      stream,
      debug,
    );
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

  // Create an effect for each event type (command)
  const createEffect = (
    eventType: string,
    promptFn: (selectedText: string, eventSubtype?: string) => string,
    custom_temperature?: number,
  ) => {
    return () => {
      const handleSelection = async (selectedText: string, eventSubtype?: string) => {
        // Create a user message with the selected text
        const promptMessage: ChatMessage = {
          message: promptFn(selectedText, eventSubtype),
          sender: USER_SENDER,
          isVisible: false,
        };

        // Have a hardcoded custom temperature for some commands that need more strictness
        const updatedLangChainParams = {
          ...langChainParams,
          ...(custom_temperature && { temperature: custom_temperature }),
        };

        await getAIResponse(
          promptMessage,
          [],
          updatedLangChainParams,
          setCurrentAiMessage,
          addMessage,
          setAbortController,
          stream,
          debug,
        );
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
  useEffect(createEffect('rewriteTweetSelection', rewriteTweetSelectionPrompt, 0.2), []);
  useEffect(createEffect('rewriteTweetThreadSelection', rewriteTweetThreadSelectionPrompt, 0.2), []);
  useEffect(createEffect('rewriteShorterSelection', rewriteShorterSelectionPrompt), []);
  useEffect(createEffect('rewriteLongerSelection', rewriteLongerSelectionPrompt), []);
  useEffect(createEffect('eli5Selection', eli5SelectionPrompt), []);
  useEffect(createEffect('rewritePressReleaseSelection', rewritePressReleaseSelectionPrompt), []);
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

  return (
    <div className="chat-container">
      <ChatMessages
        chatHistory={chatHistory}
        currentAiMessage={currentAiMessage}
      />
      <div className='bottom-container'>
        <ChatIcons
          currentModel={currentModel}
          setCurrentModel={setCurrentModel}
          onStopGenerating={handleStopGenerating}
          onNewChat={
            () => {
              clearMessages();
              clearCurrentAiMessage();
            }
          }
          onSaveAsNote={handleSaveAsNote}
          onUseActiveNoteAsContext={useActiveNoteAsContext}
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
