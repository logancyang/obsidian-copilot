import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { SourcesModal } from "@/components/modals/SourcesModal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextFolderBadge,
  ContextNoteBadge,
  ContextSelectedTextBadge,
  ContextTagBadge,
  ContextUrlBadge,
} from "@/components/chat-components/ContextBadges";
import { InlineMessageEditor } from "@/components/chat-components/InlineMessageEditor";
import { TokenLimitWarning } from "@/components/chat-components/TokenLimitWarning";
import {
  cleanupMessageErrorBlockRoots,
  cleanupMessageToolCallRoots,
  cleanupStaleErrorBlockRoots,
  cleanupStaleToolCallRoots,
  ensureErrorBlockRoot,
  ensureToolCallRoot,
  getMessageErrorBlockRoots,
  getMessageToolCallRoots,
  removeErrorBlockRoot,
  removeToolCallRoot,
  renderErrorBlock,
  renderToolCallBanner,
  type ToolCallRootRecord,
} from "@/components/chat-components/toolCallRootManager";
import { ModelCapability, USER_SENDER } from "@/constants";
import { cn } from "@/lib/utils";
import { parseToolCallMarkers } from "@/LLMProviders/chainRunner/utils/toolCallParser";
import { processInlineCitations } from "@/LLMProviders/chainRunner/utils/citationUtils";
import { ChatMessage } from "@/types/message";
import { cleanMessageForCopy, findCustomModel, insertIntoEditor } from "@/utils";
import { App, Component, MarkdownRenderer, MarkdownView, TFile } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModelKey } from "@/aiParams";
import { useSettingsValue } from "@/settings/model";

const FOOTNOTE_SUFFIX_PATTERN = /^\d+-\d+$/;

/**
 * Normalizes rendered markdown footnotes to align with inline citation UX.
 * Removes separators/backrefs and fixes numbering artifacts (e.g., "2-1").
 */
export const normalizeFootnoteRendering = (root: HTMLElement): void => {
  const footnoteSection = root.querySelector(".footnotes");

  if (footnoteSection) {
    footnoteSection.querySelectorAll("hr, hr.footnotes-sep").forEach((el) => el.remove());
    footnoteSection
      .querySelectorAll("a.footnote-backref, a.footnote-link.footnote-backref")
      .forEach((el) => el.remove());
  } else {
    root
      .querySelectorAll("a.footnote-backref, a.footnote-link.footnote-backref")
      .forEach((el) => el.remove());
  }

  root
    .querySelectorAll(
      'a.footnote-ref, sup a[href^="#fn"], sup a[href^="#fn-"], a[href^="#fn"], a[href^="#fn-"]'
    )
    .forEach((anchor) => {
      const text = anchor.textContent?.trim() ?? "";
      if (!text || !FOOTNOTE_SUFFIX_PATTERN.test(text)) {
        return;
      }

      const [primary] = text.split("-");
      if (primary && primary !== text) {
        anchor.textContent = primary;
      }
    });
};

function MessageContext({ context }: { context: ChatMessage["context"] }) {
  if (
    !context ||
    (!context.notes?.length &&
      !context.urls?.length &&
      !context.tags?.length &&
      !context.folders?.length &&
      !context.selectedTextContexts?.length)
  ) {
    return null;
  }

  return (
    <div className="tw-flex tw-flex-wrap tw-gap-2">
      {context.notes.map((note, index) => (
        <Tooltip key={`note-${index}-${note.path}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextNoteBadge note={note} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{note.path}</TooltipContent>
        </Tooltip>
      ))}
      {context.urls.map((url, index) => (
        <Tooltip key={`url-${index}-${url}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextUrlBadge url={url} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{url}</TooltipContent>
        </Tooltip>
      ))}
      {context.tags?.map((tag, index) => (
        <Tooltip key={`tag-${index}-${tag}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextTagBadge tag={tag} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{tag}</TooltipContent>
        </Tooltip>
      ))}
      {context.folders?.map((folder, index) => (
        <Tooltip key={`folder-${index}-${folder}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextFolderBadge folder={folder} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{folder}</TooltipContent>
        </Tooltip>
      ))}
      {context.selectedTextContexts?.map((selectedText, index) => (
        <Tooltip key={`selectedText-${index}-${selectedText.id}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextSelectedTextBadge selectedText={selectedText} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">
            {selectedText.notePath}
          </TooltipContent>
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
  const contentRef = useRef<HTMLDivElement>(null);
  const componentRef = useRef<Component | null>(null);
  const isUnmountingRef = useRef<boolean>(false);
  // Use a stable ID for the message to preserve tool call roots across re-renders
  // Prefer message.id (persistent) over timestamp.epoch (regenerated on load)
  const messageId = useRef(
    message.id ||
      (message.timestamp?.epoch
        ? String(message.timestamp.epoch)
        : `temp-${Date.now()}-${Math.random()}`)
  );

  // Store roots in a global map to preserve them across component instances
  const rootsRef = useRef<Map<string, ToolCallRootRecord>>(
    getMessageToolCallRoots(messageId.current)
  );

  // Store error block roots separately to prevent ID collisions and race conditions
  const errorRootsRef = useRef<Map<string, ToolCallRootRecord>>(
    getMessageErrorBlockRoots(messageId.current)
  );

  // Check if current model has reasoning capability
  const settings = useSettingsValue();
  const [modelKey] = useModelKey();
  const shouldProcessThinkBlocks = useMemo(() => {
    try {
      const currentModel = findCustomModel(modelKey, settings.activeModels);
      return currentModel.capabilities?.includes(ModelCapability.REASONING) ?? false;
    } catch {
      // If we can't find the model, default to processing thinking blocks
      return true;
    }
  }, [modelKey, settings.activeModels]);

  const copyToClipboard = () => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    const cleanedContent = cleanMessageForCopy(message.message);
    navigator.clipboard.writeText(cleanedContent).then(() => {
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

      /**
       * Escapes dataview code blocks to prevent execution in AI responses.
       * Converts ```dataview to ```text and ```dataviewjs to ```javascript
       * so they display as static code examples instead of executing queries.
       */
      const escapeDataviewCodeBlocks = (text: string): string => {
        // Replace ```dataview (with optional whitespace before newline/end)
        text = text.replace(/```dataview(\s*(?:\n|$))/g, "```text$1");
        // Replace ```dataviewjs (with optional whitespace before newline/end)
        text = text.replace(/```dataviewjs(\s*(?:\n|$))/g, "```javascript$1");
        return text;
      };

      /**
       * Escapes tasks code blocks to prevent execution in AI responses.
       * Converts ```tasks to ```text so they display as static code examples
       * instead of executing task queries.
       */
      const escapeTasksCodeBlocks = (text: string): string => {
        // Replace ```tasks (with optional whitespace before newline/end)
        text = text.replace(/```tasks(\s*(?:\n|$))/g, "```text$1");
        return text;
      };

      const processCollapsibleSection = (
        content: string,
        tagName: string,
        summaryText: string,
        streamingSummaryText: string
      ): string => {
        // Common styles as template strings
        const detailsStyle = `margin: 0.5rem 0 1.5rem; padding: 0.75rem; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-secondary)`;
        const summaryStyle = `cursor: pointer; color: var(--text-muted); font-size: 0.8em; margin-bottom: 0.5rem; user-select: none`;
        const contentStyle = `margin-top: 0.75rem; padding: 0.75rem; border-radius: 4px; background-color: var(--background-primary)`;

        const openTag = `<${tagName}>`;

        // During streaming, if we find any tag that's either unclosed or being processed
        if (isStreaming && content.includes(openTag)) {
          // Replace any complete sections first
          const completeRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g");
          content = content.replace(completeRegex, (_match, sectionContent) => {
            return `<details style="${detailsStyle}">
              <summary style="${summaryStyle}">${summaryText}</summary>
              <div class="tw-text-muted" style="${contentStyle}">${sectionContent.trim()}</div>
            </details>\n\n`;
          });

          // Then handle any unclosed tag, but preserve the streamed content
          const unClosedRegex = new RegExp(`<${tagName}>([\\s\\S]*)$`);
          content = content.replace(
            unClosedRegex,
            (_match, partialContent) => `<div style="${detailsStyle}">
              <div style="${summaryStyle}">${streamingSummaryText}</div>
              <div class="tw-text-muted" style="${contentStyle}">${partialContent.trim()}</div>
            </div>`
          );
          return content;
        }

        // Not streaming, process all sections normally
        const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g");
        return content.replace(regex, (_match, sectionContent) => {
          return `<details style="${detailsStyle}">
            <summary style="${summaryStyle}">${summaryText}</summary>
            <div class="tw-text-muted" style="${contentStyle}">${sectionContent.trim()}</div>
          </details>\n\n`;
        });
      };

      const processThinkSection = (content: string): string => {
        return processCollapsibleSection(content, "think", "Thought for a while", "Thinking...");
      };

      const processWriteToFileSection = (content: string): string => {
        // First, unwrap any XML codeblocks that contain writeToFile tags
        const unwrapXmlCodeblocks = (text: string): string => {
          // Pattern to match XML codeblocks that contain writeToFile tags
          const xmlCodeblockRegex =
            /```(?:xml)?\s*([\s\S]*?<writeToFile>[\s\S]*?<\/writeToFile>[\s\S]*?)\s*```/g;

          return text.replace(xmlCodeblockRegex, (_match, xmlContent) => {
            // Extract just the content inside the codeblock and return it without the codeblock wrapper
            return xmlContent.trim();
          });
        };

        // During streaming, also handle unclosed writeToFile tags in XML codeblocks
        const unwrapStreamingXmlCodeblocks = (text: string): string => {
          if (!isStreaming) return text;

          // Pattern to match XML codeblocks that contain unclosed writeToFile tags
          const streamingXmlCodeblockRegex = /```xml\s*([\s\S]*?<writeToFile>[\s\S]*?)$/g;

          return text.replace(streamingXmlCodeblockRegex, (_match, xmlContent) => {
            // Extract the content and return it without the codeblock wrapper
            return xmlContent.trim();
          });
        };

        // Unwrap XML codeblocks first
        let processedContent = unwrapXmlCodeblocks(content);
        processedContent = unwrapStreamingXmlCodeblocks(processedContent);

        // Then process the writeToFile sections normally
        return processCollapsibleSection(
          processedContent,
          "writeToFile",
          "Generated new content",
          "Generating changes..."
        );
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

      // Escape dataview code blocks first to prevent execution
      const dataviewEscaped = escapeDataviewCodeBlocks(content);

      // Escape tasks code blocks to prevent execution
      const tasksEscaped = escapeTasksCodeBlocks(dataviewEscaped);

      // Process LaTeX
      const latexProcessed = tasksEscaped
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

      // Process think sections only if model has reasoning capability
      const thinkSectionProcessed = shouldProcessThinkBlocks
        ? processThinkSection(noteImageProcessed)
        : noteImageProcessed;

      // Process writeToFile sections
      const writeToFileSectionProcessed = processWriteToFileSection(thinkSectionProcessed);

      // Transform markdown sources section into HTML structure
      const sourcesSectionProcessed = processInlineCitations(
        writeToFileSectionProcessed,
        settings.enableInlineCitations
      );

      // Transform [[link]] to clickable format but exclude ![[]] image links
      const noteLinksProcessed = replaceLinks(
        sourcesSectionProcessed,
        /(?<!!)\[\[([^\]]+)]]/g,
        (file: TFile) =>
          `<a href="obsidian://open?file=${encodeURIComponent(file.path)}">${file.basename}</a>`
      );

      return noteLinksProcessed;
    },
    [app, isStreaming, shouldProcessThinkBlocks, settings.enableInlineCitations]
  );

  useEffect(() => {
    // Reset unmounting flag when effect runs
    isUnmountingRef.current = false;

    if (contentRef.current && message.sender !== USER_SENDER) {
      // Create a new Component instance if it doesn't exist
      if (!componentRef.current) {
        componentRef.current = new Component();
      }

      const originMessage = message.message;
      const processedMessage = preprocess(originMessage);
      const parsedMessage = parseToolCallMarkers(processedMessage, messageId.current);

      if (!isUnmountingRef.current) {
        // Track existing tool call and error block IDs
        const existingToolCallIds = new Set<string>();
        const existingErrorIds = new Set<string>();

        const existingToolCalls = contentRef.current.querySelectorAll('[id^="tool-call-"]');
        existingToolCalls.forEach((el) => {
          const id = el.id.replace("tool-call-", "");
          existingToolCallIds.add(id);
        });

        const existingErrors = contentRef.current.querySelectorAll('[id^="error-block-"]');
        existingErrors.forEach((el) => {
          const id = el.id.replace("error-block-", "");
          existingErrorIds.add(id);
        });

        // Clear only text content divs, preserve tool call and error block containers
        const textDivs = contentRef.current.querySelectorAll(".message-segment");
        textDivs.forEach((div) => div.remove());

        // Process segments and only update what's needed
        let currentIndex = 0;
        parsedMessage.segments.forEach((segment) => {
          if (segment.type === "text" && segment.content.trim()) {
            // Find where to insert this text segment
            const insertBefore = contentRef.current!.children[currentIndex];

            const textDiv = document.createElement("div");
            textDiv.className = "message-segment";

            if (insertBefore) {
              contentRef.current!.insertBefore(textDiv, insertBefore);
            } else {
              contentRef.current!.appendChild(textDiv);
            }

            MarkdownRenderer.renderMarkdown(segment.content, textDiv, "", componentRef.current!);
            normalizeFootnoteRendering(textDiv);
            currentIndex++;
          } else if (segment.type === "toolCall" && segment.toolCall) {
            const toolCallId = segment.toolCall.id;
            let container = document.getElementById(`tool-call-${toolCallId}`);

            if (!container) {
              const insertBefore = contentRef.current!.children[currentIndex];
              const toolDiv = document.createElement("div");
              toolDiv.className = "tool-call-container";
              toolDiv.id = `tool-call-${toolCallId}`;

              if (insertBefore) {
                contentRef.current!.insertBefore(toolDiv, insertBefore);
              } else {
                contentRef.current!.appendChild(toolDiv);
              }

              container = toolDiv;
            }

            const rootRecord = ensureToolCallRoot(
              messageId.current,
              rootsRef.current,
              toolCallId,
              container as HTMLElement,
              "render refresh"
            );

            if (!isUnmountingRef.current && !rootRecord.isUnmounting) {
              renderToolCallBanner(rootRecord, segment.toolCall);
            }

            currentIndex++;
          } else if (segment.type === "error" && segment.error) {
            const errorId = segment.error.id;
            let container = document.getElementById(`error-block-${errorId}`);

            if (!container) {
              // Insert error block at the current stream position
              const insertBefore = contentRef.current!.children[currentIndex];
              const errorDiv = document.createElement("div");
              errorDiv.className = "error-block-container";
              errorDiv.id = `error-block-${errorId}`;

              if (insertBefore) {
                contentRef.current!.insertBefore(errorDiv, insertBefore);
              } else {
                contentRef.current!.appendChild(errorDiv);
              }

              container = errorDiv;
            }

            // Use dedicated error block root to prevent ID collisions with tool calls
            const rootRecord = ensureErrorBlockRoot(
              messageId.current,
              errorRootsRef.current,
              errorId,
              container as HTMLElement,
              "error render"
            );

            if (!isUnmountingRef.current && !rootRecord.isUnmounting) {
              renderErrorBlock(rootRecord, segment.error);
            }

            currentIndex++;
          }
        });

        // Clean up any tool calls that no longer exist
        const currentToolCallIds = new Set(
          parsedMessage.segments
            .filter((s) => s.type === "toolCall" && s.toolCall)
            .map((s) => s.toolCall!.id)
        );

        existingToolCallIds.forEach((id) => {
          if (!currentToolCallIds.has(id)) {
            const element = document.getElementById(`tool-call-${id}`);
            if (element) {
              removeToolCallRoot(messageId.current, rootsRef.current, id, "tool call removal");
              element.remove();
            }
          }
        });

        // Clean up any error blocks that no longer exist
        const currentErrorIds = new Set(
          parsedMessage.segments
            .filter((s) => s.type === "error" && s.error)
            .map((s) => s.error!.id)
        );

        existingErrorIds.forEach((id) => {
          if (!currentErrorIds.has(id)) {
            const element = document.getElementById(`error-block-${id}`);
            if (element) {
              removeErrorBlockRoot(
                messageId.current,
                errorRootsRef.current,
                id,
                "error block removal"
              );
              element.remove();
            }
          }
        });
      }
    }

    // Cleanup function - no longer needed as roots are managed by toolCallRootManager
    return () => {
      isUnmountingRef.current = true;
    };
  }, [message, app, componentRef, isStreaming, preprocess]);

  // Cleanup effect that only runs on component unmount
  useEffect(() => {
    const currentComponentRef = componentRef;
    const currentMessageId = messageId.current;
    const messageRootsSnapshot = rootsRef.current;
    const errorRootsSnapshot = errorRootsRef.current;

    // Clean up old message roots to prevent memory leaks (older than 1 hour)
    const cleanupOldRoots = () => {
      cleanupStaleToolCallRoots();
      cleanupStaleErrorBlockRoots();
    };

    // Run cleanup on mount
    cleanupOldRoots();

    return () => {
      // Set unmounting flag immediately
      isUnmountingRef.current = true;

      // Defer cleanup to avoid React rendering conflicts
      setTimeout(() => {
        // Clean up component
        if (currentComponentRef.current) {
          currentComponentRef.current.unload();
          currentComponentRef.current = null;
        }

        // Only clean up roots if this is a temporary message (streaming message)
        // Permanent messages keep their roots to preserve tool call banners and error blocks
        if (currentMessageId.startsWith("temp-")) {
          cleanupMessageToolCallRoots(currentMessageId, messageRootsSnapshot, "component cleanup");
          cleanupMessageErrorBlockRoots(currentMessageId, errorRootsSnapshot, "component cleanup");
        }
      }, 0);
    };
  }, []); // Empty dependency array ensures this only runs on unmount

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = (newText: string) => {
    setIsEditing(false);
    if (onEdit) {
      onEdit(newText);
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
    const cleanedContent = cleanMessageForCopy(message.message);
    insertIntoEditor(cleanedContent, hasSelection);
  };

  const renderMessageContent = () => {
    if (message.content) {
      return (
        <div className="tw-flex tw-flex-col tw-gap-3">
          {message.content.map((item, index) => {
            if (item.type === "text") {
              return (
                <div key={index}>
                  {message.sender === USER_SENDER ? (
                    <div className="tw-whitespace-pre-wrap tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)] tw-font-normal">
                      {message.message}
                    </div>
                  ) : (
                    <div
                      ref={contentRef}
                      className={message.isErrorMessage ? "tw-text-error" : ""}
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
    return message.sender === USER_SENDER ? (
      <div className="tw-whitespace-pre-wrap tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)] tw-font-normal">
        {message.message}
      </div>
    ) : (
      <div ref={contentRef} className={message.isErrorMessage ? "tw-text-error" : ""}></div>
    );
  };

  // If editing a user message, replace the entire message container with the inline editor
  if (isEditing && message.sender === USER_SENDER) {
    return (
      <div className="tw-my-1 tw-flex tw-w-full tw-flex-col">
        <InlineMessageEditor
          initialValue={message.message}
          initialContext={message.context}
          onSave={handleSaveEdit}
          onCancel={handleCancelEdit}
          app={app}
        />
      </div>
    );
  }

  return (
    <div className="tw-my-1 tw-flex tw-w-full tw-flex-col">
      <div
        className={cn(
          "tw-group tw-mx-2 tw-rounded-md tw-p-2",
          message.sender === USER_SENDER && "tw-border tw-border-solid tw-border-border"
        )}
        style={
          message.sender === USER_SENDER
            ? { backgroundColor: "var(--background-modifier-hover)" }
            : undefined
        }
      >
        <div className="tw-flex tw-max-w-full tw-flex-col tw-gap-2 tw-overflow-hidden">
          {!isEditing && <MessageContext context={message.context} />}
          <div className="message-content">{renderMessageContent()}</div>

          {message.responseMetadata?.wasTruncated && message.sender !== USER_SENDER && (
            <TokenLimitWarning message={message} app={app} />
          )}

          {!isStreaming && (
            <div className="tw-flex tw-items-center tw-justify-between">
              <div className="tw-text-xs tw-text-faint">{message.timestamp?.display}</div>
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
