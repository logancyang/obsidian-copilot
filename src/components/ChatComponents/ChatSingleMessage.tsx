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
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({
  message,
  app,
  isStreaming,
  onInsertAtCursor,
  onRegenerate,
}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const componentRef = useRef<Component | null>(null);

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
      .replace(/\\\[/g, "$$")
      .replace(/\\\]/g, "$$")
      .replace(/\\\(/g, "$")
      .replace(/\\\)/g, "$");
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

  return (
    <div className="chat-message-container">
      <div className={`message ${message.sender === USER_SENDER ? "user-message" : "bot-message"}`}>
        <div className="message-icon">
          {message.sender === USER_SENDER ? <UserIcon /> : <BotIcon />}
        </div>
        <div className="message-content">
          {message.sender === USER_SENDER ? (
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
          />
        </div>
      )}
    </div>
  );
};

export default ChatSingleMessage;
