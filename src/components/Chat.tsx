import React, { useContext, useState, useEffect } from 'react';
import { AppContext } from '../context';
import CopilotPlugin from '../main';
import { ChatMessage } from '../sharedState';
import { SharedState } from '../sharedState';


interface ChatProps {
  sharedState: SharedState;
}

const Chat: React.FC<ChatProps> = () => {
  const app = useContext(AppContext);
  const plugin = (app as any).plugins.plugins['copilot-plugin'] as CopilotPlugin;
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');

  useEffect(() => {
    // Initialize chat history
    setChatHistory(plugin.sharedState.getMessages());
  }, [plugin.sharedState]);

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
    plugin.sharedState.addMessage(userMessage);

    // Send message to AI and get a response
    const aiMessage: ChatMessage = await plugin.sendMessage(inputMessage);

    // Add AI message to chat history
    setChatHistory([...chatHistory, aiMessage]);
    plugin.sharedState.addMessage(aiMessage);

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
