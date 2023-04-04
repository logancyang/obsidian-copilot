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

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputMessage(event.target.value);
  };

  const handleSendMessage = async () => {
    if (!inputMessage) return;

    const userMessage: ChatMessage = {
      message: inputMessage,
      sender: 'User',
    };

    // Add user message to chat history
    setChatHistory([...chatHistory, userMessage]);
    sharedState.addMessage(userMessage);

    // Send message to AI and get a response
    const aiMessage: ChatMessage = await getChatGPTResponse(inputMessage, apiKey, model);

    // Add AI message to chat history
    setChatHistory([...chatHistory, aiMessage]);
    sharedState.addMessage(aiMessage);

    // Clear input
    setInputMessage('');
  };

  return (
    <div>
      <div>
        {chatHistory.map((message, index) => (
          <div key={index}>
            <strong>{message.sender}: </strong>
            <span>{message.message}</span>
          </div>
        ))}
      </div>
      <div>
        <input
          type="text"
          placeholder="Type your message"
          value={inputMessage}
          onChange={handleInputChange}
        />
        <button onClick={handleSendMessage}>Send</button>
      </div>
    </div>
  );
};

export default Chat;

// async function sendMessage(inputMessage: string, apiKey: string, model: string): Promise<ChatMessage> {
//   // Add your logic to send a message to the AI and get the response.
//   // Use the OpenAI API key and the default model from the plugin settings.
//   // For example:

//   const responseMessage = await getChatGPTResponse(inputMessage);

//   // Return the message as a ChatMessage object.
//   return {
//     message: responseMessage,
//     sender: 'AI',
//   };
// }

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
      sender: 'AI',
    };
  } catch (error) {
    console.error('Failed to get response from OpenAI API:', error);
    return {
      message: 'Error: Failed to get response from OpenAI API.',
      sender: 'System',
    };
  }
}
