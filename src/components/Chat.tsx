import React, { useState, useEffect } from 'react';
import { ChatMessage, SharedState } from '../sharedState';
import axios from 'axios';


interface ChatProps {
  sharedState: SharedState;
  apiKey: string;
  model: string;
}

const Chat: React.FC<ChatProps> = ({ sharedState, apiKey, model }) => {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');

  useEffect(() => {
    // Initialize chat history
    setChatHistory(sharedState.getMessages());
  }, [sharedState]);

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputMessage(event.target.value);
  };

  const handleSendMessage = async () => {
    if (!inputMessage) return;

    const userMessage: ChatMessage = {
      message: inputMessage,
      sender: 'User',
    };

    // Add user message to chat history
    sharedState.addMessage(userMessage);

    // Send message to AI and get a response
    // const aiMessage: ChatMessage = await getChatGPTResponse(inputMessage, apiKey, model);
    const aiMessage: ChatMessage = {
      message: 'Hi there! I am a chatbot. I am here to help you with your tasks. What can I do for you?',
      sender: model,
    };

    // Add AI message to chat history
    sharedState.addMessage(aiMessage);

    // Clear input
    setInputMessage('');
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
          <div key={index}>
            <strong>{message.sender}: </strong>
            <span>{message.message}</span>
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
