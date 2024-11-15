import { ChatButtons } from "@/components/ChatComponents/ChatButtons";
import { SourcesModal } from "@/components/SourcesModal";
import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/sharedState";
import { Bot, User } from "lucide-react";
import { App, Component, MarkdownRenderer } from "obsidian";
import React, { useEffect, useRef, useState } from "react";

interface ChatSingleMessageProps {
  message: ChatMessage;
  app: App;
  isStreaming: boolean;
  onInsertAtCursor?: () => void;
  onRegenerate?: () => void;
  onEdit?: (newMessage: string) => void;
  onDelete: () => void;
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({
  message,
  app,
  isStreaming,
  onInsertAtCursor,
  onRegenerate,
  onEdit,
  onDelete,
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

  const handleShowSources = () => {
    if (message.sources && message.sources.length > 0) {
      new SourcesModal(app, message.sources).open();
    }
  };

  const renderMessageContent = () => {
    if (message.content) {
      return (
        <div className="message-content-items">
          {message.content.map((item, index) => {
            if (item.type === "text") {
              return (
                <div key={index} className="message-text-content">
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
                    <span>{item.text}</span>
                  ) : (
                    <div ref={contentRef}></div>
                  )}
                </div>
              );
            } else if (item.type === "image_url") {
              return (
                <div key={index} className="message-image-content">
                  <img
                    src={item.image_url.url}
                    alt="User uploaded image"
                    className="chat-message-image"
                  />
                </div>
              );
            }
            return null;
          })}
        </div>
      );
    }

    // Fallback for messages without content array
    return message.sender === USER_SENDER && isEditing ? (
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
    );
  };

  return (
    <div className="chat-message-container">
      <div className={`message ${message.sender === USER_SENDER ? "user-message" : "bot-message"}`}>
        <div className="message-icon">{message.sender === USER_SENDER ? <User /> : <Bot />}</div>
        <div className="message-content-wrapper">
          <div className="message-content">{renderMessageContent()}</div>

          {!isStreaming && (
            <div className="message-buttons-wrapper">
              <div className="message-timestamp">{message.timestamp?.display}</div>
              <ChatButtons
                message={message}
                onCopy={copyToClipboard}
                isCopied={isCopied}
                onInsertAtCursor={onInsertAtCursor}
                onRegenerate={onRegenerate}
                onEdit={handleEdit}
                onDelete={onDelete}
                onShowSources={handleShowSources}
                hasSources={message.sources && message.sources.length > 0 ? true : false}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatSingleMessage;
