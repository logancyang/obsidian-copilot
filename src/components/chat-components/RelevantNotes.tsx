import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  findRelevantNotes,
  getSimilarityCategory,
  RelevantNoteEntry,
} from "@/search/findRelevantNotes";
import VectorStoreManager from "@/search/vectorStoreManager";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Info,
  PlusCircle,
  RefreshCcw,
  TriangleAlert,
} from "lucide-react";
import React, { forwardRef, memo, useEffect, useState } from "react";
import { Notice, TFile } from "obsidian";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function useRelevantNotes(refresher: number) {
  const [relevantNotes, setRelevantNotes] = useState<RelevantNoteEntry[]>([]);
  const activeFile = app.workspace.getActiveFile();

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

const ExplainerBadge = forwardRef<HTMLDivElement, { children: React.ReactNode }>(
  ({ children, ...props }, ref) => {
    return (
      <div ref={ref} {...props} className="flex gap-2">
        <Badge
          variant="secondary"
          className="text-muted font-normal whitespace-nowrap cursor-default"
        >
          {children}
        </Badge>
      </div>
    );
  }
);

function inSameFolder(path1: string, path2: string) {
  const folder1 = path1.split("/").slice(0, -1).join("/");
  const folder2 = path2.split("/").slice(0, -1).join("/");
  return folder1 === folder2;
}

function SimilarityBadge({ score }: { score: number }) {
  const category = getSimilarityCategory(score);
  let text = "🔴 Low Similarity";
  if (category === 2) text = "🟠 Medium Similarity";
  if (category === 3) text = "🟢 High Similarity";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ExplainerBadge>{text}</ExplainerBadge>
      </TooltipTrigger>
      <TooltipContent side="right">
        Similarity Score: {Math.round(score * 100).toFixed(0)}%
      </TooltipContent>
    </Tooltip>
  );
}

function Metadata({ note }: { note: RelevantNoteEntry }) {
  return (
    <div className="flex gap-1">
      {note.metadata.similarityScore != null && (
        <SimilarityBadge score={note.metadata.similarityScore} />
      )}
      {note.metadata.hasOutgoingLinks && <ExplainerBadge>Outgoing Links</ExplainerBadge>}
      {note.metadata.hasBacklinks && <ExplainerBadge>Backlinks</ExplainerBadge>}
    </div>
  );
}

function RelevantNote({
  showPath = false,
  note,
  onAddToChat,
  onNavigateToNote,
}: {
  showPath: boolean;
  note: RelevantNoteEntry;
  onAddToChat: () => void;
  onNavigateToNote: () => void;
}) {
  return (
    <div className="flex gap-2 p-2 justify-between rounded-md border border-border border-solid">
      <div className="flex flex-col gap-2 flex-1 overflow-hidden">
        <a
          onClick={onNavigateToNote}
          className="text-sm text-normal font-bold text-ellipsis overflow-hidden whitespace-nowrap w-full"
        >
          {note.document.title}
        </a>
        {showPath && (
          <span className="text-xs text-faint text-ellipsis overflow-hidden whitespace-nowrap w-full">
            {note.document.path}
          </span>
        )}
        <div className="flex gap-1">
          <Metadata note={note} />
        </div>
      </div>
      <div className="flex gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="size-6 p-0 !bg-transparent border-none !shadow-none hover:!bg-interactive-hover"
              onClick={onAddToChat}
            >
              <PlusCircle className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Add to Chat</TooltipContent>
        </Tooltip>
      </div>
    </div>
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
  onNavigateToNote: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover key={note.document.path}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="flex flex-col gap-2 overflow-hidden w-fit min-w-72 max-w-96">
        <span className="text-sm text-normal">{note.document.title}</span>
        <span className="text-xs text-muted">{note.document.path}</span>
        <Metadata note={note} />
        <div className="flex gap-2">
          <button
            onClick={onAddToChat}
            className="!bg-transparent inline-flex items-center gap-2 border border-border border-solid !shadow-none hover:!bg-interactive-hover"
          >
            Add to Chat <PlusCircle className="size-4" />
          </button>
          <button
            onClick={onNavigateToNote}
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
    const activeFile = app.workspace.getActiveFile();
    const hasIndex = useHasIndex(activeFile?.path ?? "", refresher);
    const navigateToNote = (notePath: string) => {
      const file = app.vault.getAbstractFileByPath(notePath);
      if (file instanceof TFile) {
        app.workspace.getLeaf(false).openFile(file);
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
          "@container w-full border border-transparent border-b-border border-solid pb-2",
          className
        )}
      >
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex justify-between items-center px-2 pb-2">
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
            <div className="flex gap-2 items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="size-6 p-0 !bg-transparent border-none !shadow-none hover:!bg-interactive-hover"
                    onClick={refreshIndex}
                  >
                    <RefreshCcw className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Reindex Current Note</TooltipContent>
              </Tooltip>
              {relevantNotes.length > 0 && (
                <CollapsibleTrigger asChild>
                  <button className="size-6 p-0 !bg-transparent border-none !shadow-none hover:!bg-interactive-hover">
                    {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
          {relevantNotes.length === 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-1 max-h-12 overflow-y-hidden px-2">
              <span className="text-xs text-muted">No relevant notes found</span>
            </div>
          )}
          {!isOpen && relevantNotes.length > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-1 max-h-6 overflow-y-hidden px-2">
              {relevantNotes.map((note) => (
                <RelevantNotePopover
                  key={note.document.path}
                  note={note}
                  onAddToChat={() => addToChat(note.document.title)}
                  onNavigateToNote={() => navigateToNote(note.document.path)}
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
            <div className="p-2 max-h-96 overflow-y-auto flex flex-col gap-2 @2xl:grid @2xl:grid-cols-2 @4xl:grid-cols-3">
              {relevantNotes.map((note) => (
                <RelevantNote
                  showPath={!inSameFolder(activeFile?.path ?? "", note.document.path)}
                  note={note}
                  key={note.document.path}
                  onAddToChat={() => addToChat(note.document.title)}
                  onNavigateToNote={() => navigateToNote(note.document.path)}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }
);
