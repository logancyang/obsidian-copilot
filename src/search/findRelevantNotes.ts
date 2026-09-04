import { logError, logInfo } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
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
import { App, TFile } from "obsidian";

const MAX_K = 20;

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
 * @returns Map of note paths to max similarity score.
 */
async function calculateSimilarityScoreFromMiyo(
  app: App,
  filePath: string
): Promise<Map<string, number>> {
  const settings = getSettings();
  const miyoClient = new MiyoClient();
  const folderName = getMiyoFolderName(app);
  const miyoFilePath = getMiyoFilePath(app, filePath);
  try {
    const baseUrl = await miyoClient.resolveBaseUrl(getMiyoCustomUrl(settings));
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

    return capToTopK(similarityScoreMap);
  } catch (error) {
    logError(
      `RelevantNotes(Miyo): searchRelated failed for file_path=${miyoFilePath} folder_name=${folderName}: ${
        (error as Error).message
      }`
    );
    throw error;
  }
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

/**
 * Finds relevant notes for a file while enforcing Copilot's live search scope
 * across semantic and link-derived candidates.
 *
 * @param app - The Obsidian app instance.
 * @param filePath - The file path to find relevant notes for.
 * @returns Relevant-note hits allowed by the current inclusion/exclusion rules.
 *   Empty when no allowed notes are found or Miyo cannot run in the current environment.
 * @throws When the Miyo related-note request cannot complete.
 */
export async function findRelevantNotes({
  app,
  filePath,
}: {
  app: App;
  filePath: string;
}): Promise<RelevantNoteEntry[]> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    return [];
  }

  // Relevant Notes has no non-Miyo scoring path. Avoid querying Miyo when the
  // user disabled it or the current platform cannot reach it, such as mobile
  // without a configured remote endpoint.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (!shouldUseMiyo(getSettings())) {
    return [];
  }

  const similarityScoreMap = await calculateSimilarityScoreFromMiyo(app, filePath);
  if (similarityScoreMap.size === 0) {
    return [];
  }

  const noteLinks = getNoteLinks(app, file);

  // Links describe Miyo results but cannot make an otherwise unindexed note
  // relevant, so every displayed row retains a semantic basis.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const isAllowed = createCopilotPatternFilter(app);
  const sortedMatches = Array.from(similarityScoreMap.entries())
    .filter(([path]) => isAllowed(path))
    .sort(([, aScore], [, bScore]) => bScore - aScore);
  return sortedMatches
    .map(([path, similarityScore]) => {
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
}
