import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { SourcesModal } from "@/components/modals/SourcesModal";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { USER_SENDER } from "@/constants";
import { cn } from "@/lib/utils";
import { ChatMessage } from "@/sharedState";
import { insertIntoEditor } from "@/utils";
import { Bot, User } from "lucide-react";
import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "obsidian";
import { BrevilabsClient, ComposerApplyRequest } from "@/LLMProviders/brevilabsClient";

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

  const handleApplyCode = useCallback(
    async (path: string, code: string) => {
      try {
        // Get the file from the path
        const file = app.vault.getAbstractFileByPath(path);

        if (!file || !(file instanceof TFile)) {
          new Notice(`File not found: ${path}`);
          return;
        }

        // Get the original content
        const originalContent = await app.vault.read(file);

        // Check if the current active note is the same as the target note
        const activeFile = app.workspace.getActiveFile();
        if (!activeFile || activeFile.path !== file.path) {
          // If not, open the target file in the current leaf
          await app.workspace.getLeaf().openFile(file);
          new Notice(`Switched to ${file.name}`);
        }

        try {
          // Call the composer apply endpoint
          const brevilabsClient = BrevilabsClient.getInstance();

          // Convert chat history to the format expected by the API
          const formattedChatHistory = chatHistory
            .filter((msg) => msg.isVisible)
            .map((msg) => ({
              role: msg.sender === USER_SENDER ? "user" : "assistant",
              content: msg.message,
            }));

          // Create the request object
          const request: ComposerApplyRequest = {
            target_note: {
              title: file.basename,
              content: originalContent,
            },
            chat_history: formattedChatHistory,
            markdown_block: code,
          };

          // Call the composer apply endpoint

          console.log("==== Composer Request ====\n", request);
          const response = await brevilabsClient.composerApply(request);

          // Use the content from the response
          const newContent = response.content;

          // Open the Apply View in a new leaf with the processed content
          const leaf = app.workspace.getLeaf(true);
          await leaf.setViewState({
            type: "obsidian-copilot-apply-view",
            active: true,
            state: {
              file: file,
              originalContent: originalContent,
              newContent: newContent,
              path: path,
            },
          });
        } catch (error) {
          console.error("Error calling composer apply:", error);
          new Notice(`Error processing code: ${error.message}`);

          // Fallback to original behavior if composer apply fails
          const leaf = app.workspace.getLeaf(true);
          await leaf.setViewState({
            type: "obsidian-copilot-apply-view",
            active: true,
            state: {
              file: file,
              originalContent: originalContent,
              newContent: code,
              path: path,
            },
          });
        }
      } catch (error) {
        console.error("Error applying code:", error);
        new Notice(`Error applying code: ${error.message}`);
      }
    },
    [app, chatHistory]
  );

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

      const replaceLinks = (text: string, regex: RegExp, template: (file: TFile) => string) =>
        text.replace(regex, (match: string, selection: string) => {
          const file = app.metadataCache.getFirstLinkpathDest(selection, sourcePath);
          return file ? template(file) : match;
        });

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

      // Function to add apply buttons to code blocks
      const addApplyButtonsToCodeBlocks = () => {
        if (!contentRef.current) return;

        // Find all pre elements (code blocks) in the rendered content
        const codeBlocks = contentRef.current.querySelectorAll("pre");

        codeBlocks.forEach((pre) => {
          // Create apply button
          const applyButton = document.createElement("button");
          applyButton.className = "apply-code-button";
          applyButton.textContent = "Apply";
          applyButton.title = "Apply this code";

          // Get the code element
          const codeElement = pre.querySelector("code");
          if (!codeElement) return;

          // Process the code block to extract metadata and clean the display
          const originalCode = codeElement.textContent || "";
          const lines = originalCode.split("\n");
          const firstLine = lines[0].trim();

          // Check if the first line contains path= or other metadata
          let pathMatch = null;

          // Check for path in HTML comment format: <!-- path=Notes/My Notes.md -->
          const htmlCommentMatch = firstLine.match(/<!--\s*path=([^>]+?)\s*-->/);
          if (htmlCommentMatch && htmlCommentMatch[1]) {
            pathMatch = htmlCommentMatch[1].trim();
          }

          if (pathMatch) {
            // Create a path indicator at the top of the code block
            const pathIndicator = document.createElement("div");
            pathIndicator.className = "code-path-indicator";
            pathIndicator.textContent = pathMatch;
            pathIndicator.style.fontSize = "0.8em";
            pathIndicator.style.padding = "0.2rem 0.5rem";
            pathIndicator.style.borderBottom = "1px solid var(--background-modifier-border)";
            pathIndicator.style.color = "var(--text-muted)";

            // Insert the path indicator before the code element
            pre.insertBefore(pathIndicator, codeElement);

            // Remove the path from the first line
            const cleanedCode = lines.slice(1).join("\n");
            codeElement.textContent = cleanedCode;

            // Store the original code and metadata as data attributes
            pre.dataset.originalCode = originalCode;
            pre.dataset.path = pathMatch;

            // Add click event listener to the apply button
            applyButton.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (pre.dataset.path && pre.dataset.originalCode) {
                handleApplyCode(pre.dataset.path, codeElement.textContent || "");
              }
            });

            // Add the apply button to the pre element only when path is found
            pre.appendChild(applyButton);
          } else {
            // No path found, find and reposition Obsidian's copy button to the right
            const copyButton = pre.querySelector(".copy-code-button") as HTMLElement;
            if (copyButton) {
              // Reposition the copy button to the right
              copyButton.style.right = "0";
              copyButton.style.borderRadius = "0 4px 0 4px"; // Use the right-side border radius
            }
          }
        });
      };

      // Add apply buttons to code blocks after rendering
      addApplyButtonsToCodeBlocks();
    }

    // Cleanup function
    return () => {
      if (componentRef.current) {
        componentRef.current.unload();
        componentRef.current = null;
      }
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
        <div className="flex flex-col flex-grow max-w-full gap-2">
          {!isEditing && <MessageContext context={message.context} />}
          <div className="message-content">{renderMessageContent()}</div>

          {!isStreaming && (
            <div className="flex justify-between items-center">
              <div className="text-faint text-xs">{message.timestamp?.display}</div>
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
