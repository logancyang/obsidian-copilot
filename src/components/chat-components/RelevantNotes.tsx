import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatInput } from "@/context/ChatInputContext";
import { useActiveFile } from "@/hooks/useActiveFile";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { SemanticSearchToggleModal } from "@/components/modals/SemanticSearchToggleModal";
import type { CopilotSettings } from "@/settings/model";
import {
  findRelevantNotes,
  getSimilarityCategory,
  RelevantNoteEntry,
} from "@/search/findRelevantNotes";
import { onIndexChanged } from "@/search/indexSignal";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileInput,
  FileOutput,
  PlusCircle,
  RefreshCcw,
} from "lucide-react";
import { Notice, TFile } from "obsidian";
import React, { memo, useCallback, useEffect, useState } from "react";

const SELF_HOST_GRACE_PERIOD_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * Return true when Miyo-backed semantic index is expected to be active.
 *
 * @param settings - Current Copilot settings object.
 * @returns True when Miyo mode and self-host validation are active.
 */
function shouldUseMiyoIndex(settings: CopilotSettings): boolean {
  if (!settings.enableMiyoSearch || !settings.enableSemanticSearchV3) {
    return false;
  }

  if (settings.selfHostModeValidatedAt == null) {
    return false;
  }

  if ((settings.selfHostValidationCount ?? 0) >= 3) {
    return true;
  }

  return Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS;
}

function useRelevantNotes(refresher: number) {
  const [relevantNotes, setRelevantNotes] = useState<RelevantNoteEntry[]>([]);
  const [signalTick, setSignalTick] = useState(0);
  const activeFile = useActiveFile();

  useEffect(() => onIndexChanged(() => setSignalTick((t) => t + 1)), []);

  useEffect(() => {
    async function fetchNotes() {
      if (!activeFile?.path) return;
      try {
        const notes = await findRelevantNotes({ filePath: activeFile.path });
        setRelevantNotes(notes);
      } catch (error) {
        logWarn("Failed to fetch relevant notes", error);
        setRelevantNotes([]);
      }
    }

    fetchNotes();
  }, [activeFile?.path, refresher, signalTick]);

  return relevantNotes;
}

function useHasIndex(notePath: string, refresher: number) {
  const [hasIndex, setHasIndex] = useState(true);
  const [signalTick, setSignalTick] = useState(0);

  useEffect(() => onIndexChanged(() => setSignalTick((t) => t + 1)), []);

  useEffect(() => {
    if (!notePath) return;

    async function fetchHasIndex() {
      try {
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        const { getSettings } = await import("@/settings/model");
        const settings = getSettings();
        const shouldUseMiyo = shouldUseMiyoIndex(settings);

        if (shouldUseMiyo) {
          const isEmpty = await VectorStoreManager.getInstance().isIndexEmpty();
          setHasIndex(!isEmpty);
          return;
        }

        const has = await VectorStoreManager.getInstance().hasIndex(notePath);
        setHasIndex(has);
      } catch {
        setHasIndex(false);
      }
    }

    fetchHasIndex();
  }, [notePath, refresher, signalTick]);
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
  ({ className, defaultOpen = false }: { className?: string; defaultOpen?: boolean }) => {
    const [refresher, setRefresher] = useState(0);
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const relevantNotes = useRelevantNotes(refresher);
    const activeFile = useActiveFile();
    const chatInput = useChatInput();
    const hasIndex = useHasIndex(activeFile?.path ?? "", refresher);
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
    const refreshIndex = async () => {
      if (activeFile) {
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        await VectorStoreManager.getInstance().reindexFile(activeFile);
        new Notice(`Refreshed index for ${activeFile.basename}`);
        setRefresher(refresher + 1);
      }
    };

    const handleBuildIndex = async () => {
      const { getSettings, updateSetting } = await import("@/settings/model");
      const settings = getSettings();

      if (!settings.enableSemanticSearchV3) {
        // Semantic search is off — show confirmation modal (same as settings page)
        new SemanticSearchToggleModal(
          app,
          async () => {
            updateSetting("enableSemanticSearchV3", true);
            const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
            await VectorStoreManager.getInstance().indexVaultToVectorStore(false, {
              userInitiated: true,
            });
            setRefresher(refresher + 1);
          },
          true // enabling
        ).open();
      } else {
        // Semantic search is on but index missing — build it
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        await VectorStoreManager.getInstance().indexVaultToVectorStore(false, {
          userInitiated: true,
        });
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
              <HelpTooltip
                content="Relevance is a combination of semantic similarity and links. Requires semantic search setting on."
                contentClassName="tw-w-64"
                buttonClassName="tw-size-4 tw-text-muted"
              />
            </div>
            <div className="tw-flex tw-items-center">
              {hasIndex ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost2" size="icon" onClick={refreshIndex}>
                      <RefreshCcw className="tw-size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Reindex Current Note</TooltipContent>
                </Tooltip>
              ) : (
                <Button variant="secondary" size="sm" onClick={handleBuildIndex}>
                  Build Index
                </Button>
              )}
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
          {relevantNotes.length === 0 && hasIndex && (
            <div className="tw-flex tw-max-h-12 tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-1 tw-overflow-y-hidden tw-px-1">
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
