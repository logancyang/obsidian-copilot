import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { SourcesModal } from "@/components/modals/SourcesModal";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { USER_SENDER } from "@/constants";
import { useApplyCode } from "@/hooks/useApplyCode";
import { cn } from "@/lib/utils";
import { ChatMessage } from "@/sharedState";
import { insertIntoEditor } from "@/utils";
import { Bot, User } from "lucide-react";
import { App, Component, MarkdownRenderer, MarkdownView, TFile } from "obsidian";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { CodeBlock } from "./CodeBlock";

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
  chatHistory?: ChatMessage[];
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({
  message,
  app,
  isStreaming,
  onRegenerate,
  onEdit,
  onDelete,
  chatHistory = [],
}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedMessage, setEditedMessage] = useState<string>(message.message);
  const contentRef = useRef<HTMLDivElement>(null);
  const componentRef = useRef<Component | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleApplyCode = useApplyCode(app, chatHistory);

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
      const activeFile = app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : "";

      const processThinkSection = (content: string): string => {
        // Common styles as template strings
        const detailsStyle = `margin: 0.5rem 0 1.5rem; padding: 0.75rem; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-secondary)`;
        const summaryStyle = `cursor: pointer; color: var(--text-muted); font-size: 0.8em; margin-bottom: 0.5rem; user-select: none`;
        const contentStyle = `margin-top: 0.75rem; padding: 0.75rem; border-radius: 4px; background-color: var(--background-primary)`;

        // During streaming, if we find any think tag that's either unclosed or being processed
        if (isStreaming && content.includes("<think>")) {
          // Replace any complete think sections first
          content = content.replace(/<think>([\s\S]*?)<\/think>/g, (match, thinkContent) => {
            return `<details style="${detailsStyle}">
              <summary style="${summaryStyle}">Thought for a second</summary>
              <div class="text-muted" style="${contentStyle}">${thinkContent.trim()}</div>
            </details>\n\n`;
          });

          // Then handle any unclosed think tag, but preserve the streamed content
          content = content.replace(
            /<think>([\s\S]*)$/,
            (match, partialContent) => `<div style="${detailsStyle}">
              <div style="${summaryStyle}">Thinking...</div>
              <div class="text-muted" style="${contentStyle}">${partialContent.trim()}</div>
            </div>`
          );
          return content;
        }

        // Not streaming, process all think sections normally
        const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
        return content.replace(thinkRegex, (match, thinkContent) => {
          return `<details style="${detailsStyle}">
            <summary style="${summaryStyle}">Thought for a second</summary>
            <div class="text-muted" style="${contentStyle}">${thinkContent.trim()}</div>
          </details>\n\n`;
        });
      };

      const replaceLinks = (text: string, regex: RegExp, template: (file: TFile) => string) => {
        // Split text into code blocks and non-code blocks
        const parts = text.split(/(```[\s\S]*?```|`[^`]*`)/g);

        return parts
          .map((part, index) => {
            // Even indices are normal text, odd indices are code blocks
            if (index % 2 === 0) {
              // Process links only in non-code blocks
              return part.replace(regex, (match: string, selection: string) => {
                const file = app.metadataCache.getFirstLinkpathDest(selection, sourcePath);
                return file ? template(file) : match;
              });
            }
            // Return code blocks unchanged
            return part;
          })
          .join("");
      };

      // Process LaTeX
      const latexProcessed = content
        .replace(/\\\[\s*/g, "$$")
        .replace(/\s*\\\]/g, "$$")
        .replace(/\\\(\s*/g, "$")
        .replace(/\s*\\\)/g, "$");

      // Process only Obsidian internal images (starting with ![[)
      const noteImageProcessed = replaceLinks(
        latexProcessed,
        /!\[\[(.*?)]]/g,
        (file) => `![](${app.vault.getResourcePath(file)})`
      );

      // Process think sections
      const thinkSectionProcessed = processThinkSection(noteImageProcessed);

      // Transform markdown sources section into HTML structure
      const sourcesSectionProcessed = processSourcesSection(thinkSectionProcessed);

      // Transform [[link]] to clickable format but exclude ![[]] image links
      const noteLinksProcessed = replaceLinks(
        sourcesSectionProcessed,
        /(?<!!)\[\[([^\]]+)]]/g,
        (file: TFile) =>
          `<a href="obsidian://open?file=${encodeURIComponent(file.path)}">${file.basename}</a>`
      );

      return noteLinksProcessed;
    },
    [app, isStreaming]
  );

  const processSourcesSection = (content: string): string => {
    const sections = content.split("\n\n#### Sources:\n\n");
    if (sections.length !== 2) return content;

    const [mainContent, sources] = sections;
    const sourceLinks = sources
      .split("\n")
      .map((line) => {
        const match = line.match(/- \[\[(.*?)\]\]/);
        if (match) {
          return `<li>[[${match[1]}]]</li>`;
        }
        return line;
      })
      .join("\n");

    return (
      mainContent +
      "\n\n<br/>\n<details><summary>Sources</summary>\n<ul>\n" +
      sourceLinks +
      "\n</ul>\n</details>"
    );
  };

  useEffect(() => {
    const roots: Root[] = [];
    if (contentRef.current && message.sender !== USER_SENDER) {
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

      // Process code blocks after rendering
      const codeBlocks = contentRef.current.querySelectorAll("pre");
      if (codeBlocks.length > 0) {
        codeBlocks.forEach((pre) => {
          const codeElement = pre.querySelector("code");
          if (!codeElement) return;

          const originalCode = codeElement.textContent || "";
          const lines = originalCode.split("\n");
          const firstLine = lines[0].trim();

          // Check for path in HTML comment format: <!-- path=Notes/My Notes.md -->
          const htmlCommentMatch = firstLine.match(/<!--\s*path=([^>]+?)\s*-->/);
          if (htmlCommentMatch && htmlCommentMatch[1]) {
            const path = htmlCommentMatch[1].trim();
            const cleanedCode = lines.slice(1).join("\n");

            // Create a container for the React component
            const container = document.createElement("div");
            pre.parentNode?.replaceChild(container, pre);

            // Create a root and render the CodeBlock component
            const root = createRoot(container);
            root.render(
              <CodeBlock
                code={cleanedCode}
                path={path}
                onApply={isStreaming ? undefined : handleApplyCode}
              />
            );
            roots.push(root);
          }
        });
      }
    }

    // Cleanup function
    return () => {
      if (componentRef.current) {
        componentRef.current.unload();
        componentRef.current = null;
      }

      roots.forEach((root) => {
        root.unmount();
      });
    };
  }, [message, app, componentRef, isStreaming, preprocess, handleApplyCode]);

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

  const handleInsertIntoEditor = () => {
    let leaf = app.workspace.getMostRecentLeaf();
    if (!leaf || !(leaf.view instanceof MarkdownView)) {
      leaf = app.workspace.getLeaf(false);
      if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    }

    const editor = leaf.view.editor;
    const hasSelection = editor.getSelection().length > 0;
    insertIntoEditor(message.message, hasSelection);
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
                    <div className="whitespace-pre-wrap break-words font-normal text-[calc(var(--font-text-size)_-_2px)]">
                      {message.message}
                    </div>
                  ) : (
                    <div
                      ref={contentRef}
                      className={message.isErrorMessage ? "text-error" : ""}
                    ></div>
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
      <div className="whitespace-pre-wrap break-words font-normal text-[calc(var(--font-text-size)_-_2px)]">
        {message.message}
      </div>
    ) : (
      <div ref={contentRef} className={message.isErrorMessage ? "text-error" : ""}></div>
    );
  };

  return (
    <div className="flex flex-col w-full my-1">
      <div
        className={cn(
          "flex rounded-md p-2 mx-2 gap-2 group",
          message.sender === USER_SENDER && "border border-border border-solid"
        )}
      >
        <div className="w-6 shrink-0">{message.sender === USER_SENDER ? <User /> : <Bot />}</div>
        <div className="flex flex-col flex-grow max-w-full gap-2 overflow-hidden">
          {!isEditing && <MessageContext context={message.context} />}
          <div className="message-content">{renderMessageContent()}</div>

          {!isStreaming && (
            <div className="flex justify-between items-center">
              <div className="text-faint text-xs">{message.timestamp?.display}</div>
              <ChatButtons
                message={message}
                onCopy={copyToClipboard}
                isCopied={isCopied}
                onInsertIntoEditor={handleInsertIntoEditor}
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
