import React, { useState } from 'react';
import SharedState, { ChatMessage, useSharedState } from 'src/sharedState';
import { USER_SENDER } from 'src/constants';
import { UserIcon, BotIcon } from 'src/components/Icons';
import axios from 'axios';


interface ChatProps {
  sharedState: SharedState;
  apiKey: string;
  model: string;
}

const Chat: React.FC<ChatProps> = ({ sharedState, apiKey, model }) => {
  const [chatHistory, addMessage] = useSharedState(sharedState);
  const [inputMessage, setInputMessage] = useState('');

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

    // Send message to AI and get a response
    getChatGPTResponse(inputMessage, apiKey, model).then((aiMessage) => {
      // Add AI message to chat history
      addMessage(aiMessage);
    });

    // Send message to AI and get a response
    // const aiMessage: ChatMessage = await getChatGPTResponse(inputMessage, apiKey, model);
    // const aiMessage: ChatMessage = {
    //   message: (
    //     `Hi there! I am a chatbot. I am here to help you with your tasks. What can I do for you?\n`
    //   ),
    //   sender: model,
    // };
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
              <span>{message.message}</span>
            </div>
          </div>
        ))}
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

// Get a response from the ChatGPT API
async function getChatGPTResponse(message: string, apiKey: string, model: string): Promise<ChatMessage> {
  try {
    console.log('Model:', model);
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        // TODO: Add support for more chat history as context
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: message },
        ],
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );
    const responseMessage = response.data.choices[0].message.content;
    return {
      message: responseMessage,
      sender: this.model,
    };
  } catch (error) {
    console.error('Failed to get response from OpenAI API:', error);
    return {
      message: 'Error: Failed to get response from OpenAI API.',
      sender: 'System',
    };
  }
}

export default Chat;
