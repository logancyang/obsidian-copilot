import { ChatButtons } from "@/components/ChatComponents/ChatButtons";
import { BotIcon, UserIcon } from "@/components/Icons";
import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/sharedState";
import { App, Component, MarkdownRenderer } from "obsidian";
import React, { useEffect, useRef, useState } from "react";

interface ChatSingleMessageProps {
  message: ChatMessage;
  app: App;
  isStreaming: boolean;
  onInsertAtCursor?: () => void;
  onRegenerate?: () => void;
  onEdit?: (newMessage: string) => void;
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({
  message,
  app,
  isStreaming,
  onInsertAtCursor,
  onRegenerate,
  onEdit,
}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedMessage, setEditedMessage] = useState<string>(message.message);
  const contentRef = useRef<HTMLDivElement>(null);
  const componentRef = useRef<Component | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const copyToClipboard = () => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    navigator.clipboard.writeText(message.message).then(() => {
      setIsCopied(true);

      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    });
  };

  const preprocessLatex = (content: string): string => {
    return content
      .replace(/\\\[\s*/g, "$$")
      .replace(/\s*\\\]/g, "$$")
      .replace(/\\\(\s*/g, "$")
      .replace(/\s*\\\)/g, "$");
  };

  useEffect(() => {
    if (contentRef.current && message.sender !== USER_SENDER) {
      // Clear previous content
      contentRef.current.innerHTML = "";

      // Create a new Component instance if it doesn't exist
      if (!componentRef.current) {
        componentRef.current = new Component();
      }

      const processedMessage = preprocessLatex(message.message);

      // Use Obsidian's MarkdownRenderer to render the message
      MarkdownRenderer.renderMarkdown(
        processedMessage,
        contentRef.current,
        "", // Empty string for sourcePath as we don't have a specific source file
        componentRef.current
      );
    }

    // Cleanup function
    return () => {
      if (componentRef.current) {
        componentRef.current.unload();
        componentRef.current = null;
      }
    };
  }, [message, app, componentRef, isStreaming]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      adjustTextareaHeight(textareaRef.current);
    }
  }, [isEditing]);

  const adjustTextareaHeight = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditedMessage(e.target.value);
    adjustTextareaHeight(e.target);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); // Prevents adding a newline to the textarea
      handleSaveEdit();
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    setIsEditing(false);
    if (onEdit) {
      onEdit(editedMessage);
    }
  };

  return (
    <div className="chat-message-container">
      <div className={`message ${message.sender === USER_SENDER ? "user-message" : "bot-message"}`}>
        <div className="message-icon">
          {message.sender === USER_SENDER ? <UserIcon /> : <BotIcon />}
        </div>
        <div className="message-content">
          {message.sender === USER_SENDER && isEditing ? (
            <textarea
              ref={textareaRef}
              value={editedMessage}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveEdit}
              autoFocus
              className="edit-textarea"
            />
          ) : message.sender === USER_SENDER ? (
            <span>{message.message}</span>
          ) : (
            <div ref={contentRef}></div>
          )}
        </div>
      </div>
      {!isStreaming && (
        <div className="message-buttons-wrapper">
          <ChatButtons
            message={message}
            onCopy={copyToClipboard}
            isCopied={isCopied}
            onInsertAtCursor={onInsertAtCursor}
            onRegenerate={onRegenerate}
            onEdit={handleEdit}
          />
        </div>
      )}
    </div>
  );
};

export default ChatSingleMessage;
