import { logError, logInfo, logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import {
  getMiyoCustomUrl,
  getMiyoFilePath,
  getMiyoFolderName,
  getVaultRelativeMiyoPath,
  shouldUseMiyo,
} from "@/miyo/miyoUtils";
import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import { DBOperations } from "@/search/dbOperations";
import type { SemanticIndexDocument } from "@/search/indexBackend/SemanticIndexBackend";
import VectorStoreManager from "@/search/vectorStoreManager";
import { getSettings } from "@/settings/model";
import { InternalTypedDocument, Orama, Result } from "@orama/orama";
import { App, TFile } from "obsidian";

const MAX_K = 20;

/**
 * Determine whether Miyo-backed relevant-note scoring should be used.
 *
 * @returns True when Miyo mode and self-host access validation are active.
 */
function shouldUseMiyoForRelevantNotes(): boolean {
  return shouldUseMiyo(getSettings());
}

/**
 * Gets the highest score hits for each note and removes the current file path
 * from the results.
 * @param hits - The hits to get the highest score for.
 * @param currentFilePath - The current file path.
 * @returns A map of the highest score hits for each note.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- InternalTypedDocument<any> is required as Orama controls this type
function getHighestScoreHits(hits: Result<InternalTypedDocument<any>>[], currentFilePath: string) {
  const hitMap = new Map<string, number>();
  for (const hit of hits) {
    const path = (hit.document as { path: string }).path;
    const matchingScore = hitMap.get(path);
    if (matchingScore) {
      if (hit.score > matchingScore) {
        hitMap.set(path, hit.score);
      }
    } else {
      hitMap.set(path, hit.score);
    }
  }
  hitMap.delete(currentFilePath);
  return hitMap;
}

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
 * Return true when a semantic document has a usable embedding vector.
 *
 * @param doc - Semantic document candidate.
 * @returns True when embedding data exists and is non-empty.
 */
function hasUsableEmbedding(doc: SemanticIndexDocument): boolean {
  return Array.isArray(doc.embedding) && doc.embedding.length > 0;
}

/**
 * Return true when the source note has non-empty chunk content.
 *
 * @param docs - Source note semantic chunks.
 * @returns True when at least one chunk has content.
 */
function hasSourceChunkContent(docs: SemanticIndexDocument[]): boolean {
  return docs.some((doc) => doc.content.trim().length > 0);
}

/**
 * Calculate similarity scores using the legacy Orama vector path.
 *
 * @param db - The Orama database.
 * @param filePath - The file path to calculate similarity scores for.
 * @param currentNoteEmbeddings - Embedding vectors of the source note.
 * @returns A map of note paths to their highest similarity scores.
 */
async function calculateSimilarityScoreFromOrama({
  db,
  filePath,
  currentNoteEmbeddings,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Orama<any> is the correct API type
  db: Orama<any>;
  filePath: string;
  currentNoteEmbeddings: number[][];
}): Promise<Map<string, number>> {
  const searchPromises = currentNoteEmbeddings.map((embedding) =>
    DBOperations.getDocsByEmbedding(db, embedding, {
      limit: MAX_K,
      similarity: 0,
    })
  );
  const searchResults = await Promise.all(searchPromises);
  const allHits = searchResults.flat();
  const aggregatedHits = getHighestScoreHits(allHits, filePath);
  return capToTopK(aggregatedHits);
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
    return new Map();
  }
}

/**
 * Calculate similarity scores by selecting the best available backend strategy.
 *
 * @param app - The Obsidian app instance.
 * @param filePath - Source note path.
 * @returns Map of note paths to max similarity score.
 */
async function calculateSimilarityScore(app: App, filePath: string): Promise<Map<string, number>> {
  if (shouldUseMiyoForRelevantNotes()) {
    return calculateSimilarityScoreFromMiyo(app, filePath);
  }

  const currentNoteDocs = await VectorStoreManager.getInstance().getDocumentsByPath(filePath);
  if (currentNoteDocs.length === 0) {
    return new Map();
  }

  const currentNoteEmbeddings = currentNoteDocs
    .filter((doc) => hasUsableEmbedding(doc))
    .map((doc) => doc.embedding);

  if (currentNoteEmbeddings.length > 0) {
    try {
      const db = await VectorStoreManager.getInstance().getDb();
      return calculateSimilarityScoreFromOrama({
        db,
        filePath,
        currentNoteEmbeddings,
      });
    } catch (error) {
      logWarn("RelevantNotes(Orama): failed to compute similarity scores", error);
      return new Map();
    }
  }

  if (!hasSourceChunkContent(currentNoteDocs)) {
    return new Map();
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
    similarityScore: number | undefined;
    hasOutgoingLinks: boolean;
    hasBacklinks: boolean;
  };
};

/**
 * Finds the relevant notes for the given file path.
 *
 * @param app - The Obsidian app instance.
 * @param filePath - The file path to find relevant notes for.
 * @returns The relevant notes hits for the given file path. Empty array if no
 *   relevant notes are found or the index does not exist.
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

  const similarityScoreMap = await calculateSimilarityScore(app, filePath);
  const noteLinks = getNoteLinks(app, file);

  // Rank purely by semantic similarity so the displayed percentages stay
  // monotonic down the list. Linked/backlinked notes still appear, but a link
  // never boosts ranking: link-only notes have no similarity score and sort to
  // the bottom (they render without a meter in the UI).
  const candidatePaths = new Set<string>([...similarityScoreMap.keys(), ...noteLinks.keys()]);
  candidatePaths.delete(filePath);
  const sortedPaths = Array.from(candidatePaths).sort((aPath, bPath) => {
    const aScore = similarityScoreMap.get(aPath);
    const bScore = similarityScoreMap.get(bPath);
    if (aScore == null && bScore == null) return 0;
    if (aScore == null) return 1;
    if (bScore == null) return -1;
    return bScore - aScore;
  });
  return sortedPaths
    .map((path) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        return null;
      }
      const similarityScore = similarityScoreMap.get(path);
      return {
        note: {
          path,
          title: file.basename,
        },
        metadata: {
          score: similarityScore ?? 0,
          similarityScore,
          hasOutgoingLinks: noteLinks.get(path)?.links ?? false,
          hasBacklinks: noteLinks.get(path)?.backlinks ?? false,
        },
      };
    })
    .filter((entry) => entry !== null);
}
