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
import { createCopilotPatternFilter } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";
import { withTimeout } from "@/utils";
import { App, TFile } from "obsidian";

const MAX_K = 20;
const MIYO_FOLDER_LOOKUP_TIMEOUT_MS = 8000;
const MIYO_UNINDEXED_SOURCE_DETAIL = "No indexed chunks found for file_path";

/**
 * Normalize a score map to the top K entries, ordered by score descending.
 *
 * @param scoreMap - Map of path to score.
 * @returns Capped map containing at most MAX_K entries.
 */
function capToTopK(scoreMap: Map<string, number>): Map<string, number> {
  if (scoreMap.size <= MAX_K) {
    return scoreMap;
  }

  const topK = Array.from(scoreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_K);

  return new Map(topK);
}

/**
 * Calculate similarity scores using Miyo's related-note endpoint.
 *
 * @param app - The Obsidian app instance.
 * @param filePath - Source note path.
 * @returns Semantic scores and the Miyo state established by the request.
 */
async function calculateSimilarityScoreFromMiyo(
  app: App,
  filePath: string
): Promise<SemanticSearchResult> {
  const settings = getSettings();
  const miyoClient = new MiyoClient();
  const folderName = getMiyoFolderName(app);
  const miyoFilePath = getMiyoFilePath(app, filePath);
  let baseUrl: string;
  try {
    baseUrl = await miyoClient.resolveBaseUrl(getMiyoCustomUrl(settings));
  } catch (error) {
    logError(`RelevantNotes(Miyo): could not resolve Miyo: ${(error as Error).message}`);
    return { similarityScoreMap: new Map(), semanticState: "unavailable" };
  }

  try {
    const response = await miyoClient.searchRelated(baseUrl, miyoFilePath, {
      folderName,
      limit: MAX_K,
    });
    const similarityScoreMap = new Map<string, number>();
    const results = response.results || [];

    for (const result of results) {
      const relativePath = getVaultRelativeMiyoPath(app, result.path);
      if (relativePath === filePath) {
        continue;
      }
      if (typeof result.score !== "number" || Number.isNaN(result.score)) {
        continue;
      }
      const existing = similarityScoreMap.get(relativePath);
      if (existing === undefined || result.score > existing) {
        similarityScoreMap.set(relativePath, result.score);
      }
    }

    if (settings.debug) {
      const sampleResponsePath = results[0]?.path;
      const sampleStripped = sampleResponsePath
        ? getVaultRelativeMiyoPath(app, sampleResponsePath)
        : undefined;
      logInfo(
        `RelevantNotes(Miyo): file_path=${miyoFilePath} folder_name=${folderName} ` +
          `received ${results.length} chunks, collected ${similarityScoreMap.size} note scores ` +
          `(sample response.path=${sampleResponsePath ?? "n/a"} → stripped=${sampleStripped ?? "n/a"})`
      );
    }

    return { similarityScoreMap: capToTopK(similarityScoreMap), semanticState: "ready" };
  } catch (error) {
    // Miyo uses this one response for a source that has no indexed chunks,
    // including a new note and a note excluded by Miyo. Only that response
    // merits a bounded registration probe; an outage must remain unavailable.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
    if (
      !(error instanceof MiyoRequestError) ||
      error.status !== 404 ||
      error.detail !== MIYO_UNINDEXED_SOURCE_DETAIL
    ) {
      logError(
        `RelevantNotes(Miyo): searchRelated failed for file_path=${miyoFilePath} folder_name=${folderName}: ${
          (error as Error).message
        }`
      );
      return { similarityScoreMap: new Map(), semanticState: "unavailable" };
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
      return { similarityScoreMap: new Map(), semanticState: "not-indexed" };
    } catch (folderError) {
      logError(
        `RelevantNotes(Miyo): source has no indexed chunks and folder lookup failed for folder_name=${folderName}: ${(folderError as Error).message}`
      );
      return { similarityScoreMap: new Map(), semanticState: "unavailable" };
    }
  }
}

export type RelevantNotesSemanticState =
  | "loading"
  | "disabled"
  | "ready"
  | "not-indexed"
  | "unavailable";

interface SemanticSearchResult {
  similarityScoreMap: Map<string, number>;
  semanticState: RelevantNotesSemanticState;
}

/**
 * Calculate Relevant Notes similarity scores through Miyo.
 *
 * @param app - The Obsidian app instance.
 * @param filePath - Source note path.
 * @returns Semantic scores and the Miyo state established by the request.
 */
async function calculateSimilarityScore(app: App, filePath: string): Promise<SemanticSearchResult> {
  // The legacy local index must not assign scores or trigger a hidden fallback.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const settings = getSettings();
  if (!settings.enableMiyo) {
    return { similarityScoreMap: new Map(), semanticState: "disabled" };
  }
  // An enabled Miyo that cannot run in this environment still needs the setup
  // handoff, including mobile without a configured remote endpoint.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (!shouldUseMiyo(settings)) {
    return { similarityScoreMap: new Map(), semanticState: "unavailable" };
  }
  return calculateSimilarityScoreFromMiyo(app, filePath);
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

export type RelevantNoteEntry = {
  note: {
    path: string;
    title: string;
  };
  metadata: {
    score: number;
    similarityScore: number;
    hasOutgoingLinks: boolean;
    hasBacklinks: boolean;
  };
};

export interface RelevantNotesResult {
  notes: RelevantNoteEntry[];
  semanticState: RelevantNotesSemanticState;
}

/**
 * Finds relevant notes for a file while enforcing Copilot's live search scope
 * across semantic and link-derived candidates.
 *
 * @param app - The Obsidian app instance.
 * @param filePath - The file path to find relevant notes for.
 * @returns Relevant-note hits allowed by the current inclusion/exclusion rules.
 *   Empty when no allowed notes are found.
 */
export async function findRelevantNotes({
  app,
  filePath,
}: {
  app: App;
  filePath: string;
}): Promise<RelevantNotesResult> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    return {
      notes: [],
      semanticState: getSettings().enableMiyo ? "unavailable" : "disabled",
    };
  }

  const { similarityScoreMap, semanticState } = await calculateSimilarityScore(app, filePath);
  // A graph-only fallback makes Relevant Notes look partially functional when
  // its Miyo-backed index is unavailable. Build graph candidates only after
  // Miyo establishes a healthy ready or not-indexed state.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (semanticState === "disabled" || semanticState === "unavailable") {
    return { notes: [], semanticState };
  }
  const noteLinks = getNoteLinks(app, file);

  // Rank purely by semantic similarity so the displayed percentages stay
  // monotonic down the list. Linked/backlinked notes still appear, but a link
  // never boosts ranking: link-only notes have no similarity score and sort to
  // the bottom (they render without a meter in the UI).
  const candidatePaths = new Set<string>([...similarityScoreMap.keys(), ...noteLinks.keys()]);
  candidatePaths.delete(filePath);
  const sortedPaths = Array.from(candidatePaths)
    .filter(createCopilotPatternFilter(app))
    .sort((aPath, bPath) => {
      const aScore = similarityScoreMap.get(aPath);
      const bScore = similarityScoreMap.get(bPath);
      if (aScore == null && bScore == null) return 0;
      if (aScore == null) return 1;
      if (bScore == null) return -1;
      return bScore - aScore;
    });
  const notes = sortedPaths
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
          score: similarityScore,
          similarityScore,
          hasOutgoingLinks: noteLinks.get(path)?.links ?? false,
          hasBacklinks: noteLinks.get(path)?.backlinks ?? false,
        },
      };
    })
    .filter((entry) => entry !== null);
  return { notes, semanticState };
}
