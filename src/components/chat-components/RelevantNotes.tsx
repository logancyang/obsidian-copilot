import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  RelevantNotesPane,
  type RelevantNotesGuidance,
} from "@/components/chat-components/ui/RelevantNotesPane";
import { MIYO_HOMEPAGE_URL } from "@/constants";
import { useApp } from "@/context";
import { useActiveFile } from "@/hooks/useActiveFile";
import { useNoteDrag } from "@/hooks/useNoteDrag";
import { cn } from "@/lib/utils";
import { logError, logWarn } from "@/logger";
import { findRelevantNotes, RelevantNoteEntry } from "@/search/findRelevantNotes";
import { onIndexChanged } from "@/search/indexSignal";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { openCopilotSettings } from "@/settings/openSettings";
import { useSettingsValue } from "@/settings/model";
import { ArrowRight, EyeOff, FileInput, FileOutput, FileText, PlusCircle } from "lucide-react";
import { TFile } from "obsidian";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";

function useRelevantNotes(enableMiyo: boolean, miyoServerUrl: string) {
  const app = useApp();
  const [relevantNotes, setRelevantNotes] = useState<RelevantNoteEntry[]>([]);
  const [signalTick, setSignalTick] = useState(0);
  const activeFile = useActiveFile();

  useEffect(() => onIndexChanged(() => setSignalTick((t) => t + 1)), []);

  useEffect(() => {
    let cancelled = false;

    async function fetchNotes() {
      if (!activeFile?.path) return;
      try {
        const notes = await findRelevantNotes({ app, filePath: activeFile.path });
        // A settings or active-note change can supersede an in-flight Miyo
        // request. Its older result must not replace the newer pane state.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
        if (!cancelled) setRelevantNotes(notes);
      } catch (error) {
        if (!cancelled) {
          logWarn("Failed to fetch relevant notes", error);
          setRelevantNotes([]);
        }
      }
    }

    void fetchNotes();
    return () => {
      cancelled = true;
    };
  }, [app, activeFile?.path, enableMiyo, miyoServerUrl, signalTick]);

  return relevantNotes;
}

/** Map a 0–1 similarity score directly to the meter fill width (70% → 70%). */
function meterWidth(score: number): string {
  return `${Math.max(0, Math.min(100, score * 100))}%`;
}

/** Color-grade the meter: stronger matches lean fully into the theme accent. */
function meterColor(score: number): string {
  const pct = score * 100;
  const k = Math.max(0, Math.min(1, (pct - 30) / 45));
  return `color-mix(in srgb, var(--interactive-accent) ${Math.round(40 + 60 * k)}%, var(--text-faint))`;
}

function RelevanceMeter({ score, className }: { score: number; className?: string }) {
  return (
    <div
      className={cn(
        "tw-h-[3px] tw-w-full tw-overflow-hidden tw-rounded-full tw-bg-modifier-hover",
        className
      )}
    >
      <div
        className={cn("copilot-relevance-meter-fill tw-h-full tw-rounded-full")}
        style={
          {
            "--relevance-meter-fill": meterWidth(score),
            "--relevance-meter-color": meterColor(score),
          } as React.CSSProperties
        }
      />
    </div>
  );
}

function LinkBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      title={label}
      className="tw-flex tw-items-center tw-justify-center tw-rounded-sm tw-bg-modifier-hover tw-p-1 tw-text-faint"
    >
      {icon}
    </span>
  );
}

function RelevantNoteHoverCard({
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
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const similarity = note.metadata.similarityScore;

  const loadContent = useCallback(async () => {
    if (fileContent) return; // Don't reload once cached
    const file = app.vault.getAbstractFileByPath(note.note.path);
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

      setFileContent(cleanContent);
    }
  }, [app, fileContent, note.note.path]);

  useEffect(() => {
    if (open) {
      void loadContent();
    }
  }, [open, loadContent]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
          {children}
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={0}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="tw-flex tw-w-fit tw-min-w-72 tw-max-w-96 tw-flex-col tw-gap-3 tw-overflow-hidden tw-p-3"
      >
        <div className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-sm tw-font-semibold tw-text-normal">{note.note.title}</span>
          <span className="tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-text-faint">
            <FileText className="tw-size-3.5 tw-shrink-0" />
            <span className="tw-truncate">{note.note.path}</span>
          </span>
        </div>

        {fileContent && (
          <p className="tw-m-0 tw-max-h-64 tw-overflow-y-auto tw-whitespace-pre-line tw-text-xs tw-leading-normal tw-text-muted">
            {fileContent}
          </p>
        )}

        {similarity != null && (
          <div className="tw-flex tw-items-center tw-gap-2">
            <span className="tw-shrink-0 tw-text-xs tw-text-faint">Similarity</span>
            <RelevanceMeter score={similarity} className="tw-h-1 tw-flex-1" />
            <span className="tw-shrink-0 tw-text-xs tw-font-medium tw-tabular-nums tw-text-normal">
              {(similarity * 100).toFixed(1)}%
            </span>
          </div>
        )}

        {(note.metadata.hasOutgoingLinks || note.metadata.hasBacklinks) && (
          <div className="tw-flex tw-items-center tw-gap-4 tw-text-xs tw-text-faint">
            {note.metadata.hasOutgoingLinks && (
              <span className="tw-flex tw-items-center tw-gap-1">
                <FileOutput className="tw-size-3.5" />
                Outgoing links
              </span>
            )}
            {note.metadata.hasBacklinks && (
              <span className="tw-flex tw-items-center tw-gap-1">
                <FileInput className="tw-size-3.5" />
                Backlinks
              </span>
            )}
          </div>
        )}

        <div className="tw-flex tw-gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onAddToChat}
            className="tw-flex-1 tw-gap-1.5"
          >
            <PlusCircle className="tw-size-4" />
            Add to Chat
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onNavigateToNote}
            className="tw-flex-1 tw-gap-1.5"
          >
            Open note
            <ArrowRight className="tw-size-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RelevantNoteRow({
  note,
  onAddToChat,
  onNavigateToNote,
}: {
  note: RelevantNoteEntry;
  onAddToChat: () => void;
  onNavigateToNote: () => void;
}) {
  const app = useApp();
  const handleDragStart = useNoteDrag();
  const similarity = note.metadata.similarityScore;

  return (
    <RelevantNoteHoverCard
      note={note}
      onAddToChat={onAddToChat}
      onNavigateToNote={onNavigateToNote}
    >
      <div className="tw-group tw-rounded-md tw-px-2.5 tw-py-1.5 tw-transition-colors hover:tw-bg-modifier-hover">
        <div className="tw-flex tw-min-h-6 tw-items-center tw-gap-2">
          <a
            draggable
            onDragStart={(e) => {
              const file = app.vault.getAbstractFileByPath(note.note.path);
              if (file instanceof TFile) {
                handleDragStart(e, file);
              }
            }}
            onClick={(e) => {
              e.preventDefault();
              onNavigateToNote();
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onNavigateToNote();
              }
            }}
            className="tw-min-w-0 tw-flex-1 tw-cursor-pointer tw-truncate tw-text-sm tw-font-medium tw-text-normal !tw-no-underline"
          >
            {note.note.title}
          </a>

          <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1.5 group-hover:tw-hidden">
            {note.metadata.hasOutgoingLinks && (
              <LinkBadge icon={<FileOutput className="tw-size-3" />} label="Outgoing link" />
            )}
            {note.metadata.hasBacklinks && (
              <LinkBadge icon={<FileInput className="tw-size-3" />} label="Backlink" />
            )}
            {similarity != null && (
              <span className="tw-text-xs tw-font-medium tw-tabular-nums tw-text-muted">
                {Math.round(similarity * 100)}%
              </span>
            )}
          </div>

          <div className="tw-hidden tw-shrink-0 tw-items-center tw-gap-0.5 group-hover:tw-flex">
            <Button
              variant="ghost2"
              size="icon"
              title="Add to Chat"
              className="tw-size-6 tw-p-0"
              onClick={(e) => {
                e.stopPropagation();
                onAddToChat();
              }}
            >
              <PlusCircle className="tw-size-4" />
            </Button>
            <Button
              variant="ghost2"
              size="icon"
              title="Open note"
              className="tw-size-6 tw-p-0"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateToNote();
              }}
            >
              <ArrowRight className="tw-size-4" />
            </Button>
          </div>
        </div>

        {similarity != null && <RelevanceMeter score={similarity} className="tw-mt-1.5" />}
      </div>
    </RelevantNoteHoverCard>
  );
}

function RelevantNotesToolbar({ activeFileName }: { activeFileName: string | undefined }) {
  return (
    <div className="tw-flex tw-flex-none tw-items-center tw-gap-2 tw-border-0 tw-border-b tw-border-solid tw-border-border tw-px-3 tw-py-2">
      <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1.5 tw-text-xs tw-text-faint">
        <span className="tw-shrink-0">Relevant to</span>
        {activeFileName ? (
          <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-text-muted">
            <FileText className="tw-size-3.5 tw-shrink-0" />
            <span className="tw-truncate tw-font-medium tw-text-normal">{activeFileName}</span>
          </span>
        ) : (
          <span className="tw-text-muted">—</span>
        )}
      </div>
    </div>
  );
}

interface RelevantNotesProps {
  className?: string;
  /** Insert text (a `[[wikilink]]`) into the target chat input. */
  onAddToChat: (text: string) => void;
}

export const RelevantNotes = memo(
  ({ className, onAddToChat }: RelevantNotesProps): React.ReactElement => {
    const app = useApp();
    const activeFile = useActiveFile();
    const settings = useSettingsValue();
    const relevantNotes = useRelevantNotes(settings.enableMiyo, settings.miyoServerUrl);

    // The active note itself is excluded from the index (by the QA
    // inclusion/exclusion settings or an internal exclusion), so no relevant
    // notes can ever be computed for it — surface that instead of a build
    // prompt or a bare "none found".
    const isActiveFileExcluded = useMemo(() => {
      if (!activeFile) return false;
      const { inclusions, exclusions } = getMatchingPatterns({
        inclusions: settings.qaInclusions,
        exclusions: settings.qaExclusions,
      });
      return !shouldIndexFile(app, activeFile, inclusions, exclusions);
    }, [app, activeFile, settings.qaInclusions, settings.qaExclusions]);
    const navigateToNote = (notePath: string) => {
      const file = app.vault.getAbstractFileByPath(notePath);
      if (file instanceof TFile) {
        const leaf = app.workspace.getLeaf(true);
        void leaf.openFile(file).catch((err) => logError("openFile failed", err));
      }
    };
    const addToChat = (prompt: string) => {
      onAddToChat(`[[${prompt}]]`);
    };

    // Miyo help is an empty state, not a banner above graph-only fallback rows.
    // A successful Miyo search can still return direct links and backlinks.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    const guidance: RelevantNotesGuidance =
      relevantNotes.length > 0 ? null : settings.enableMiyo ? "setup" : "download";

    return (
      <div className={cn("tw-flex tw-min-h-full tw-w-full tw-flex-1 tw-flex-col", className)}>
        {isActiveFileExcluded ? (
          <div
            data-relevant-notes-empty-state
            className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-px-6"
          >
            <div className="tw-flex tw-w-full tw-max-w-xs tw-flex-col tw-items-center tw-gap-6 tw-text-center">
              <div className="tw-flex tw-size-16 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-secondary">
                <EyeOff className="tw-size-7 tw-text-muted" />
              </div>
              <div className="tw-flex tw-flex-col tw-gap-1.5">
                <span className="tw-text-lg tw-font-semibold tw-text-normal">
                  This note is excluded
                </span>
                <span className="tw-text-sm tw-text-muted">
                  It falls outside your semantic index settings, so related notes can&apos;t be
                  shown here. Adjust inclusions or exclusions in Copilot settings to include it.
                </span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <RelevantNotesToolbar activeFileName={activeFile?.basename} />
            <div className="tw-relative tw-min-h-0 tw-flex-1">
              <div className="tw-absolute tw-inset-0 tw-overflow-y-auto tw-p-2">
                <RelevantNotesPane
                  guidance={guidance}
                  noteCount={relevantNotes.length}
                  noteRows={relevantNotes.map((note) => (
                    <RelevantNoteRow
                      key={note.note.path}
                      note={note}
                      onAddToChat={() => addToChat(note.note.title)}
                      onNavigateToNote={() => navigateToNote(note.note.path)}
                    />
                  ))}
                  miyoDownloadUrl={MIYO_HOMEPAGE_URL}
                  onOpenMiyoSettings={(event) =>
                    openCopilotSettings(app, event.currentTarget.win, "miyo")
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
);

RelevantNotes.displayName = "RelevantNotes";
