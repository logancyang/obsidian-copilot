import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { ToolCallBanner } from "@/components/chat-components/ToolCallBanner";
import { SourcesModal } from "@/components/modals/SourcesModal";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { USER_SENDER } from "@/constants";
import { cn } from "@/lib/utils";
import { parseToolCallMarkers } from "@/LLMProviders/chainRunner/utils/toolCallParser";
import { ChatMessage } from "@/types/message";
import { cleanMessageForCopy, insertIntoEditor } from "@/utils";
import { Bot, User } from "lucide-react";
import { App, Component, MarkdownRenderer, MarkdownView, TFile } from "obsidian";
import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM, { Root } from "react-dom/client";

declare global {
  interface Window {
    __copilotToolCallRoots?: Map<string, Map<string, Root>>;
  }
}

function MessageContext({ context }: { context: ChatMessage["context"] }) {
  if (!context || (!context.notes?.length && !context.urls?.length)) {
    return null;
  }

  return (
    <div className="tw-flex tw-flex-wrap tw-gap-2">
      {context.notes.map((note, index) => (
        <Tooltip key={`${index}-${note.path}`}>
          <TooltipTrigger asChild>
            <Badge variant="secondary">
              <span className="tw-max-w-40 tw-truncate">{note.basename}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{note.path}</TooltipContent>
        </Tooltip>
      ))}
      {context.urls.map((url, index) => (
        <Tooltip key={`${index}-${url}`}>
          <TooltipTrigger asChild>
            <Badge variant="secondary">
              <span className="tw-max-w-40 tw-truncate">{url}</span>
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
  // Use a stable ID for the message to preserve tool call roots across re-renders
  const messageId = useRef(
    message.timestamp?.epoch
      ? String(message.timestamp.epoch)
      : `temp-${Date.now()}-${Math.random()}`
  );

  // Store roots in a global map to preserve them across component instances
  const getGlobalRootsMap = () => {
    if (!window.__copilotToolCallRoots) {
      window.__copilotToolCallRoots = new Map<string, Map<string, Root>>();
    }
    return window.__copilotToolCallRoots;
  };

  const getRootsForMessage = () => {
    const globalMap = getGlobalRootsMap();
    if (!globalMap.has(messageId.current)) {
      globalMap.set(messageId.current, new Map<string, Root>());
    }
    return globalMap.get(messageId.current)!;
  };

  const rootsRef = useRef<Map<string, Root>>(getRootsForMessage());

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
          content = content.replace(completeRegex, (match, sectionContent) => {
            return `<details style="${detailsStyle}">
              <summary style="${summaryStyle}">${summaryText}</summary>
              <div class="tw-text-muted" style="${contentStyle}">${sectionContent.trim()}</div>
            </details>\n\n`;
          });

          // Then handle any unclosed tag, but preserve the streamed content
          const unClosedRegex = new RegExp(`<${tagName}>([\\s\\S]*)$`);
          content = content.replace(
            unClosedRegex,
            (match, partialContent) => `<div style="${detailsStyle}">
              <div style="${summaryStyle}">${streamingSummaryText}</div>
              <div class="tw-text-muted" style="${contentStyle}">${partialContent.trim()}</div>
            </div>`
          );
          return content;
        }

        // Not streaming, process all sections normally
        const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g");
        return content.replace(regex, (match, sectionContent) => {
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

          return text.replace(xmlCodeblockRegex, (match, xmlContent) => {
            // Extract just the content inside the codeblock and return it without the codeblock wrapper
            return xmlContent.trim();
          });
        };

        // During streaming, also handle unclosed writeToFile tags in XML codeblocks
        const unwrapStreamingXmlCodeblocks = (text: string): string => {
          if (!isStreaming) return text;

          // Pattern to match XML codeblocks that contain unclosed writeToFile tags
          const streamingXmlCodeblockRegex = /```xml\s*([\s\S]*?<writeToFile>[\s\S]*?)$/g;

          return text.replace(streamingXmlCodeblockRegex, (match, xmlContent) => {
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

      // Process writeToFile sections
      const writeToFileSectionProcessed = processWriteToFileSection(thinkSectionProcessed);

      // Transform markdown sources section into HTML structure
      const sourcesSectionProcessed = processSourcesSection(writeToFileSectionProcessed);

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
    // Support both "#### Sources" and plain "Sources" headings (optional colon), near the end of message
    const sourcesRegex = /([\s\S]*?)\n+(?:####\s*)?Sources\s*:?\s*\n+([\s\S]*)$/i;
    const match = content.match(sourcesRegex);
    if (!match) return content;

    let mainContent = match[1];
    let sourcesBlock = (match[2] || "").trim();

    // If everything is on one line, insert line breaks before numbered tokens like [1], 2., etc.
    if (!sourcesBlock.includes("\n")) {
      // Ensure a break before every [n]
      sourcesBlock = sourcesBlock.replace(/\s*\[(\d+)\]\s*/g, "\n[$1] ");
      // And before every n. pattern if present
      sourcesBlock = sourcesBlock.replace(/\s+(\d+)\.\s/g, "\n$1. ");
      sourcesBlock = sourcesBlock.trim();
    }

    // If sources are footnote definitions ([^n]: ...), do NOT wrap or transform; just renumber to be contiguous
    const footnoteDefLines = sourcesBlock
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\[\^\d+\]:/.test(l));
    if (footnoteDefLines.length > 0) {
      // Build renumber map based on first-mention order in body; fall back to definition order
      const map = new Map<number, number>();
      const seen = new Set<number>();
      const firstMention: number[] = [];
      const refRe = /\[\^(\d+)\]/g;
      let mref: RegExpExecArray | null;
      while ((mref = refRe.exec(mainContent)) !== null) {
        const n = parseInt(mref[1], 10);
        if (!seen.has(n)) {
          seen.add(n);
          firstMention.push(n);
        }
      }
      if (firstMention.length > 0) {
        firstMention.forEach((n, i) => map.set(n, i + 1));
      } else {
        let idx = 1;
        for (const l of footnoteDefLines) {
          const m = l.match(/^\[\^(\d+)\]:/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (!map.has(n)) map.set(n, idx++);
          }
        }
      }

      // Normalize inline citations for chat readability: render as [n] instead of footnote superscripts
      // 1) Already-footnote refs: [^n] -> [n] (remapped contiguously)
      mainContent = mainContent.replace(/(^|[^[])\[\^(\d+)\]/g, (full, p, n) => {
        const oldN = parseInt(n, 10);
        const newN = map.get(oldN) ?? oldN;
        return `${p}[${newN}]`;
      });
      // 2) Numeric citations like [1] or [1, 2] -> normalize/renumber and render as separate [n][m]
      mainContent = mainContent.replace(
        /(^|[^[])\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g,
        (full, p, nums) => {
          const parts = nums.split(/\s*,\s*/);
          const mapped = parts
            .map((s: string) => {
              const oldN = parseInt(s, 10);
              const newN = map.get(oldN) ?? oldN;
              return `[${newN}]`;
            })
            .join("");
          return `${p}${mapped}`;
        }
      );

      // Convert footnote definitions into a simple ordered list for chat (avoid footnote renderer quirks)
      const items: string[] = [];
      sourcesBlock.split("\n").forEach((line) => {
        const m = line.match(/^\[\^(\d+)\]:\s*(.*)$/);
        if (!m) return;
        const oldN = parseInt(m[1], 10);
        const newN = map.get(oldN) ?? oldN;
        const wl = m[2].match(/\[\[(.*?)\]\]/);
        const display = wl ? `[[${wl[1]}]]` : m[2].replace(/\s*\([^)]*\)\s*$/, "");
        items[newN - 1] = display;
      });

      // Consolidate duplicate sources to prevent multiple entries for the same document
      const uniqueItems: string[] = [];
      const seenTitles = new Set<string>();
      const consolidationMap = new Map<number, number>(); // oldIndex -> newIndex

      items.forEach((item, originalIndex) => {
        if (!item) return;

        // Extract title from wikilink format [[title]] or use the item as-is
        const titleMatch = item.match(/\[\[(.*?)\]\]/);
        const title = titleMatch ? titleMatch[1].toLowerCase() : item.toLowerCase();

        if (!seenTitles.has(title)) {
          seenTitles.add(title);
          uniqueItems.push(item);
          consolidationMap.set(originalIndex + 1, uniqueItems.length); // 1-based indexing
        } else {
          // Find the index of the first occurrence
          const firstOccurrenceIndex = uniqueItems.findIndex((existing) => {
            const existingTitleMatch = existing.match(/\[\[(.*?)\]\]/);
            const existingTitle = existingTitleMatch
              ? existingTitleMatch[1].toLowerCase()
              : existing.toLowerCase();
            return existingTitle === title;
          });
          if (firstOccurrenceIndex >= 0) {
            consolidationMap.set(originalIndex + 1, firstOccurrenceIndex + 1); // 1-based indexing
          }
        }
      });

      // Update citations in main content to reflect consolidated numbering
      let updatedMainContent = mainContent;
      if (consolidationMap.size > 0) {
        updatedMainContent = mainContent.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, nums) => {
          const parts = nums.split(/\s*,\s*/);
          const remappedParts = parts.map((n: string) => {
            const oldNum = parseInt(n, 10);
            return String(consolidationMap.get(oldNum) || oldNum);
          });
          return `[${remappedParts.join(", ")}]`;
        });
      }

      const listMd = uniqueItems.map((t, i) => `${i + 1}. ${t || ""}`).join("\n");
      return `${updatedMainContent}\n\n**Sources:**\n\n${listMd}`;
    }

    // Build renumbering map based on the order of appearance in the sources block
    const oldNumbersInOrder: number[] = [];
    const collectNumber = (n: string) => {
      const num = parseInt(n, 10);
      if (Number.isFinite(num) && !oldNumbersInOrder.includes(num)) {
        oldNumbersInOrder.push(num);
      }
    };
    // Collect numbers from each line
    sourcesBlock.split("\n").forEach((line) => {
      const m1 = line.match(/^- \[(\d+)\]/); // - [n]
      if (m1) collectNumber(m1[1]);
      const m2 = line.match(/^(\d+)\./); // n.
      if (m2) collectNumber(m2[1]);
      const m3 = line.match(/^\[(\d+)\]/); // [n]
      if (m3) collectNumber(m3[1]);
    });

    const renumberMap = new Map<number, number>();
    oldNumbersInOrder.forEach((oldN, idx) => renumberMap.set(oldN, idx + 1));

    // Normalize inline citations in main content to contiguous numbering
    const normalizeInlineCitations = (text: string): string => {
      // Match [n] or [n, m, ...] that are not '[[wikilink]]' and not part of a markdown link '[text]('
      const citationPattern = /(^|[^[])\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g;
      return text.replace(citationPattern, (full, prefix, nums) => {
        const parts = nums.split(/\s*,\s*/);
        const mapped = parts
          .map((p: string) => {
            const oldN = parseInt(p, 10);
            const newN = renumberMap.get(oldN);
            return String(newN ?? oldN);
          })
          .join(", ");
        return `${prefix}[${mapped}]`;
      });
    };

    mainContent = normalizeInlineCitations(mainContent);

    const listItems: string[] = [];
    sourcesBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        // extract index
        const idxMatch = line.match(/^(?:-\s*|\d+\.\s*)?\[(\d+)\]/) || line.match(/^(\d+)\./);
        const idx = idxMatch ? parseInt(idxMatch[1], 10) : NaN;
        const newIdx = Number.isFinite(idx) ? (renumberMap.get(idx) ?? idx) : undefined;
        // prefer wikilink if present
        const wl = line.match(/\[\[(.*?)\]\]/);
        const display = wl
          ? `[[${wl[1]}]]`
          : line.replace(/^(?:-\s*|\d+\.\s*)?\[(\d+)\]\s*/, "").trim();
        if (newIdx !== undefined) {
          listItems[newIdx - 1] = display;
        } else {
          listItems.push(display);
        }
      });

    // Consolidate duplicate sources as redundancy (in case chain runners missed any duplicates)
    const uniqueListItems: string[] = [];
    const seenTitles = new Set<string>();
    const consolidationMap = new Map<number, number>(); // oldIndex -> newIndex

    listItems.forEach((item, originalIndex) => {
      if (!item) return;

      // Extract title from wikilink format [[title]] or use the item as-is
      const titleMatch = item.match(/\[\[(.*?)\]\]/);
      const title = titleMatch ? titleMatch[1].toLowerCase() : item.toLowerCase();

      if (!seenTitles.has(title)) {
        seenTitles.add(title);
        uniqueListItems.push(item);
        consolidationMap.set(originalIndex + 1, uniqueListItems.length); // 1-based indexing
      } else {
        // Find the index of the first occurrence
        const firstOccurrenceIndex = uniqueListItems.findIndex((existing) => {
          const existingTitleMatch = existing.match(/\[\[(.*?)\]\]/);
          const existingTitle = existingTitleMatch
            ? existingTitleMatch[1].toLowerCase()
            : existing.toLowerCase();
          return existingTitle === title;
        });
        if (firstOccurrenceIndex >= 0) {
          consolidationMap.set(originalIndex + 1, firstOccurrenceIndex + 1); // 1-based indexing
        }
      }
    });

    // Update citations in main content to reflect consolidated numbering
    let updatedMainContent = mainContent;
    if (consolidationMap.size > 0) {
      updatedMainContent = mainContent.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, nums) => {
        const parts = nums.split(/\s*,\s*/);
        const remappedParts = parts.map((n: string) => {
          const oldNum = parseInt(n, 10);
          return String(consolidationMap.get(oldNum) || oldNum);
        });
        return `[${remappedParts.join(", ")}]`;
      });
    }

    const listMd = uniqueListItems.map((t, i) => `${i + 1}. ${t || ""}`).join("\n");
    return `${updatedMainContent}\n\n**Sources:**\n\n${listMd}`;
  };

  useEffect(() => {
    let isUnmounting = false;

    if (contentRef.current && message.sender !== USER_SENDER) {
      // Create a new Component instance if it doesn't exist
      if (!componentRef.current) {
        componentRef.current = new Component();
      }

      const processedMessage = preprocess(message.message);
      const parsedMessage = parseToolCallMarkers(processedMessage);

      if (!isUnmounting) {
        // Track existing tool call IDs
        const existingToolCallIds = new Set<string>();
        const existingElements = contentRef.current.querySelectorAll('[id^="tool-call-"]');
        existingElements.forEach((el) => {
          const id = el.id.replace("tool-call-", "");
          existingToolCallIds.add(id);
        });

        // Clear only text content divs, preserve tool call containers
        const textDivs = contentRef.current.querySelectorAll(".message-segment");
        textDivs.forEach((div) => div.remove());

        // Process segments and only update what's needed
        let currentIndex = 0;
        parsedMessage.segments.forEach((segment, index) => {
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
            // Normalize footnotes rendering in chat (hide hr/backrefs and clean ref text)
            try {
              // Hide footnotes separator lines
              textDiv.querySelectorAll("hr, hr.footnotes-sep").forEach((el) => el.remove());
              // Hide backreference arrows in footnotes
              textDiv
                .querySelectorAll("a.footnote-backref, a.footnote-link.footnote-backref")
                .forEach((el) => el.remove());
              // Clean reference text to avoid artifacts like "2-1"
              textDiv
                .querySelectorAll(
                  'a.footnote-ref, sup a[href^="#fn"], sup a[href^="#fn-"], a[href^="#fn"], a[href^="#fn-"]'
                )
                .forEach((a) => {
                  const t = (a.textContent || "").trim();
                  if (!t) return;
                  const cleaned = t.split("-")[0];
                  if (cleaned && cleaned !== t) a.textContent = cleaned;
                });
            } catch {
              /* ignore footnote cleanup errors */
            }
            currentIndex++;
          } else if (segment.type === "toolCall" && segment.toolCall) {
            const toolCallId = segment.toolCall.id;
            const existingDiv = document.getElementById(`tool-call-${toolCallId}`);

            if (existingDiv) {
              // Update existing tool call
              const root = rootsRef.current.get(toolCallId);
              if (root) {
                root.render(
                  <ToolCallBanner
                    toolName={segment.toolCall.toolName}
                    displayName={segment.toolCall.displayName}
                    emoji={segment.toolCall.emoji}
                    isExecuting={segment.toolCall.isExecuting}
                    result={segment.toolCall.result || null}
                    confirmationMessage={segment.toolCall.confirmationMessage}
                  />
                );
              }
              currentIndex++;
            } else {
              // Create new tool call
              const insertBefore = contentRef.current!.children[currentIndex];
              const toolDiv = document.createElement("div");
              toolDiv.className = "tool-call-container";
              toolDiv.id = `tool-call-${toolCallId}`;

              if (insertBefore) {
                contentRef.current!.insertBefore(toolDiv, insertBefore);
              } else {
                contentRef.current!.appendChild(toolDiv);
              }

              const root = ReactDOM.createRoot(toolDiv);
              rootsRef.current.set(toolCallId, root);

              root.render(
                <ToolCallBanner
                  toolName={segment.toolCall.toolName}
                  displayName={segment.toolCall.displayName}
                  emoji={segment.toolCall.emoji}
                  isExecuting={segment.toolCall.isExecuting}
                  result={segment.toolCall.result || null}
                  confirmationMessage={segment.toolCall.confirmationMessage}
                />
              );
              currentIndex++;
            }
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
              const root = rootsRef.current.get(id);
              if (root) {
                // Defer unmounting to avoid React rendering conflicts
                setTimeout(() => {
                  try {
                    root.unmount();
                  } catch (error) {
                    console.debug("Error unmounting tool call root:", error);
                  }
                  rootsRef.current.delete(id);
                }, 0);
              }
              element.remove();
            }
          }
        });
      }
    }

    // Cleanup function
    return () => {
      isUnmounting = true;
    };
  }, [message, app, componentRef, isStreaming, preprocess]);

  // Cleanup effect that only runs on component unmount
  useEffect(() => {
    const currentComponentRef = componentRef;
    const currentMessageId = messageId.current;

    // Clean up old message roots to prevent memory leaks (older than 1 hour)
    const cleanupOldRoots = () => {
      const globalMap = getGlobalRootsMap();
      const oneHourAgo = Date.now() - 60 * 60 * 1000;

      globalMap.forEach((roots, msgId) => {
        // Extract timestamp from message ID if it's in epoch format
        const timestamp = parseInt(msgId);
        if (!isNaN(timestamp) && timestamp < oneHourAgo) {
          // Defer cleanup to avoid React rendering conflicts
          setTimeout(() => {
            roots.forEach((root) => {
              try {
                root.unmount();
              } catch {
                // Ignore errors
              }
            });
            globalMap.delete(msgId);
          }, 0);
        }
      });
    };

    // Run cleanup on mount
    cleanupOldRoots();

    return () => {
      // Defer cleanup to avoid React rendering conflicts
      setTimeout(() => {
        // Clean up component
        if (currentComponentRef.current) {
          currentComponentRef.current.unload();
          currentComponentRef.current = null;
        }

        // Only clean up roots if this is a temporary message (streaming message)
        // Permanent messages keep their roots to preserve tool call banners
        if (currentMessageId.startsWith("temp-")) {
          const globalMap = getGlobalRootsMap();
          const messageRoots = globalMap.get(currentMessageId);

          if (messageRoots) {
            messageRoots.forEach((root) => {
              try {
                root.unmount();
              } catch (error) {
                // Ignore unmount errors during cleanup
                console.debug("Error unmounting React root during cleanup:", error);
              }
            });
            globalMap.delete(currentMessageId);
          }
        }
      }, 0);
    };
  }, []); // Empty dependency array ensures this only runs on unmount

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
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleCancelEdit();
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedMessage(message.message);
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
                  {message.sender === USER_SENDER && isEditing ? (
                    <textarea
                      ref={textareaRef}
                      value={editedMessage}
                      onChange={handleTextareaChange}
                      onKeyDown={handleKeyDown}
                      autoFocus
                      className="edit-textarea"
                    />
                  ) : message.sender === USER_SENDER ? (
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
    return message.sender === USER_SENDER && isEditing ? (
      <textarea
        ref={textareaRef}
        value={editedMessage}
        onChange={handleTextareaChange}
        onKeyDown={handleKeyDown}
        autoFocus
        className="edit-textarea"
      />
    ) : message.sender === USER_SENDER ? (
      <div className="tw-whitespace-pre-wrap tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)] tw-font-normal">
        {message.message}
      </div>
    ) : (
      <div ref={contentRef} className={message.isErrorMessage ? "tw-text-error" : ""}></div>
    );
  };

  return (
    <div className="tw-my-1 tw-flex tw-w-full tw-flex-col">
      <div
        className={cn(
          "tw-group tw-mx-2 tw-flex tw-gap-2 tw-rounded-md tw-p-2",
          message.sender === USER_SENDER && "tw-border tw-border-solid tw-border-border"
        )}
      >
        <div className="tw-w-6 tw-shrink-0">
          {message.sender === USER_SENDER ? <User /> : <Bot />}
        </div>
        <div className="tw-flex tw-max-w-full tw-grow tw-flex-col tw-gap-2 tw-overflow-hidden">
          {!isEditing && <MessageContext context={message.context} />}
          <div className="message-content">{renderMessageContent()}</div>

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
