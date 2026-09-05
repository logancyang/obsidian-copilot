import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useApp } from "@/context";
import { useNoteDrag } from "@/hooks/useNoteDrag";
import { cn } from "@/lib/utils";
import { type RelevantNoteEntry } from "@/search/findRelevantNotes";
import { ArrowRight, FileInput, FileOutput, FileText, PlusCircle } from "lucide-react";
import { TFile } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";

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

function RelevanceMeter({
  score,
  animated,
  className,
}: {
  score: number;
  /** False when the reader has asked for reduced motion. */
  animated: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "tw-h-[3px] tw-w-full tw-overflow-hidden tw-rounded-full tw-bg-modifier-hover",
        className
      )}
    >
      <div
        className={cn(
          "copilot-relevance-meter-fill tw-h-full tw-rounded-full",
          // A live re-rank rewrites the score, and growing or shrinking the bar
          // is what makes a note's rising relevance readable as it happens.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
          animated && "tw-transition-[width,background-color] tw-duration-500 tw-ease-out"
        )}
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
  animated,
  onAddToChat,
  onNavigateToNote,
  children,
}: {
  note: RelevantNoteEntry;
  animated: boolean;
  onAddToChat: () => void;
  onNavigateToNote: () => void;
  children: React.ReactNode;
}) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const similarity = note.metadata.score;

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

        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-shrink-0 tw-text-xs tw-text-faint">Similarity</span>
          <RelevanceMeter score={similarity} animated={animated} className="tw-h-1 tw-flex-1" />
          <span className="tw-shrink-0 tw-text-xs tw-font-medium tw-tabular-nums tw-text-normal">
            {(similarity * 100).toFixed(1)}%
          </span>
        </div>

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

export interface RelevantNoteRowProps {
  note: RelevantNoteEntry;
  /** True while the note is mounted only to play its removal. */
  exiting: boolean;
  /** True while the note should play its arrival. */
  entering: boolean;
  /** False when the reader has asked for reduced motion. */
  animated: boolean;
  /** Registers the rendered row so a rank change can be slid into place. */
  rowRef: (node: HTMLElement | null) => void;
  onAddToChat: () => void;
  onNavigateToNote: () => void;
}

/**
 * One relevant note: its title, how strongly it matches, and its row actions.
 *
 * The row owns how a re-rank reads to a note taker who is still writing, so it
 * renders the arrival, removal, and score change its caller hands it rather
 * than deciding when a ranking has moved.
 *
 * @param note - Note to render, with the score and link flags behind it.
 * @param exiting - True while the note is mounted only to play its removal.
 * @param entering - True while the note should play its arrival.
 * @param animated - False when the reader has asked for reduced motion.
 * @param rowRef - Registers the row element for the caller's move animation.
 * @param onAddToChat - Inserts the note into the chat input.
 * @param onNavigateToNote - Opens the note.
 */
export function RelevantNoteRow({
  note,
  exiting,
  entering,
  animated,
  rowRef,
  onAddToChat,
  onNavigateToNote,
}: RelevantNoteRowProps): React.ReactElement {
  const app = useApp();
  const handleDragStart = useNoteDrag();
  const similarity = note.metadata.score;

  return (
    <RelevantNoteHoverCard
      note={note}
      animated={animated}
      onAddToChat={onAddToChat}
      onNavigateToNote={onNavigateToNote}
    >
      <div
        ref={rowRef}
        className={cn(
          "tw-group tw-rounded-md tw-px-2.5 tw-py-1.5 tw-transition-colors hover:tw-bg-modifier-hover",
          // A note that arrives or drops out mid-sentence is easy to miss if it
          // simply appears or vanishes between two frames.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
          entering && "tw-duration-200 tw-animate-in tw-fade-in-0 tw-slide-in-from-top-1",
          exiting && "tw-pointer-events-none tw-opacity-0",
          exiting && animated && "tw-transition-opacity tw-duration-200"
        )}
      >
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
            <span className="tw-text-xs tw-font-medium tw-tabular-nums tw-text-muted">
              {Math.round(similarity * 100)}%
            </span>
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

        <RelevanceMeter score={similarity} animated={animated} className="tw-mt-1.5" />
      </div>
    </RelevantNoteHoverCard>
  );
}
