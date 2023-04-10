import React, { useState } from 'react';


interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSendMessage: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
  inputMessage, setInputMessage, handleKeyDown, handleSendMessage
}) => {
  const [rows, setRows] = useState(1);

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputMessage(event.target.value);
    updateRows(event.target.value);
  };

  const updateRows = (text: string) => {
    const lineHeight = 20; // Adjust this value based on CSS line-height
    const maxHeight = 200; // Match this to the max-height value in CSS
    const minRows = 1;

    const rowsNeeded = Math.min(
      Math.max(text.split('\n').length, minRows), Math.floor(maxHeight / lineHeight)
    );
    setRows(rowsNeeded);
  };

  return (
    <div className="chat-input-container">
      <textarea
        className="chat-input-textarea"
        placeholder="Enter your message here..."
        value={inputMessage}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        rows={rows}
      />
      <button onClick={handleSendMessage}>Send</button>
    </div>
  );
};

export default ChatInput;

