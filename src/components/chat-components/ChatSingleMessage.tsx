import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { SourcesModal } from "@/components/modals/SourcesModal";
import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/sharedState";
import { insertIntoEditor } from "@/utils";
import { Bot, User } from "lucide-react";
import { App, Component, MarkdownRenderer } from "obsidian";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function MessageContext({ context }: { context: ChatMessage["context"] }) {
  if (!context || (context.notes.length === 0 && context.urls.length === 0)) {
    return null;
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {context.notes.map((note) => (
        <Tooltip key={note.path}>
          <TooltipTrigger asChild>
            <Badge variant="secondary">
              <span className="max-w-40 truncate">{note.basename}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{note.path}</TooltipContent>
        </Tooltip>
      ))}
      {context.urls.map((url) => (
        <Tooltip key={url}>
          <TooltipTrigger asChild>
            <Badge variant="secondary">
              <span className="max-w-40 truncate">{url}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{url}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

interface ChatSingleMessageProps {
  message: ChatMessage;
  app: App;
  isStreaming: boolean;
  onRegenerate?: () => void;
  onEdit?: (newMessage: string) => void;
  onDelete: () => void;
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({
  message,
  app,
  isStreaming,
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

  const preprocess = useCallback(
    (content: string): string => {
      // Process LaTeX
      const latexProcessed = content
        .replace(/\\\[\s*/g, "$$")
        .replace(/\s*\\\]/g, "$$")
        .replace(/\\\(\s*/g, "$")
        .replace(/\s*\\\)/g, "$");

      // Process images
      const activeFile = app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : "";

      const imageProcessed = latexProcessed.replace(/!\[\[(.*?)\]\]/g, (match, imageName) => {
        const imageFile = app.metadataCache.getFirstLinkpathDest(imageName, sourcePath);
        if (imageFile) {
          const imageUrl = app.vault.getResourcePath(imageFile);
          return `![](${imageUrl})`;
        }
        return match;
      });

      // Process note links to obsidian:// URLs
      const noteProcessed = imageProcessed.replace(/\[\[(.*?)\]\]/g, (match, noteName) => {
        const encodedNoteName = encodeURIComponent(noteName);
        const vaultName = app.vault.getName();
        return `[${noteName}](obsidian://open?vault=${vaultName}&file=${encodedNoteName})`;
      });

      return noteProcessed;
    },
    [app]
  );

  useEffect(() => {
    if (contentRef.current && message.sender !== USER_SENDER) {
      // Clear previous content
      contentRef.current.innerHTML = "";

      // Create a new Component instance if it doesn't exist
      if (!componentRef.current) {
        componentRef.current = new Component();
      }

      const processedMessage = preprocess(message.message);

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
  }, [message, app, componentRef, isStreaming, preprocess]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      adjustTextareaHeight(textareaRef.current);
    }
  }, [isEditing]);

  useEffect(() => {
    setEditedMessage(message.message);
  }, [message.message]);

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
                    <span>{message.message}</span>
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
    <div className="flex flex-col w-full mb-1">
      <div
        className={cn(
          "flex rounded-md p-2 mx-2 gap-2",
          message.sender === USER_SENDER && "bg-primary-alt"
        )}
      >
        <div className="w-6 shrink-0">{message.sender === USER_SENDER ? <User /> : <Bot />}</div>
        <div className="flex flex-col flex-grow max-w-full gap-2">
          {!isEditing && <MessageContext context={message.context} />}
          <div className="message-content">{renderMessageContent()}</div>

          {!isStreaming && (
            <div className="message-buttons-wrapper">
              <div className="message-timestamp">{message.timestamp?.display}</div>
              <ChatButtons
                message={message}
                onCopy={copyToClipboard}
                isCopied={isCopied}
                onInsertIntoEditor={() => insertIntoEditor(message.message)}
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
