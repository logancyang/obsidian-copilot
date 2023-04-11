import React, { useState, useContext } from 'react';
import { AppContext } from '@/context';
import SharedState, { ChatMessage, useSharedState } from '@/sharedState';
import { USER_SENDER, AI_SENDER } from '@/constants';
import { OpenAIStream, Role } from '@/openAiStream';
import { TFile } from 'obsidian';
import ChatMessages from '@/components/ChatComponents/ChatMessages';
import ChatIcons from '@/components/ChatComponents/ChatIcons';
import ChatInput from '@/components/ChatComponents/ChatInput';
import { getChatContext, formatDateTime } from '@/utils';


interface ChatProps {
  sharedState: SharedState;
  apiKey: string;
  model: string;
}

const Chat: React.FC<ChatProps> = ({ sharedState, apiKey, model }) => {
  const [
    chatHistory, addMessage, clearMessages
  ] = useSharedState(sharedState);
  const [inputMessage, setInputMessage] = useState('');
  const [currentAiMessage, setCurrentAiMessage] = useState('');
  const [currentModel, setCurrentModel] = useState(model);
  const app = useContext(AppContext);

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

    // The number of past messages to use as context for the AI
    // Use a even number. Increase this number later as needed
    const chatContext = getChatContext(chatHistory, 4);

    // Use OpenAIStream to send message to AI and get a response
    try {
      const stream = await OpenAIStream(
        currentModel,
        apiKey,
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

  return (
    <div className="chat-container">
      <ChatMessages chatHistory={chatHistory} currentAiMessage={currentAiMessage} />
      <div className='bottom-container'>
        <ChatIcons
          currentModel={currentModel}
          setCurrentModel={setCurrentModel}
          onNewChat={clearMessages}
          onSaveAsNote={handleSaveAsNote}
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
