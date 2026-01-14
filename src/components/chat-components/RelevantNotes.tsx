import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatInput } from "@/context/ChatInputContext";
import { useActiveFile } from "@/hooks/useActiveFile";
import { cn } from "@/lib/utils";
import {
  findRelevantNotes,
  getSimilarityCategory,
  RelevantNoteEntry,
} from "@/search/findRelevantNotes";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileInput,
  FileOutput,
  Loader2,
  PlusCircle,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Notice, TFile } from "obsidian";
import React, { memo, useCallback, useEffect, useState } from "react";
import { getAIResponse } from "@/langchainStream";
import { useChainType } from "@/aiParams";
import { logError } from "@/logger";

function useRelevantNotes(refresher: number) {
  const [relevantNotes, setRelevantNotes] = useState<RelevantNoteEntry[]>([]);
  const activeFile = useActiveFile();

  useEffect(() => {
    async function fetchNotes() {
      if (!activeFile?.path) return;
      // Only show when semantic search is enabled and database is available
      try {
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        const db = await VectorStoreManager.getInstance().getDb();
        if (!db) {
          setRelevantNotes([]);
          return;
        }
        const notes = await findRelevantNotes({ db, filePath: activeFile.path });
        setRelevantNotes(notes);
      } catch (error) {
        console.warn("Failed to fetch relevant notes:", error);
        setRelevantNotes([]);
      }
    }

    fetchNotes();
  }, [activeFile?.path, refresher]);

  return relevantNotes;
}

function useHasIndex(notePath: string, refresher: number) {
  const [hasIndex, setHasIndex] = useState(true);
  useEffect(() => {
    if (!notePath) return;

    async function fetchHasIndex() {
      try {
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        const has = await VectorStoreManager.getInstance().hasIndex(notePath);
        setHasIndex(has);
      } catch {
        setHasIndex(false);
      }
    }

    fetchHasIndex();
  }, [notePath, refresher]);
  return hasIndex;
}

function SimilarityBadge({ score }: { score: number }) {
  const category = getSimilarityCategory(score);
  let text = "🔴";
  if (category === 2) text = "🟠";
  if (category === 3) text = "🟢";
  return <span className="tw-text-sm">{text}</span>;
}

interface RelevantNotesProps {
  className?: string;
  defaultOpen?: boolean;
  isBuildingKvCache?: boolean;
  onBuildingKvCacheChange?: (value: boolean) => void;
}

function RelevantNote({
  note,
  onAddToChat,
  onNavigateToNote,
}: {
  note: RelevantNoteEntry;
  onAddToChat: () => void;
  onNavigateToNote: (openInNewLeaf: boolean) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);

  const loadContent = useCallback(async () => {
    if (fileContent) return; // Don't load if we already have content
    const file = app.vault.getAbstractFileByPath(note.document.path);
    if (file instanceof TFile) {
      const content = await app.vault.cachedRead(file);

      // Remove YAML frontmatter if it exists
      let cleanContent = content;
      if (content.startsWith("---")) {
        const endOfFrontmatter = content.indexOf("---", 3);
        if (endOfFrontmatter !== -1) {
          cleanContent = content.slice(endOfFrontmatter + 3).trim();
        }
      }

      // Take first 1000 characters as preview
      setFileContent(cleanContent.slice(0, 1000) + (cleanContent.length > 1000 ? "..." : ""));
    }
  }, [fileContent, note.document.path]);

  useEffect(() => {
    if (isOpen) {
      loadContent();
    }
  }, [isOpen, loadContent]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="tw-rounded-md tw-border tw-border-solid tw-border-border"
    >
      <div className={cn("tw-flex tw-items-center tw-justify-between tw-gap-2 tw-p-2")}>
        <Button variant="ghost2" size="icon" className="tw-shrink-0" asChild>
          <CollapsibleTrigger>
            <ChevronRight
              className={cn("tw-size-4 tw-transition-transform tw-duration-200", {
                "rotate-90": isOpen,
              })}
            />
          </CollapsibleTrigger>
        </Button>

        <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2">
          <SimilarityBadge score={note.metadata.similarityScore ?? 0} />
        </div>

        <div className="tw-flex-1 tw-overflow-hidden">
          <a
            onClick={(e) => {
              e.preventDefault();
              const openInNewLeaf = e.metaKey || e.ctrlKey;
              onNavigateToNote(openInNewLeaf);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                // Middle click
                e.preventDefault();
                onNavigateToNote(true);
              }
            }}
            className="tw-block tw-w-full tw-truncate tw-text-sm tw-font-bold tw-text-normal"
            title={note.document.title}
          >
            {note.document.title}
          </a>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost2" size="icon" onClick={onAddToChat} className="tw-shrink-0">
              <PlusCircle className="tw-size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add to Chat</TooltipContent>
        </Tooltip>
      </div>

      <CollapsibleContent>
        <div className="tw-border-[0px] tw-border-t tw-border-solid tw-border-border tw-px-4 tw-py-2">
          <div className="tw-whitespace-pre-wrap tw-text-wrap tw-break-all tw-text-xs tw-text-muted tw-opacity-75">
            {note.document.path}
          </div>
          {fileContent && (
            <div className="tw-overflow-hidden tw-whitespace-pre-wrap tw-border-t tw-border-border tw-pb-4 tw-pt-2 tw-text-xs tw-text-normal">
              {fileContent}
            </div>
          )}
        </div>

        <div className="tw-flex tw-items-center tw-gap-4 tw-border-[0px] tw-border-t tw-border-solid tw-border-border tw-px-4 tw-py-2 tw-text-xs tw-text-muted">
          {note.metadata.similarityScore != null && (
            <div className="tw-flex tw-items-center tw-gap-1">
              <span>Similarity: {(note.metadata.similarityScore * 100).toFixed(1)}%</span>
            </div>
          )}
          {note.metadata.hasOutgoingLinks && (
            <div className="tw-flex tw-items-center tw-gap-1">
              <FileOutput className="tw-size-4" />
              <span>Outgoing links</span>
            </div>
          )}
          {note.metadata.hasBacklinks && (
            <div className="tw-flex tw-items-center tw-gap-1">
              <FileInput className="tw-size-4" />
              <span>Backlinks</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RelevantNotePopover({
  note,
  onAddToChat,
  onNavigateToNote,
  children,
}: {
  note: RelevantNoteEntry;
  onAddToChat: () => void;
  onNavigateToNote: (openInNewLeaf: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover key={note.document.path}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="tw-flex tw-w-fit tw-min-w-72 tw-max-w-96 tw-flex-col tw-gap-2 tw-overflow-hidden">
        <span className="tw-text-sm tw-text-normal">{note.document.title}</span>
        <span className="tw-text-xs tw-text-muted">{note.document.path}</span>
        <div className="tw-flex tw-gap-2">
          <button
            onClick={onAddToChat}
            className="tw-inline-flex tw-items-center tw-gap-2 tw-border tw-border-solid tw-border-border !tw-bg-transparent !tw-shadow-none hover:!tw-bg-interactive-hover"
          >
            Add to Chat <PlusCircle className="tw-size-4" />
          </button>
          <button
            onClick={(e) => {
              const openInNewLeaf = e.metaKey || e.ctrlKey;
              onNavigateToNote(openInNewLeaf);
            }}
            className="tw-inline-flex tw-items-center tw-gap-2 tw-border tw-border-solid tw-border-border !tw-bg-transparent !tw-shadow-none hover:!tw-bg-interactive-hover"
          >
            Navigate to Note <ArrowRight className="tw-size-4" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const RelevantNotes = memo(
  ({
    className,
    defaultOpen = false,
    isBuildingKvCache: controlledIsBuildingKvCache,
    onBuildingKvCacheChange,
  }: RelevantNotesProps) => {
    const [refresher] = useState(0);
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const isControlled =
      typeof controlledIsBuildingKvCache === "boolean" && !!onBuildingKvCacheChange;
    const [uncontrolledIsBuildingKvCache, setUncontrolledIsBuildingKvCache] = useState(false);

    const isBuildingKvCache = isControlled
      ? (controlledIsBuildingKvCache as boolean)
      : uncontrolledIsBuildingKvCache;

    const setIsBuildingKvCache = (value: boolean) => {
      if (isControlled) {
        onBuildingKvCacheChange?.(value);
      } else {
        setUncontrolledIsBuildingKvCache(value);
      }
    };
    const relevantNotes = useRelevantNotes(refresher);
    const activeFile = useActiveFile();
    const chatInput = useChatInput();
    const hasIndex = useHasIndex(activeFile?.path ?? "", refresher);
    const [currentChain] = useChainType();

    const navigateToNote = (notePath: string, openInNewLeaf = false) => {
      const file = app.vault.getAbstractFileByPath(notePath);
      if (file instanceof TFile) {
        const leaf = app.workspace.getLeaf(openInNewLeaf);
        leaf.openFile(file);
      }
    };
    const addToChat = (prompt: string) => {
      chatInput.insertTextWithPills(`[[${prompt}]]`, true);
    };

    /**
     * Build KV cache for the active note in the background.
     * Shows a simple loading UI with a minimum visible duration to avoid flicker.
     */
    const buildKvCache = async () => {
      if (!activeFile) {
        new Notice("No active file");
        return;
      }

      if (isBuildingKvCache) {
        return; // Prevent multiple simultaneous builds
      }
      setIsBuildingKvCache(true);
      const startTime = Date.now();

      try {
        // Get plugin instance
        const plugin = (app as any).plugins.getPlugin("aiDAPTIV-Integration-Obsidian");
        if (!plugin) {
          new Notice("aiDAPTIV plugin not found");
          logError("aiDAPTIV plugin not found in app.plugins");
          return;
        }

        // Send message in background through ChatUIState
        const chatUIState = plugin.chatUIState;
        const chainManager = plugin.projectManager.getCurrentChainManager();

        if (!chatUIState) {
          new Notice("ChatUIState not available");
          logError("ChatUIState is undefined");
          return;
        }

        if (!chainManager) {
          new Notice("ChainManager not available");
          logError("ChainManager is undefined");
          return;
        }

        // Create context without explicit notes; rely on includeActiveNote
        // Use same structure as normal chat to ensure identical context processing
        const context = {
          notes: [],
          urls: [],
          tags: [],
          folders: [],
          selectedTextContexts: [],
        };

        // Send a silent message to build KV cache
        // Use a single space as placeholder so that:
        // - Context prefix (system + note context) stays identical to real chat
        // - User content contributes a minimal, almost empty token
        const placeholderMessage = " ";
        const content = [
          {
            type: "text",
            text: placeholderMessage,
          },
        ];

        const messageId = await chatUIState.sendMessage(
          placeholderMessage, // Keep placeholder to go through the normal chat pipeline
          context,
          currentChain,
          true, // Include active note so it is formatted as <active_note> like normal chat
          content // Pass content array to match normal chat structure
        );

        if (!messageId) {
          new Notice("Failed to send message");
          logError("sendMessage returned no messageId");
          return;
        }

        // Get LLM message and trigger AI response in background
        // Don't modify llmMessage.content - it's already processed by ChatManager
        const llmMessage = chatUIState.getLLMMessage(messageId);
        if (llmMessage) {
          // Trigger AI response without updating UI
          // Use maxTokens: 1 to minimize response length (we only need KV cache, not the response)
          // The stream will be aborted after receiving ~1 token worth of content
          await getAIResponse(
            llmMessage,
            chainManager,
            () => {}, // No-op for addMessage (don't show in UI)
            () => {}, // No-op for setCurrentAiMessage
            () => {}, // No-op for setAbortController
            { debug: false, updateLoadingMessage: () => {}, maxTokens: 1 }
          );
        } else {
          logError("getLLMMessage returned null for messageId:", messageId);
        }

        // Clean up the message from chat history (silent operation)
        await chatUIState.deleteMessage(messageId);

        new Notice(`KV cache built for ${activeFile.basename}`);
      } catch (error) {
        logError("Error building KV cache:", error);
        new Notice(`Failed to build KV cache: ${error.message || error}`);
      } finally {
        const MIN_SPINNER_MS = 800;
        const elapsed = Date.now() - startTime;
        if (elapsed < MIN_SPINNER_MS) {
          await new Promise((resolve) => setTimeout(resolve, MIN_SPINNER_MS - elapsed));
        }
        setIsBuildingKvCache(false);
      }
    };
    // Show the UI even without an index so users can build/refresh it

    return (
      <div
        className={cn(
          "tw-w-full tw-border tw-border-solid tw-border-transparent tw-border-b-border tw-pb-2",
          className
        )}
      >
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="tw-flex tw-items-center tw-justify-between tw-pb-2 tw-pl-1">
            <div className="tw-flex tw-flex-1 tw-items-center tw-gap-2">
              <span className="tw-font-semibold tw-text-normal">Relevant Notes</span>
              <HelpTooltip
                content="Relevance is a combination of semantic similarity and links."
                contentClassName="tw-w-64"
                buttonClassName="tw-size-4 tw-text-muted"
              />

              {!hasIndex && (
                <HelpTooltip content="Note has not been indexed" side="bottom">
                  <TriangleAlert className="tw-size-4 tw-text-warning" />
                </HelpTooltip>
              )}
            </div>
            <div className="tw-flex tw-items-center tw-gap-2">
              {isBuildingKvCache && (
                <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                  <Loader2 className="tw-size-4 tw-animate-spin" />
                  <span>Building KV cache...</span>
                </div>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost2"
                    size="icon"
                    onClick={buildKvCache}
                    disabled={isBuildingKvCache}
                  >
                    {isBuildingKvCache ? (
                      <Loader2 className="tw-size-4 tw-animate-spin" />
                    ) : (
                      <Zap className="tw-size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Build Knowledge for Current Note</TooltipContent>
              </Tooltip>
              {relevantNotes.length > 0 && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost2" size="icon">
                    {isOpen ? (
                      <ChevronUp className="tw-size-5" />
                    ) : (
                      <ChevronDown className="tw-size-5" />
                    )}
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
          {relevantNotes.length === 0 && (
            <div className="tw-flex tw-max-h-12 tw-flex-wrap tw-gap-x-2 tw-gap-y-1 tw-overflow-y-hidden tw-px-1">
              <span className="tw-text-xs tw-text-muted">
                {!hasIndex
                  ? "No index available. Click refresh to build index."
                  : "No relevant notes found"}
              </span>
            </div>
          )}
          {!isOpen && relevantNotes.length > 0 && (
            <div className="tw-flex tw-max-h-6 tw-flex-wrap tw-gap-x-2 tw-gap-y-1 tw-overflow-y-hidden tw-px-1">
              {relevantNotes.map((note) => (
                <RelevantNotePopover
                  key={note.document.path}
                  note={note}
                  onAddToChat={() => addToChat(note.document.title)}
                  onNavigateToNote={(openInNewLeaf: boolean) =>
                    navigateToNote(note.document.path, openInNewLeaf)
                  }
                >
                  <Badge
                    variant="outline"
                    key={note.document.path}
                    className="tw-max-w-40 tw-text-xs tw-text-muted hover:tw-cursor-pointer hover:tw-bg-interactive-hover"
                  >
                    <span className="tw-truncate">{note.document.title}</span>
                  </Badge>
                </RelevantNotePopover>
              ))}
            </div>
          )}
          <CollapsibleContent>
            <div className="tw-flex tw-max-h-screen tw-flex-col tw-gap-2 tw-overflow-y-auto tw-px-1 tw-py-2">
              {relevantNotes.map((note) => (
                <RelevantNote
                  note={note}
                  key={note.document.path}
                  onAddToChat={() => addToChat(note.document.title)}
                  onNavigateToNote={(openInNewLeaf: boolean) =>
                    navigateToNote(note.document.path, openInNewLeaf)
                  }
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }
);

RelevantNotes.displayName = "RelevantNotes";
