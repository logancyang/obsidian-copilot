import { RelevantNoteRow } from "@/components/chat-components/ui/RelevantNoteRow";
import { RelevantNotesPane } from "@/components/chat-components/ui/RelevantNotesPane";
import { RelevantNotesToolbar } from "@/components/chat-components/ui/RelevantNotesToolbar";
import { useRelevantNoteRowTransitions } from "@/components/chat-components/ui/useRelevantNoteRowTransitions";
import { MIYO_HOMEPAGE_URL } from "@/constants";
import { useApp } from "@/context";
import { useActiveFile } from "@/hooks/useActiveFile";
import { useLiveRelevantNotesRefresh } from "@/hooks/useLiveRelevantNotesRefresh";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import { logError, logWarn } from "@/logger";
import {
  getMiyoFolderName,
  isLocalMiyoUrl,
  MIYO_DEEPLINK_URL,
  shouldUseMiyo,
} from "@/miyo/miyoUtils";
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
import { Platform, TFile } from "obsidian";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";

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

/**
 * The re-query the pane is currently running or about to run.
 *
 * `restart` enters the request key, so bumping it drops the settled rows and
 * shows the loading state. A live re-query asks the same question again while
 * the reader watches, so it keeps `restart` and only replaces the object: the
 * rows stay on screen instead of blanking on every keystroke pause.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/362
 */
interface RelevantNotesRequery {
  restart: number;
  live: boolean;
}

const INITIAL_REQUERY: RelevantNotesRequery = Object.freeze({ restart: 0, live: false });

interface UseRelevantNotesOptions {
  enableMiyo: boolean;
  miyoServerUrl: string;
  miyoBackendAvailable: boolean;
  miyoCredentialIdentity: string;
  /** Whether the reader has live update switched on for the pane. */
  liveUpdateEnabled: boolean;
}

function useRelevantNotes({
  enableMiyo,
  miyoServerUrl,
  miyoBackendAvailable,
  miyoCredentialIdentity,
  liveUpdateEnabled,
}: UseRelevantNotesOptions) {
  const app = useApp();
  const [settledRequest, setSettledRequest] = useState<SettledRelevantNotesRequest | null>(null);
  const [requery, setRequery] = useState<RelevantNotesRequery>(INITIAL_REQUERY);
  const activeFile = useActiveFile();
  // Switching live update off must freeze a re-query that is already open, and
  // the effect below closes over the value it started with.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
  const liveUpdateEnabledRef = useRef(liveUpdateEnabled);
  liveUpdateEnabledRef.current = liveUpdateEnabled;
  const searchOpenRef = useRef(false);
  // Non-Markdown leaves do not provide a note Miyo can relate, so they share
  // the neutral no-source state instead of showing setup guidance.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const activeFilePath = activeFile?.extension === "md" ? activeFile.path : undefined;
  const refresh = useCallback(
    () => setRequery((current) => ({ restart: current.restart + 1, live: false })),
    []
  );
  const liveRefresh = useCallback(() => {
    // Miyo can take longer to answer than the live interval when it is remote
    // or busy. Starting a second search for the same question would leave both
    // in flight and throw one answer away, so the tick is skipped instead.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
    if (searchOpenRef.current) return;
    setRequery((current) => ({ ...current, live: true }));
  }, []);
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
          requery.restart,
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
      // Switching live update off freezes the ranking the reader is looking at,
      // so a live re-query that was still open when they switched it off must
      // not re-rank it on arrival.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
      const frozen = (settled: SettledRelevantNotesRequest | null) =>
        requery.live && !liveUpdateEnabledRef.current && settled?.requestKey === requestKey;
      searchOpenRef.current = true;
      try {
        const result = await findRelevantNotes({ app, filePath: activeFilePath });
        // A settings or active-note change can supersede an in-flight Miyo
        // request. Its older result must not replace the newer pane state.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
        if (!cancelled)
          setSettledRequest((settled) =>
            frozen(settled) ? settled : nextSettledRequest(settled, requestKey, result)
          );
      } catch (error) {
        if (!cancelled) {
          logWarn("Failed to fetch relevant notes", error);
          setSettledRequest((settled) =>
            frozen(settled)
              ? settled
              : nextSettledRequest(settled, requestKey, UNAVAILABLE_RELEVANT_NOTES_RESULT)
          );
        }
      } finally {
        searchOpenRef.current = false;
      }
    }

    void fetchNotes();
    return () => {
      cancelled = true;
    };
  }, [app, activeFilePath, requestKey, requestStatus, requery]);

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
    // Mobile without a remote server cannot reach Miyo at all, so following its
    // index there would only poll a backend every search is refused by.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
    const canFollowMiyoIndex = shouldUseMiyo(settings);
    const liveUpdateEnabled = canFollowMiyoIndex && settings.relevantNotesLiveUpdate;
    const { result, refresh, liveRefresh } = useRelevantNotes({
      enableMiyo: settings.enableMiyo,
      miyoServerUrl: settings.miyoServerUrl,
      miyoBackendAvailable,
      miyoCredentialIdentity,
      liveUpdateEnabled,
    });
    // The toolbar must name only a source the search contract accepts; showing
    // an attachment name would imply that Miyo searched it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    const activeFileName = activeFile?.extension === "md" ? activeFile.basename : undefined;
    const activeFilePath = activeFile?.extension === "md" ? activeFile.path : undefined;
    const animated = !useReducedMotion();
    const { rows, registerRow } = useRelevantNoteRowTransitions(
      result.notes,
      activeFilePath,
      animated
    );

    useLiveRelevantNotesRefresh({
      app,
      enabled: liveUpdateEnabled,
      filePath: activeFilePath,
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
            canFollowMiyoIndex
              ? {
                  enabled: settings.relevantNotesLiveUpdate,
                  onChange: (enabled) => updateSetting("relevantNotesLiveUpdate", enabled),
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
                  entering={row.entering}
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
