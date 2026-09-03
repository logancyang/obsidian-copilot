import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { RelevantNotesPane } from "@/components/chat-components/ui/RelevantNotesPane";
import { RelevantNotesToolbar } from "@/components/chat-components/ui/RelevantNotesToolbar";
import { useRelevantNoteRowTransitions } from "@/components/chat-components/ui/useRelevantNoteRowTransitions";
import { MIYO_HOMEPAGE_URL } from "@/constants";
import { useApp } from "@/context";
import { useActiveFile } from "@/hooks/useActiveFile";
import { useLiveRelevantNotesRefresh } from "@/hooks/useLiveRelevantNotesRefresh";
import { useNoteDrag } from "@/hooks/useNoteDrag";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import { logError, logWarn } from "@/logger";
import { getMiyoFolderName, isLocalMiyoUrl, MIYO_DEEPLINK_URL } from "@/miyo/miyoUtils";
import { useMiyoStatus } from "@/miyo/useMiyoStatus";
import {
  findRelevantNotes,
  isSameRelevantNotesResult,
  type RelevantNoteEntry,
} from "@/search/findRelevantNotes";
import { onMiyoIndexChanged } from "@/miyo/miyoIndex";
import { openCopilotSettings } from "@/settings/openSettings";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { sha256 } from "@/utils/hash";
import { ArrowRight, FileInput, FileOutput, FileText, PlusCircle } from "lucide-react";
import { Platform, TFile } from "obsidian";
import React, { memo, useCallback, useEffect, useState } from "react";

const EMPTY_RELEVANT_NOTES: readonly RelevantNoteEntry[] = Object.freeze([]);
const IDLE_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "idle" as const,
  details: undefined,
});
const DISABLED_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "disabled" as const,
  details: undefined,
});
const LOADING_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "loading" as const,
  details: undefined,
});
const UNAVAILABLE_RELEVANT_NOTES_RESULT = Object.freeze({
  notes: EMPTY_RELEVANT_NOTES,
  status: "unavailable" as const,
  details: undefined,
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

/**
 * Keep the settled request untouched when a live re-query reproduces it.
 *
 * Returning the same object leaves React's state unchanged, so an unchanged
 * ranking cannot restart the row animations while the user is still typing.
 */
function nextSettledRequest(
  settled: SettledRelevantNotesRequest | null,
  requestKey: string,
  result: SettledRelevantNotesRequest["result"]
): SettledRelevantNotesRequest {
  return settled?.requestKey === requestKey && isSameRelevantNotesResult(settled.result, result)
    ? settled
    : { requestKey, result };
}

function useRelevantNotes(
  enableMiyo: boolean,
  miyoServerUrl: string,
  miyoBackendAvailable: boolean,
  miyoCredentialIdentity: string
) {
  const app = useApp();
  const [settledRequest, setSettledRequest] = useState<SettledRelevantNotesRequest | null>(null);
  const [signalTick, setSignalTick] = useState(0);
  const [liveTick, setLiveTick] = useState(0);
  const activeFile = useActiveFile();
  // Non-Markdown leaves do not provide a note Miyo can relate, so they share
  // the neutral no-source state instead of showing setup guidance.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const activeFilePath = activeFile?.extension === "md" ? activeFile.path : undefined;
  const refresh = useCallback(() => setSignalTick((tick) => tick + 1), []);
  // A live re-query asks the same question again, so it must not enter the
  // request key: the settled rows stay on screen while it runs instead of being
  // replaced by the loading state on every keystroke pause.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
  const liveRefresh = useCallback(() => setLiveTick((tick) => tick + 1), []);
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

  useEffect(() => onMiyoIndexChanged(refresh), [refresh]);

  useEffect(() => {
    let cancelled = false;

    async function fetchNotes() {
      // Leaving a ready request must discard its settled result. Reopening the
      // same note or re-enabling Miyo then starts a fresh request.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      if (requestStatus !== "ready" || requestKey === null || !activeFilePath) {
        setSettledRequest(null);
        return;
      }

      // A request key can recur after visiting another note. Clear its earlier
      // result so the repeated request cannot render stale rows while loading.
      // A result already settled under this key belongs to a live re-query and
      // is kept, because dropping it would blank the pane while the user types.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
      setSettledRequest((settled) => (settled?.requestKey === requestKey ? settled : null));
      try {
        const result = await findRelevantNotes({ app, filePath: activeFilePath });
        // A settings or active-note change can supersede an in-flight Miyo
        // request. Its older result must not replace the newer pane state.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
        if (!cancelled)
          setSettledRequest((settled) => nextSettledRequest(settled, requestKey, result));
      } catch (error) {
        if (!cancelled) {
          logWarn("Failed to fetch relevant notes", error);
          setSettledRequest((settled) =>
            nextSettledRequest(settled, requestKey, UNAVAILABLE_RELEVANT_NOTES_RESULT)
          );
        }
      }
    }

    void fetchNotes();
    return () => {
      cancelled = true;
    };
  }, [app, activeFilePath, requestKey, requestStatus, liveTick]);

  const result: RelevantNotesViewResult =
    requestStatus === "disabled"
      ? DISABLED_RELEVANT_NOTES_RESULT
      : requestStatus === "idle"
        ? IDLE_RELEVANT_NOTES_RESULT
        : settledRequest?.requestKey === requestKey
          ? settledRequest.result
          : LOADING_RELEVANT_NOTES_RESULT;

  return { result, refresh, liveRefresh };
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

function RelevantNoteRow({
  note,
  exiting,
  animated,
  rowRef,
  onAddToChat,
  onNavigateToNote,
}: {
  note: RelevantNoteEntry;
  /** True while the note is mounted only to play its removal. */
  exiting: boolean;
  /** False when the reader has asked for reduced motion. */
  animated: boolean;
  rowRef: (node: HTMLElement | null) => void;
  onAddToChat: () => void;
  onNavigateToNote: () => void;
}) {
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
          animated && "tw-duration-200 tw-animate-in tw-fade-in-0 tw-slide-in-from-top-1",
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
    const { result, refresh, liveRefresh } = useRelevantNotes(
      settings.enableMiyo,
      settings.miyoServerUrl,
      miyoBackendAvailable,
      miyoCredentialIdentity
    );
    // The toolbar must name only a source the search contract accepts; showing
    // an attachment name would imply that Miyo searched it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    const activeFileName = activeFile?.extension === "md" ? activeFile.basename : undefined;
    const animated = !useReducedMotion();
    const { rows, registerRow } = useRelevantNoteRowTransitions(result.notes, animated);

    useLiveRelevantNotesRefresh({
      app,
      enabled: settings.enableMiyo && settings.relevantNotesLiveUpdate,
      filePath: activeFile?.extension === "md" ? activeFile.path : undefined,
      onRefresh: liveRefresh,
    });

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
    const miyoFolderUrl = `${MIYO_DEEPLINK_URL}open?tab=sources&folder=${encodeURIComponent(
      getMiyoFolderName(app)
    )}`;

    return (
      <div className={cn("tw-flex tw-min-h-full tw-w-full tw-flex-1 tw-flex-col", className)}>
        <RelevantNotesToolbar
          activeFileName={activeFileName}
          // Live update follows the Miyo index, so the control is meaningless
          // while the pane is showing Miyo setup guidance instead of results.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
          liveUpdate={
            settings.enableMiyo
              ? {
                  enabled: settings.relevantNotesLiveUpdate,
                  onChange: (enabled) => {
                    updateSetting("relevantNotesLiveUpdate", enabled);
                    // Writes made while live update was off left the pane
                    // behind, so switching it on catches it up instead of
                    // waiting for the next keystroke.
                    // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
                    if (enabled) liveRefresh();
                  },
                }
              : undefined
          }
        />
        <div className="tw-relative tw-min-h-0 tw-flex-1">
          <div className="tw-absolute tw-inset-0 tw-overflow-y-auto tw-p-2">
            <RelevantNotesPane
              status={result.status}
              details={result.details}
              noteRows={rows.map((row) => (
                <RelevantNoteRow
                  key={row.note.note.path}
                  note={row.note}
                  exiting={row.exiting}
                  animated={animated}
                  rowRef={registerRow(row.note.note.path)}
                  onAddToChat={() => addToChat(row.note.note.title)}
                  onNavigateToNote={() => navigateToNote(row.note.note.path)}
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
                      event.currentTarget.win.open(miyoFolderUrl, "_blank");
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
