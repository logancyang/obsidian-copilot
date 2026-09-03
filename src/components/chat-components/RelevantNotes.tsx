import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { RelevantNotesPane } from "@/components/chat-components/ui/RelevantNotesPane";
import { MIYO_HOMEPAGE_URL } from "@/constants";
import { useApp } from "@/context";
import { useActiveFile } from "@/hooks/useActiveFile";
import { useNoteDrag } from "@/hooks/useNoteDrag";
import { cn } from "@/lib/utils";
import { logError, logWarn } from "@/logger";
import { isLocalMiyoUrl, MIYO_DEEPLINK_URL } from "@/miyo/miyoUtils";
import { findRelevantNotes, type RelevantNoteEntry } from "@/search/findRelevantNotes";
import { onIndexChanged } from "@/search/indexSignal";
import { openCopilotSettings } from "@/settings/openSettings";
import { useSettingsValue } from "@/settings/model";
import { sha256 } from "@/utils/hash";
import { ArrowRight, FileInput, FileOutput, FileText, PlusCircle } from "lucide-react";
import { Platform, TFile } from "obsidian";
import React, { memo, useCallback, useEffect, useState } from "react";

const EMPTY_RELEVANT_NOTES: readonly RelevantNoteEntry[] = Object.freeze([]);
const IDLE_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "idle" as const,
});
const DISABLED_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "disabled" as const,
});
const LOADING_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "loading" as const,
});
const UNAVAILABLE_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "unavailable" as const,
});

type RelevantNotesViewResult =
  | typeof IDLE_RELEVANT_NOTES_RESULT
  | typeof DISABLED_RELEVANT_NOTES_RESULT
  | typeof LOADING_RELEVANT_NOTES_RESULT
  | typeof UNAVAILABLE_RELEVANT_NOTES_RESULT
  | Awaited<ReturnType<typeof findRelevantNotes>>;

interface SettledRelevantNotesRequest {
  requestKey: string;
  result: Awaited<ReturnType<typeof findRelevantNotes>> | typeof UNAVAILABLE_RELEVANT_NOTES_RESULT;
}

function useRelevantNotes(
  enableMiyo: boolean,
  miyoServerUrl: string,
  miyoBackendAvailable: boolean,
  miyoCredentialIdentity: string
) {
  const app = useApp();
  const [result, setResult] = useState<RelevantNotesViewResult>(
    enableMiyo ? LOADING_RELEVANT_NOTES_RESULT : DISABLED_RELEVANT_NOTES_RESULT
  );
  const [signalTick, setSignalTick] = useState(0);
  const activeFile = useActiveFile();
  // Non-Markdown leaves do not provide a note Miyo can relate, so they share
  // the neutral no-source state instead of showing setup guidance.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const activeFilePath = activeFile?.extension === "md" ? activeFile.path : undefined;
  const refresh = useCallback(() => setSignalTick((tick) => tick + 1), []);
  // Without an active note there is nothing to search, so setup state must not
  // replace the pane's neutral empty state.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const requestStatus = !activeFilePath ? "idle" : enableMiyo ? "ready" : "disabled";
  const requestKey =
    requestStatus === "ready"
      ? JSON.stringify([
          activeFilePath,
          miyoServerUrl,
          miyoBackendAvailable,
          miyoCredentialIdentity,
          signalTick,
        ])
      : null;

  useEffect(() => onIndexChanged(refresh), [refresh]);

  useEffect(() => {
    let cancelled = false;

    async function fetchNotes() {
      // Disabled Miyo always owns the pane state and must not start a search,
      // even when there is no active Markdown note.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      if (!enableMiyo) {
        setResult(DISABLED_RELEVANT_NOTES_RESULT);
        return;
      }

      // A request key can recur after visiting another note. Clear its earlier
      // result so the repeated request cannot render stale rows while loading.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      setSettledRequest(null);
      try {
        const notes = await findRelevantNotes({ app, filePath: activeFile.path });
        // A settings or active-note change can supersede an in-flight Miyo
        // request. Its older result must not replace the newer pane state.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
        if (!cancelled) setResult(notes);
      } catch (error) {
        if (!cancelled) {
          logWarn("Failed to fetch relevant notes", error);
          setResult(UNAVAILABLE_RELEVANT_NOTES_RESULT);
        }
      }
    }

    void fetchNotes();
    return () => {
      cancelled = true;
    };
  }, [app, activeFile?.path, requestKey]);

  return { result, refresh };
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
          <RelevanceMeter score={similarity} className="tw-h-1 tw-flex-1" />
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
  const similarity = note.metadata.score;

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

        <RelevanceMeter score={similarity} className="tw-mt-1.5" />
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
    const miyoBackendAvailable = useMiyoStatus().backend === "available";
    // The request identity must change with credentials without retaining the
    // credential itself in request state.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    const miyoCredentialIdentity = sha256(settings.plusLicenseKey);
    const { result, refresh } = useRelevantNotes(
      settings.enableMiyo,
      settings.miyoServerUrl,
      miyoBackendAvailable,
      miyoCredentialIdentity
    );
    const relevantNotes = result.notes;
    // The toolbar must name only a source the search contract accepts; showing
    // an attachment name would imply that Miyo searched it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    const activeFileName = activeFile?.extension === "md" ? activeFile.basename : undefined;

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

    // A local-app deeplink cannot configure the remote server used on mobile
    // or by an explicit remote endpoint, so those runtimes stay in Copilot.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    const canOpenMiyoApp = !Platform.isMobile && isLocalMiyoUrl(settings.miyoServerUrl);

    return (
      <div className={cn("tw-flex tw-min-h-full tw-w-full tw-flex-1 tw-flex-col", className)}>
        <RelevantNotesToolbar activeFileName={activeFileName} />
        <div className="tw-relative tw-min-h-0 tw-flex-1">
          <div className="tw-absolute tw-inset-0 tw-overflow-y-auto tw-p-2">
            <RelevantNotesPane
              status={result.status}
              noteRows={relevantNotes.map((note) => (
                <RelevantNoteRow
                  key={note.note.path}
                  note={note}
                  onAddToChat={() => addToChat(note.note.title)}
                  onNavigateToNote={() => navigateToNote(note.note.path)}
                />
              ))}
              actions={{
                miyoDownloadUrl: MIYO_HOMEPAGE_URL,
                onOpenMiyoSettings: (event) =>
                  openCopilotSettings(app, event.currentTarget.win, "miyo"),
                onRefresh: refresh,
                reviewIndexing: {
                  destination: canOpenMiyoApp ? "miyo" : "settings",
                  onSelect: (event) => {
                    if (canOpenMiyoApp) {
                      event.currentTarget.win.open(MIYO_DEEPLINK_URL, "_blank");
                    } else {
                      openCopilotSettings(app, event.currentTarget.win, "miyo");
                    }
                  },
                },
              }}
            />
          </div>
        </div>
      </div>
    );
  }
);

RelevantNotes.displayName = "RelevantNotes";
