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
  return <span className="text-sm">{text}</span>;
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
      className="rounded-md border border-border border-solid"
    >
      <div className={cn("flex gap-2 p-2 justify-between items-center")}>
        <Button variant="ghost2" size="icon" className="shrink-0" asChild>
          <CollapsibleTrigger>
            <ChevronRight
              className={cn("size-4 transition-transform duration-200", {
                "transform rotate-90": isOpen,
              })}
            />
          </CollapsibleTrigger>
        </Button>

        <div className="flex items-center gap-2 shrink-0">
          <SimilarityBadge score={note.metadata.similarityScore ?? 0} />
        </div>

        <div className="flex-1 overflow-hidden">
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
            className="text-sm text-normal font-bold text-ellipsis overflow-hidden whitespace-nowrap w-full block"
          >
            {note.document.title}
          </a>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost2" size="icon" onClick={onAddToChat} className="shrink-0">
              <PlusCircle className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add to Chat</TooltipContent>
        </Tooltip>
      </div>

      <CollapsibleContent>
        <div className="px-4 py-2 border-[0px] border-t border-border border-solid">
          <div className="text-xs text-muted text-wrap opacity-75 break-all whitespace-pre-wrap">
            {note.document.path}
          </div>
          {fileContent && (
            <div className="text-xs text-normal whitespace-pre-wrap pt-2 pb-4 border-t border-border overflow-hidden">
              {fileContent}
            </div>
          )}
        </div>

        <div className="flex item-center gap-4 px-4 py-2 border-[0px] border-t border-solid border-border text-xs text-muted">
          {note.metadata.similarityScore != null && (
            <div className="flex items-center gap-1">
              <span>Similarity: {(note.metadata.similarityScore * 100).toFixed(1)}%</span>
            </div>
          )}
          {note.metadata.hasOutgoingLinks && (
            <div className="flex items-center gap-1">
              <FileOutput className="size-4" />
              <span>Outgoing links</span>
            </div>
          )}
          {note.metadata.hasBacklinks && (
            <div className="flex items-center gap-1">
              <FileInput className="size-4" />
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
      <PopoverContent className="flex flex-col gap-2 overflow-hidden w-fit min-w-72 max-w-96">
        <span className="text-sm text-normal">{note.document.title}</span>
        <span className="text-xs text-muted">{note.document.path}</span>
        <div className="flex gap-2">
          <button
            onClick={onAddToChat}
            className="!bg-transparent inline-flex items-center gap-2 border border-border border-solid !shadow-none hover:!bg-interactive-hover"
          >
            Add to Chat <PlusCircle className="size-4" />
          </button>
          <button
            onClick={(e) => {
              const openInNewLeaf = e.metaKey || e.ctrlKey;
              onNavigateToNote(openInNewLeaf);
            }}
            className="!bg-transparent inline-flex items-center gap-2 border border-border border-solid !shadow-none hover:!bg-interactive-hover"
          >
            Navigate to Note <ArrowRight className="size-4" />
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
          "w-full border border-transparent border-b-border border-solid pb-2",
          className
        )}
      >
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex justify-between items-center pl-1 pb-2">
            <div className="flex gap-2 items-center flex-1">
              <span className="font-semibold text-normal">Relevant Notes</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="size-4 text-muted" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="w-64">
                  Relevance is a combination of semantic similarity and links.
                </TooltipContent>
              </Tooltip>

              {!hasIndex && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TriangleAlert className="size-4 text-warning" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Note has not been indexed</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost2" size="icon" onClick={refreshIndex}>
                    <RefreshCcw className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Reindex Current Note</TooltipContent>
              </Tooltip>
              {relevantNotes.length > 0 && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost2" size="icon">
                    {isOpen ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
          {relevantNotes.length === 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-1 max-h-12 overflow-y-hidden px-1">
              <span className="text-xs text-muted">No relevant notes found</span>
            </div>
          )}
          {!isOpen && relevantNotes.length > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-1 max-h-6 overflow-y-hidden px-1">
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
                    className="text-xs max-w-40 text-muted hover:cursor-pointer hover:bg-interactive-hover"
                  >
                    <span className="text-ellipsis overflow-hidden whitespace-nowrap">
                      {note.document.title}
                    </span>
                  </Badge>
                </RelevantNotePopover>
              ))}
            </div>
          )}
          <CollapsibleContent>
            <div className="px-1 py-2 max-h-screen overflow-y-auto flex flex-col gap-2">
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
