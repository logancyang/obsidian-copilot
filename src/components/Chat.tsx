import React, { useState } from 'react';
import SharedState, { ChatMessage, useSharedState } from '@/sharedState';
import { USER_SENDER, AI_SENDER } from '@/constants';
import { UserIcon, BotIcon } from '@/components/Icons';
import { OpenAIStream } from '@/openAiStream';
import ReactMarkdown from '@/components/Markdown/MemoizedReactMarkdown';


interface ChatProps {
  sharedState: SharedState;
  apiKey: string;
  model: string;
}

const Chat: React.FC<ChatProps> = ({ sharedState, apiKey, model }) => {
  const [chatHistory, addMessage] = useSharedState(sharedState);
  const [inputMessage, setInputMessage] = useState('');
  const [currentAiMessage, setCurrentAiMessage] = useState('');

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputMessage(event.target.value);
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

    // The number of past messages to use as context for the AI
    // Increase this number later as needed
    const chatContext = getChatContext([...chatHistory, userMessage], 5);

    // Use OpenAIStream to send message to AI and get a response
    try {
      const stream = await OpenAIStream(
        model,
        apiKey,
        chatContext.map((chatMessage) => {
          return {
            role: chatMessage.sender === USER_SENDER ? 'user' : 'assistant',
            content: chatMessage.message,
          };
        }),
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

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {chatHistory.map((message, index) => (
          <div
            key={index}
            className={`message ${message.sender === USER_SENDER ? 'user-message' : 'bot-message'}`}
          >
            <div className="message-icon">
              {message.sender === USER_SENDER ? <UserIcon /> : <BotIcon />}
            </div>
            <div className="message-content">
              {message.sender === USER_SENDER ? (
                <span>{message.message}</span>
              ) : (
                <ReactMarkdown>{message.message}</ReactMarkdown>
              )}
            </div>
          </div>
        ))}
        {currentAiMessage && (
          <div className="message bot-message">
            <div className="message-icon">
              <BotIcon />
            </div>
            <div className="message-content">
              <ReactMarkdown>{currentAiMessage}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
      <div className='bottom-container'>
        <div className='chat-icons-container'>
          <button className='chat-icon-button'>
            Regenerate response
          </button>
          <button className='chat-icon-button'>
            New chat
          </button>
          <button className='chat-icon-button'>
            something
          </button>
          <button className='chat-icon-button'>
            something
          </button>
        </div>
        <div className="chat-input-container">
          <textarea
            className="chat-input-textarea"
            value={inputMessage}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          <button onClick={handleSendMessage}>Send</button>
        </div>
      </div>
    </div>
  );
};

// Returns the last N messages from the chat history, last one being the last user message
const getChatContext = (chatHistory: ChatMessage[], contextSize: number) => {
  const lastUserMessageIndex = chatHistory.slice().reverse().findIndex(msg => msg.sender === "user");

  if (lastUserMessageIndex === -1) {
    // No user messages found, return an empty array
    return [];
  }

  const lastIndex = chatHistory.length - lastUserMessageIndex - 1;
  const startIndex = Math.max(0, lastIndex - contextSize + 1);

  return chatHistory.slice(startIndex, lastIndex + 1);
};

export default Chat;
