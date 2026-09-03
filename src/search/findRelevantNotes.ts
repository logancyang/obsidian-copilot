import { logError, logInfo } from "@/logger";
import { MiyoClient, MiyoRequestError } from "@/miyo/MiyoClient";
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
const MIYO_FOLDER_LOOKUP_TIMEOUT_MS = 8000;

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

  try {
    // Obsidian's requestUrl can stay pending after a connection is accepted.
    // Bound the primary request so graph rows and unavailable guidance return.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    const response = await withTimeout(
      () =>
        miyoClient.searchRelated(baseUrl, miyoFilePath, {
          folderName,
          limit: MAX_RESULTS,
        }),
      MIYO_RELATED_SEARCH_TIMEOUT_MS,
      "Relevant Notes Miyo related search"
    );
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
      // A registered folder proves setup is healthy, but Miyo cannot tell
      // whether this particular path is still indexing or excluded.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      await withTimeout(
        () => miyoClient.getFolder(baseUrl, folderName),
        MIYO_FOLDER_LOOKUP_TIMEOUT_MS,
        "Relevant Notes Miyo folder lookup"
      );
      return { scoreByPath: new Map(), status: "not-indexed" };
    } catch (folderError) {
      // Without a successful folder probe, Copilot cannot distinguish an
      // unindexed note from a broken Miyo setup, so recovery must stay generic.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      logError(
        `RelevantNotes(Miyo): source has no indexed chunks and folder lookup failed for folder_name=${folderName}: ${(folderError as Error).message}`
      );
      return { scoreByPath: new Map(), status: "unavailable" };
    }
  }
}

export type RelevantNotesSearchStatus =
  | "disabled"
  | "matches"
  | "no-matches"
  | "not-indexed"
  | "unavailable";

interface RelatedNotesSearchResult {
  scoreByPath: Map<string, number>;
  status: RelevantNotesSearchStatus;
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
    score: number | undefined;
    hasOutgoingLinks: boolean;
    hasBacklinks: boolean;
  };
}

export interface RelevantNotesResult {
  notes: readonly RelevantNoteEntry[];
  status: RelevantNotesSearchStatus;
}

const EMPTY_RELEVANT_NOTES: readonly RelevantNoteEntry[] = Object.freeze([]);

export interface FindRelevantNotesOptions {
  app: App;
  filePath: string;
}

/**
 * Finds relevant notes for a file using Miyo's semantic order followed by
 * link-derived candidates.
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
  // even though neither state can return graph-only fallback rows.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (!settings.enableMiyo) {
    return { notes: EMPTY_RELEVANT_NOTES, status: "disabled" };
  }
  if (!shouldUseMiyo(settings)) {
    return { notes: EMPTY_RELEVANT_NOTES, status: "unavailable" };
  }

  const { scoreByPath, status } = await searchRelatedNotesWithMiyo(app, filePath, settings);
  // A graph-only fallback makes Relevant Notes look partially functional when
  // its Miyo-backed index is unavailable. Build graph candidates only after
  // Miyo establishes a healthy ready or not-indexed state.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (status === "unavailable") {
    return { notes: EMPTY_RELEVANT_NOTES, status };
  }
  const noteLinks = getNoteLinks(app, file);

  // Miyo's ordered files come first. Link-only notes append without changing
  // semantic rank and render without a score.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const candidatePaths = new Set<string>([...scoreByPath.keys(), ...noteLinks.keys()]);
  candidatePaths.delete(filePath);
  const notes = Array.from(candidatePaths)
    .map((path) => {
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
          score: scoreByPath.get(path),
          hasOutgoingLinks: noteLinks.get(path)?.links ?? false,
          hasBacklinks: noteLinks.get(path)?.backlinks ?? false,
        },
      };
    })
    .filter((entry) => entry !== null);
  return { notes: notes.length === 0 ? EMPTY_RELEVANT_NOTES : notes, status };
}
