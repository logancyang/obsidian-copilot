import { NoteTitleModal } from "@/components/NoteTitleModal";
import { IconPlayerStopFilled, IconSend } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSendMessage: () => void;
  isGenerating: boolean;
  chatIsVisible: boolean;
  onStopGenerating: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
  inputMessage,
  setInputMessage,
  handleKeyDown,
  handleSendMessage,
  isGenerating,
  onStopGenerating,
  chatIsVisible,
}) => {
  const [rows, setRows] = useState(1);
  const [shouldFocus, setShouldFocus] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const inputValue = event.target.value;
    setInputMessage(inputValue);
    updateRows(inputValue);

    // Check if the user typed `[[`
    if (inputValue.slice(-2) === "[[") {
      showNoteTitleModal();
    }
  };

  const showNoteTitleModal = () => {
    const fetchNoteTitles = async () => {
      const noteTitles = app.vault.getMarkdownFiles().map((file) => file.basename);

      new NoteTitleModal(app, noteTitles, (noteTitle: string) => {
        setInputMessage(inputMessage.slice(0, -2) + ` [[${noteTitle}]]`);
      }).open();
    };

    fetchNoteTitles();
  };

  const updateRows = (text: string) => {
    const lineHeight = 20; // Adjust this value based on CSS line-height
    const maxHeight = 200; // Match this to the max-height value in CSS
    const minRows = 1;

    const rowsNeeded = Math.min(
      Math.max(text.split("\n").length, minRows),
      Math.floor(maxHeight / lineHeight)
    );
    setRows(rowsNeeded);
  };

  // Effect hook to get the chat visibility
  useEffect(() => {
    setShouldFocus(chatIsVisible);
  }, [chatIsVisible]);

  // This effect will run every time the shouldFocus state is updated
  useEffect(() => {
    if (textAreaRef.current && shouldFocus) {
      textAreaRef.current.focus();
    }
  }, [shouldFocus]);

  return (
    <div className="chat-input-container">
      <textarea
        ref={textAreaRef}
        className="chat-input-textarea"
        placeholder="Enter your message here..."
        value={inputMessage}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        rows={rows}
      />
      <button
        onClick={isGenerating ? onStopGenerating : handleSendMessage}
        aria-label={isGenerating ? "Stop generating" : "Send message"}
      >
        {isGenerating ? <IconPlayerStopFilled size={18} /> : <IconSend size={18} />}
      </button>
    </div>
  );
};

export default ChatInput;
