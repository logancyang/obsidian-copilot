import React, { useState, useContext } from 'react';
import { AppContext } from '@/context';
import SharedState, { ChatMessage, useSharedState } from '@/sharedState';
import { USER_SENDER, AI_SENDER, USE_NOTE_AS_CONTEXT_PROMPT } from '@/constants';
import { OpenAIStream, Role } from '@/openAiStream';
import { TFile } from 'obsidian';
import ChatMessages from '@/components/ChatComponents/ChatMessages';
import ChatIcons from '@/components/ChatComponents/ChatIcons';
import ChatInput from '@/components/ChatComponents/ChatInput';
import {
  getChatContext,
  formatDateTime,
  getFileContent,
  sanitizeSettings
} from '@/utils';
import { CopilotSettings } from '@/main';


interface ChatProps {
  sharedState: SharedState;
  settings: CopilotSettings;
  model: string;
}

const Chat: React.FC<ChatProps> = ({ sharedState, settings, model }) => {
  const [
    chatHistory, addMessage, clearMessages
  ] = useSharedState(sharedState);
  const [inputMessage, setInputMessage] = useState('');
  const [currentAiMessage, setCurrentAiMessage] = useState('');
  const [currentModel, setCurrentModel] = useState(model);
  const app = useContext(AppContext);
  const {
    openAiApiKey,
    temperature,
    maxTokens,
    contextTurns,
  } = sanitizeSettings(settings);

  const sendMessageToAIAndStreamResponse = async (userMessage: ChatMessage) => {
    // The number of past conversation turns to use as context for the AI
    // The number of messages is doubled.
    const chatContext = getChatContext(chatHistory, Number(contextTurns)*2);

    // Use OpenAIStream to send message to AI and get a response
    try {
      const stream = await OpenAIStream(
        currentModel,
        openAiApiKey,
        [
          ...chatContext.map((chatMessage) => {
            return {
              role: chatMessage.sender === USER_SENDER
                ? 'user' as Role : 'assistant' as Role,
              content: chatMessage.message,
            };
          }),
          { role: 'user', content: userMessage.message },
        ],
        Number(temperature),
        Number(maxTokens),
      );
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let aiResponse = '';

      reader.read().then(
        async function processStream({ done, value }): Promise<void> {
          if (done) {
            // Add the full AI response to the chat history
            const botMessage: ChatMessage = {
              message: aiResponse,
              sender: AI_SENDER,
            };
            addMessage(botMessage);
            setCurrentAiMessage('');
            return;
          }

          // Accumulate the AI response
          aiResponse += decoder.decode(value);
          setCurrentAiMessage(aiResponse);

          // Continue reading the stream
          return reader.read().then(processStream);
        },
      );
    } catch (error) {
      console.error('Error in OpenAIStream:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage) return;

    const userMessage: ChatMessage = {
      message: inputMessage,
      sender: USER_SENDER,
    };

    // Add user message to chat history
    addMessage(userMessage);

    // Clear input
    setInputMessage('');
    await sendMessageToAIAndStreamResponse(userMessage);
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

    // Set the context based on the noteContent
    const prompt = USE_NOTE_AS_CONTEXT_PROMPT + noteContent;

    // Send the prompt as a user message
    const promptMessage: ChatMessage = { sender: USER_SENDER, message: prompt };
    addMessage(promptMessage);
    await sendMessageToAIAndStreamResponse(promptMessage);
  };

  return (
    <div className="chat-container">
      <ChatMessages chatHistory={chatHistory} currentAiMessage={currentAiMessage} />
      <div className='bottom-container'>
        <ChatIcons
          currentModel={currentModel}
          setCurrentModel={setCurrentModel}
          onNewChat={clearMessages}
          onSaveAsNote={handleSaveAsNote}
          onUseActiveNoteAsContext={useActiveNoteAsContext}
        />
        <ChatInput
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={handleSendMessage}
          handleKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
};

export default Chat;
