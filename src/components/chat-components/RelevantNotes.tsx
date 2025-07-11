import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveFile } from "@/hooks/useActiveFile";
import { cn } from "@/lib/utils";
import {
  findRelevantNotes,
  getSimilarityCategory,
  RelevantNoteEntry,
} from "@/search/findRelevantNotes";
import VectorStoreManager from "@/search/vectorStoreManager";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileInput,
  FileOutput,
  Info,
  PlusCircle,
  RefreshCcw,
  TriangleAlert,
} from "lucide-react";
import { Notice, TFile } from "obsidian";
import React, { memo, useEffect, useState, useCallback } from "react";

function useRelevantNotes(refresher: number) {
  const [relevantNotes, setRelevantNotes] = useState<RelevantNoteEntry[]>([]);
  const activeFile = useActiveFile();

  useEffect(() => {
    async function fetchNotes() {
      if (!activeFile?.path) return;
      const db = await VectorStoreManager.getInstance().getDb();
      const notes = await findRelevantNotes({ db, filePath: activeFile.path });
      setRelevantNotes(notes);
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
      const hasIndex = await VectorStoreManager.getInstance().hasIndex(notePath);
      setHasIndex(hasIndex);
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
    onInsertToChat,
    defaultOpen = false,
  }: {
    className?: string;
    onInsertToChat: (prompt: string) => void;
    defaultOpen?: boolean;
  }) => {
    const [refresher, setRefresher] = useState(0);
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const relevantNotes = useRelevantNotes(refresher);
    const activeFile = useActiveFile();
    const hasIndex = useHasIndex(activeFile?.path ?? "", refresher);
    const navigateToNote = (notePath: string, openInNewLeaf = false) => {
      const file = app.vault.getAbstractFileByPath(notePath);
      if (file instanceof TFile) {
        const leaf = app.workspace.getLeaf(openInNewLeaf);
        leaf.openFile(file);
      }
    };
    const addToChat = (prompt: string) => {
      onInsertToChat(`[[${prompt}]]`);
    };
    const refreshIndex = async () => {
      if (activeFile) {
        await VectorStoreManager.getInstance().reindexFile(activeFile);
        new Notice(`Reindexed ${activeFile.name}`);
        setRefresher(refresher + 1);
      }
    };
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="tw-size-4 tw-text-muted" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="tw-w-64">
                  Relevance is a combination of semantic similarity and links.
                </TooltipContent>
              </Tooltip>

              {!hasIndex && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TriangleAlert className="tw-size-4 tw-text-warning" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Note has not been indexed</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="tw-flex tw-items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost2" size="icon" onClick={refreshIndex}>
                    <RefreshCcw className="tw-size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Reindex Current Note</TooltipContent>
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
              <span className="tw-text-xs tw-text-muted">No relevant notes found</span>
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
