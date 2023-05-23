import AIState, { useAIState } from '@/aiState';
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
  aiState: AIState;
  emitter: EventEmitter;
  getChatVisibility: () => Promise<boolean>;
  debug: boolean;
}

const Chat: React.FC<ChatProps> = ({
  sharedState, aiState, emitter, getChatVisibility, debug
}) => {
  const [
    chatHistory, addMessage, clearMessages,
  ] = useSharedState(sharedState);
  const [
    currentModel, setModel, clearChatMemory,
  ] = useAIState(aiState);
  const [currentAiMessage, setCurrentAiMessage] = useState('');
  const [inputMessage, setInputMessage] = useState('');
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const app = useContext(AppContext);

  const chatContext = getChatContext(chatHistory, aiState.langChainParams.chatContextTurns * 2);

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
      aiState,
      addMessage,
      setCurrentAiMessage,
      setAbortController,
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
      aiState,
      addMessage,
      setCurrentAiMessage,
      setAbortController,
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

  useEffect(() => {
    async function handleSelection(selectedText: string) {
      const wordCount = selectedText.split(' ').length;
      const tokenCount = await aiState.countTokens(selectedText);
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
        aiState.langChainParams = {
          ...aiState.langChainParams,
          ...(custom_temperature && { temperature: custom_temperature }),
        };

        await getAIResponse(
          promptMessage,
          [],
          aiState,
          addMessage,
          setCurrentAiMessage,
          setAbortController,
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
          setCurrentModel={setModel}
          onStopGenerating={handleStopGenerating}
          onNewChat={
            () => {
              clearMessages();
              clearChatMemory();
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
