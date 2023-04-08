import React, { useState, useEffect } from 'react';
import SharedState, { ChatMessage, useSharedState } from '@/sharedState';
import { USER_SENDER, AI_SENDER } from '@/constants';
import {
  BotIcon, RefreshIcon, NewChatIcon, SaveAsNoteIcon, UseActiveNoteAsContextIcon
} from '@/components/Icons';
import { OpenAIStream } from '@/openAiStream';
import ChatMessageComponent from '@/components/ChatMessageComponent';
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
  const [currentModel, setCurrentModel] = useState(model);
  const [rows, setRows] = useState(1);

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentModel(event.target.value);
  };

  const updateRows = (text: string) => {
    const lineHeight = 20; // You can adjust this value based on your CSS line-height
    const maxHeight = 200; // Match this to the max-height value you set in the CSS
    const minRows = 1;

    const rowsNeeded = Math.min(
      Math.max(text.split('\n').length, minRows), Math.floor(maxHeight / lineHeight)
    );
    setRows(rowsNeeded);
  };

  const scrollToBottom = () => {
    const chatMessagesContainer = document.querySelector('.chat-messages');
    if (chatMessagesContainer) {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputMessage(event.target.value);
    updateRows(event.target.value);
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
        currentModel,
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
          <ChatMessageComponent key={index} message={message} />
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
          <div className="chat-icon-selection-tooltip">
            <div className="select-wrapper">
              <select
                id="aiModelSelect"
                className='chat-icon-selection'
                value={currentModel}
                onChange={handleModelChange}
              >
                <option value='gpt-3.5-turbo'>GPT-3.5</option>
                <option value='gpt-4'>GPT-4</option>
              </select>
              <span className="tooltip-text">Model Selection</span>
            </div>
          </div>
          <button className='chat-icon-button'>
            <RefreshIcon className='icon-scaler' />
            <span className="tooltip-text">Regenerate Response</span>
          </button>
          <button className='chat-icon-button'>
            <NewChatIcon className='icon-scaler' />
            <span className="tooltip-text">New Chat</span>
          </button>
          <button className='chat-icon-button'>
            <SaveAsNoteIcon className='icon-scaler' />
            <span className="tooltip-text">Save as Note</span>
          </button>
          <button className='chat-icon-button'>
            <UseActiveNoteAsContextIcon className='icon-scaler' />
            <span className="tooltip-text">Use Active Note as Context</span>
          </button>
        </div>
        <div className="chat-input-container">
          <textarea
            className="chat-input-textarea"
            value={inputMessage}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={rows}
          />
          <button onClick={handleSendMessage}>Send</button>
        </div>
      </div>
    </div>
  );
};

// Returns the last N messages from the chat history, last one being the last user message
const getChatContext = (chatHistory: ChatMessage[], contextSize: number) => {
  const lastUserMessageIndex = chatHistory.slice().reverse().findIndex(msg => msg.sender === USER_SENDER);

  if (lastUserMessageIndex === -1) {
    // No user messages found, return an empty array
    return [];
  }

  const lastIndex = chatHistory.length - lastUserMessageIndex - 1;
  const startIndex = Math.max(0, lastIndex - contextSize + 1);

  return chatHistory.slice(startIndex, lastIndex + 1);
};

export default Chat;
