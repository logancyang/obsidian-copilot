import { logError, logInfo } from "@/logger";
import {
  MiyoClient,
  MiyoRequestError,
  type MiyoFileStatusReason,
  type MiyoRelatedSearchResponse,
} from "@/miyo/MiyoClient";
import {
  getMiyoCustomUrl,
  getMiyoFilePath,
  getMiyoFolderName,
  getVaultRelativeMiyoPath,
  shouldUseMiyo,
} from "@/miyo/miyoUtils";
import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import { getSettings, type CopilotSettings } from "@/settings/model";
import { withTimeout } from "@/utils";
import { App, TFile } from "obsidian";

const MAX_RESULTS = 20;
const MIYO_RELATED_SEARCH_TIMEOUT_MS = 8000;
const MIYO_FILE_STATUS_TIMEOUT_MS = 8000;

/**
 * Fetch Miyo's ordered related-note results.
 *
 * @param app - The Obsidian app instance.
 * @param filePath - Source note path.
 * @param settings - Current Miyo connection and logging settings.
 * @returns Miyo scores in response order and the state established by the request.
 */
async function searchRelatedNotesWithMiyo(
  app: App,
  filePath: string,
  settings: CopilotSettings
): Promise<RelatedNotesSearchResult> {
  // Related search can trigger a follow-up folder request after settings have
  // changed. Both requests must keep the credential paired with this endpoint.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const miyoClient = new MiyoClient({ plusLicenseKey: settings.plusLicenseKey });
  const folderName = getMiyoFolderName(app);
  const miyoFilePath = getMiyoFilePath(app, filePath);
  let baseUrl: string;
  try {
    baseUrl = await withTimeout(
      () => miyoClient.resolveBaseUrl(getMiyoCustomUrl(settings)),
      MIYO_RELATED_SEARCH_TIMEOUT_MS,
      "Relevant Notes Miyo endpoint resolution"
    );
  } catch (error) {
    // An unresolved endpoint cannot produce a trustworthy result. Settle as
    // unavailable so the pane offers recovery instead of loading indefinitely.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    logError(`RelevantNotes(Miyo): could not resolve Miyo: ${(error as Error).message}`);
    return { scoreByPath: new Map(), status: "unavailable" };
  }

  const requestRelated = () =>
    withTimeout(
      () =>
        miyoClient.searchRelated(baseUrl, miyoFilePath, {
          folderName,
          limit: MAX_RESULTS,
        }),
      MIYO_RELATED_SEARCH_TIMEOUT_MS,
      "Relevant Notes Miyo related search"
    );

  const classifyRelatedResponse = (
    response: MiyoRelatedSearchResponse
  ): RelatedNotesSearchResult => {
    // A successful HTTP status without Miyo's result collection does not prove
    // a valid empty search. Keep recovery guidance visible for malformed peers.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    if (!Array.isArray(response.results)) {
      logError("RelevantNotes(Miyo): related search response is missing its results array");
      return { scoreByPath: new Map(), status: "unavailable" };
    }
    const scoreByPath = new Map<string, number>();
    const results = response.results;

    // Miyo owns relevance ranking and applies the result limit. Preserve its
    // order and keep the first result for each file instead of comparing or
    // sorting embedding scores again in Copilot.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    for (const result of results) {
      // Custom and older Miyo endpoints may return malformed scores. Only a
      // finite score can establish relevance or reserve a path's first result.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      if (typeof result.score !== "number" || !Number.isFinite(result.score)) {
        continue;
      }
      const relativePath = getVaultRelativeMiyoPath(app, result.path);
      if (relativePath !== filePath && !scoreByPath.has(relativePath)) {
        scoreByPath.set(relativePath, result.score);
      }
    }

    if (settings.debug) {
      const sampleResponsePath = results[0]?.path;
      const sampleStripped = sampleResponsePath
        ? getVaultRelativeMiyoPath(app, sampleResponsePath)
        : undefined;
      logInfo(
        `RelevantNotes(Miyo): file_path=${miyoFilePath} folder_name=${folderName} ` +
          `received ${results.length} results, collected ${scoreByPath.size} notes ` +
          `(sample response.path=${sampleResponsePath ?? "n/a"} → stripped=${sampleStripped ?? "n/a"})`
      );
    }

    return {
      scoreByPath,
      status: scoreByPath.size > 0 ? "matches" : "no-matches",
    };
  };

  try {
    // Obsidian's requestUrl can stay pending after a connection is accepted.
    // Bound the primary request so unavailable guidance can replace loading.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    return classifyRelatedResponse(await requestRelated());
  } catch (error) {
    // Miyo defines every 404 from related search as a source with no indexed
    // chunks. The detail text is not part of that contract, so gating on it can
    // misreport a healthy registered folder as unavailable.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    // https://github.com/logancyang/obsidian-copilot/pull/2992#discussion_r3919646861
    if (!(error instanceof MiyoRequestError) || error.status !== 404) {
      logError(
        `RelevantNotes(Miyo): searchRelated failed for file_path=${miyoFilePath} folder_name=${folderName}: ${
          (error as Error).message
        }`
      );
      return { scoreByPath: new Map(), status: "unavailable" };
    }

    try {
      // A search miss does not distinguish indexing, filter, parse, and absent-file
      // states. Ask Miyo for the source classification using its public path.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      const fileStatus = await withTimeout(
        () => miyoClient.fileStatus(baseUrl, miyoFilePath),
        MIYO_FILE_STATUS_TIMEOUT_MS,
        "Relevant Notes Miyo file status"
      );
      switch (fileStatus.status) {
        case "indexed": {
          if (fileStatus.total_chunks === 0) {
            return { scoreByPath: new Map(), status: "no-text" };
          }
          try {
            // Indexing can finish between the first 404 and this status response.
            // Retry once so newly available semantic matches are not hidden.
            // https://github.com/logancyang/obsidian-copilot/pull/3088#discussion_r3921456717
            return classifyRelatedResponse(await requestRelated());
          } catch (retryError) {
            logError(
              `RelevantNotes(Miyo): searchRelated retry failed for file_path=${miyoFilePath} folder_name=${folderName}: ${(retryError as Error).message}`
            );
            return { scoreByPath: new Map(), status: "unavailable" };
          }
        }
        case "pending":
        case "not_scanned":
        case "missing":
          return { scoreByPath: new Map(), status: "indexing" };
        case "error":
          return {
            scoreByPath: new Map(),
            status: "index-error",
            details: { errorMessage: fileStatus.error_message ?? undefined },
          };
        case "excluded":
          return {
            scoreByPath: new Map(),
            status: "excluded",
            details: {
              exclusionReason: fileStatus.reason,
              exclusionRule: fileStatus.rule,
            },
          };
        default:
          // Unknown classifications must not expose graph-only rows as if Miyo
          // had confirmed a healthy state.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
          logError(
            `RelevantNotes(Miyo): unknown file status for file_path=${filePath} folder_name=${folderName}: ${String(fileStatus.status)}`
          );
          return { scoreByPath: new Map(), status: "unavailable" };
      }
    } catch (statusError) {
      // Old Miyo builds use this exact structured response for unknown routes.
      // Other 501s are real failures and must not be misreported as compatibility.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      if (
        statusError instanceof MiyoRequestError &&
        statusError.status === 501 &&
        statusError.errorCode === "not_implemented"
      ) {
        return { scoreByPath: new Map(), status: "not-indexed" };
      }
      logError(
        `RelevantNotes(Miyo): source has no indexed chunks and file status failed for file_path=${filePath} folder_name=${folderName}: ${(statusError as Error).message}`
      );
      return { scoreByPath: new Map(), status: "unavailable" };
    }
  }
}

export type RelevantNotesSearchStatus =
  | "disabled"
  | "matches"
  | "no-matches"
  | "no-text"
  | "indexing"
  | "index-error"
  | "excluded"
  | "not-indexed"
  | "unavailable";

export interface RelevantNotesStatusDetails {
  errorMessage?: string;
  exclusionReason?: MiyoFileStatusReason;
  exclusionRule?: string;
}

interface RelatedNotesSearchResult {
  scoreByPath: Map<string, number>;
  status: RelevantNotesSearchStatus;
  details?: RelevantNotesStatusDetails;
}

/**
 * Build outgoing/backlink relationship flags for the source note.
 *
 * @param app - The Obsidian app instance.
 * @param file - Source note file.
 * @returns Map keyed by note path with link metadata.
 */
function getNoteLinks(app: App, file: TFile) {
  const resultMap = new Map<string, { links: boolean; backlinks: boolean }>();
  const linkedNotes = getLinkedNotes(app, file);
  const linkedNotePaths = linkedNotes.map((note) => note.path);
  for (const notePath of linkedNotePaths) {
    resultMap.set(notePath, { links: true, backlinks: false });
  }

  const backlinkedNotes = getBacklinkedNotes(app, file);
  const backlinkedNotePaths = backlinkedNotes.map((note) => note.path);
  for (const notePath of backlinkedNotePaths) {
    if (resultMap.has(notePath)) {
      resultMap.set(notePath, { links: true, backlinks: true });
    } else {
      resultMap.set(notePath, { links: false, backlinks: true });
    }
  }

  return resultMap;
}

export interface RelevantNoteEntry {
  note: {
    path: string;
    title: string;
  };
  metadata: {
    score: number;
    hasOutgoingLinks: boolean;
    hasBacklinks: boolean;
  };
}

export interface RelevantNotesResult {
  notes: readonly RelevantNoteEntry[];
  status: RelevantNotesSearchStatus;
  details?: RelevantNotesStatusDetails;
}

const EMPTY_RELEVANT_NOTES: readonly RelevantNoteEntry[] = Object.freeze([]);

/**
 * Report whether two settled results would render identically.
 *
 * Live re-queries repeat while a note is being written, and most of them
 * reproduce the previous ranking. Callers use this to leave the rendered rows
 * alone in that case rather than replaying their animations.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/362
 *
 * @param a - Previously settled result.
 * @param b - Newly settled result.
 */
export function isSameRelevantNotesResult(a: RelevantNotesResult, b: RelevantNotesResult): boolean {
  if (a === b) return true;
  if (a.status !== b.status) return false;
  if (a.details?.errorMessage !== b.details?.errorMessage) return false;
  if (a.details?.exclusionReason !== b.details?.exclusionReason) return false;
  if (a.details?.exclusionRule !== b.details?.exclusionRule) return false;
  if (a.notes.length !== b.notes.length) return false;
  return a.notes.every((note, index) => {
    const other = b.notes[index];
    return (
      note.note.path === other.note.path &&
      note.note.title === other.note.title &&
      note.metadata.score === other.metadata.score &&
      note.metadata.hasOutgoingLinks === other.metadata.hasOutgoingLinks &&
      note.metadata.hasBacklinks === other.metadata.hasBacklinks
    );
  });
}

export interface FindRelevantNotesOptions {
  app: App;
  filePath: string;
}

/**
 * Finds relevant notes for a file using Miyo's semantic order and annotates
 * those results with Obsidian link relationships.
 *
 * @param app - The Obsidian app instance.
 * @param filePath - The file path to find relevant notes for.
 * @returns Relevant-note hits and the settled Miyo search status.
 */
export async function findRelevantNotes({
  app,
  filePath,
}: FindRelevantNotesOptions): Promise<RelevantNotesResult> {
  const settings = getSettings();
  const file = app.vault.getAbstractFileByPath(filePath);
  // Vault churn can remove or replace the source after the UI captures its
  // path. Never query Miyo or derive rows without a Markdown source.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (!(file instanceof TFile) || file.extension !== "md") {
    return {
      notes: EMPTY_RELEVANT_NOTES,
      status: settings.enableMiyo ? "unavailable" : "disabled",
    };
  }

  // Disabled and runtime-unavailable Miyo require different recovery guidance,
  // even though neither state can return link-only fallback rows.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (!settings.enableMiyo) {
    return { notes: EMPTY_RELEVANT_NOTES, status: "disabled" };
  }
  if (!shouldUseMiyo(settings)) {
    return { notes: EMPTY_RELEVANT_NOTES, status: "unavailable" };
  }

  const { scoreByPath, status, details } = await searchRelatedNotesWithMiyo(
    app,
    filePath,
    settings
  );
  // Every result row must come from Miyo. Showing link-only rows for any empty
  // search state makes Relevant Notes look partially functional without the
  // index that defines relevance.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (status !== "matches") {
    return { notes: EMPTY_RELEVANT_NOTES, status, details };
  }
  const noteLinks = getNoteLinks(app, file);

  // Preserve Miyo's response order; links only annotate those candidates.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const notes = Array.from(scoreByPath.entries())
    .map(([path, score]) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        return null;
      }
      return {
        note: {
          path,
          title: file.basename,
        },
        metadata: {
          score,
          hasOutgoingLinks: noteLinks.get(path)?.links ?? false,
          hasBacklinks: noteLinks.get(path)?.backlinks ?? false,
        },
      };
    })
    .filter((entry) => entry !== null);
  return { notes: notes.length === 0 ? EMPTY_RELEVANT_NOTES : notes, status, details };
}
