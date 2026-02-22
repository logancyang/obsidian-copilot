import { logInfo, logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoSourceId } from "@/miyo/miyoUtils";
import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import { DBOperations } from "@/search/dbOperations";
import type { SemanticIndexDocument } from "@/search/indexBackend/SemanticIndexBackend";
import VectorStoreManager from "@/search/vectorStoreManager";
import { getSettings } from "@/settings/model";
import { InternalTypedDocument, Orama, Result } from "@orama/orama";
import { TFile } from "obsidian";

const MAX_K = 20;
const ORIGINAL_WEIGHT = 0.7;
const LINKS_WEIGHT = 0.3;
const SELF_HOST_GRACE_PERIOD_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * Determine whether Miyo-backed relevant-note scoring should be used.
 *
 * @returns True when Miyo mode and self-host access validation are active.
 */
function shouldUseMiyoForRelevantNotes(): boolean {
  const settings = getSettings();
  if (!settings.enableMiyo || !settings.enableSemanticSearchV3) {
    return false;
  }

  if (settings.selfHostModeValidatedAt == null) {
    return false;
  }

  if ((settings.selfHostValidationCount ?? 0) >= 3) {
    return true;
  }

  return Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS;
}

/**
 * Gets the highest score hits for each note and removes the current file path
 * from the results.
 * @param hits - The hits to get the highest score for.
 * @param currentFilePath - The current file path.
 * @returns A map of the highest score hits for each note.
 */
function getHighestScoreHits(hits: Result<InternalTypedDocument<any>>[], currentFilePath: string) {
  const hitMap = new Map<string, number>();
  for (const hit of hits) {
    const matchingScore = hitMap.get(hit.document.path);
    if (matchingScore) {
      if (hit.score > matchingScore) {
        hitMap.set(hit.document.path, hit.score);
      }
    } else {
      hitMap.set(hit.document.path, hit.score);
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
 * @param filePath - Source note path.
 * @returns Map of note paths to max similarity score.
 */
async function calculateSimilarityScoreFromMiyo(filePath: string): Promise<Map<string, number>> {
  try {
    const settings = getSettings();
    const miyoClient = new MiyoClient();
    const baseUrl = await miyoClient.resolveBaseUrl(settings.selfHostUrl);
    const sourceId = getMiyoSourceId(app);
    const response = await miyoClient.searchRelated(baseUrl, filePath, {
      sourceId,
      limit: MAX_K,
    });
    const similarityScoreMap = new Map<string, number>();
    const results = response.results || [];

    for (const result of results) {
      if (result.path === filePath) {
        continue;
      }
      if (typeof result.score !== "number" || Number.isNaN(result.score)) {
        continue;
      }
      const existing = similarityScoreMap.get(result.path);
      if (existing === undefined || result.score > existing) {
        similarityScoreMap.set(result.path, result.score);
      }
    }

    if (getSettings().debug) {
      logInfo(
        `RelevantNotes(Miyo): received ${results.length} chunks, collected ${similarityScoreMap.size} note scores`
      );
    }

    return capToTopK(similarityScoreMap);
  } catch (error) {
    logWarn("RelevantNotes(Miyo): failed to compute similarity scores", error);
    return new Map();
  }
}

/**
 * Calculate similarity scores by selecting the best available backend strategy.
 *
 * @param filePath - Source note path.
 * @returns Map of note paths to max similarity score.
 */
async function calculateSimilarityScore(filePath: string): Promise<Map<string, number>> {
  if (shouldUseMiyoForRelevantNotes()) {
    return calculateSimilarityScoreFromMiyo(filePath);
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

  return calculateSimilarityScoreFromMiyo(filePath);
}

/**
 * Build outgoing/backlink relationship flags for the source note.
 *
 * @param file - Source note file.
 * @returns Map keyed by note path with link metadata.
 */
function getNoteLinks(file: TFile) {
  const resultMap = new Map<string, { links: boolean; backlinks: boolean }>();
  const linkedNotes = getLinkedNotes(file);
  const linkedNotePaths = linkedNotes.map((note) => note.path);
  for (const notePath of linkedNotePaths) {
    resultMap.set(notePath, { links: true, backlinks: false });
  }

  const backlinkedNotes = getBacklinkedNotes(file);
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

/**
 * Merge semantic similarity scores with note link heuristics.
 *
 * @param similarityScoreMap - Semantic score map.
 * @param noteLinks - Outgoing/backlink flags map.
 * @returns Combined score map used for ranking.
 */
function mergeScoreMaps(
  similarityScoreMap: Map<string, number>,
  noteLinks: Map<string, { links: boolean; backlinks: boolean }>
) {
  const mergedMap = new Map<string, number>();
  const totalWeight = ORIGINAL_WEIGHT + LINKS_WEIGHT;
  for (const [key, value] of similarityScoreMap) {
    mergedMap.set(key, (value * ORIGINAL_WEIGHT) / totalWeight);
  }
  for (const [key, value] of noteLinks) {
    let score = 0;
    if (value.links && value.backlinks) {
      score = LINKS_WEIGHT;
    } else if (value.links) {
      // If the note only has outgoing or incoming links, give it a 80% links
      // weight.
      score = LINKS_WEIGHT * 0.8;
    } else if (value.backlinks) {
      score = LINKS_WEIGHT * 0.8;
    }
    mergedMap.set(key, (mergedMap.get(key) ?? 0) + score);
  }
  return mergedMap;
}

export type RelevantNoteEntry = {
  document: {
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
 * @param filePath - The file path to find relevant notes for.
 * @returns The relevant notes hits for the given file path. Empty array if no
 *   relevant notes are found or the index does not exist.
 */
export async function findRelevantNotes({
  filePath,
}: {
  filePath: string;
}): Promise<RelevantNoteEntry[]> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    return [];
  }

  const similarityScoreMap = await calculateSimilarityScore(filePath);
  const noteLinks = getNoteLinks(file);
  const mergedScoreMap = mergeScoreMaps(similarityScoreMap, noteLinks);
  const sortedHits = Array.from(mergedScoreMap.entries()).sort((a, b) => {
    const aPath = a[0];
    const bPath = b[0];
    const aCategory = getSimilarityCategory(similarityScoreMap.get(aPath) ?? 0);
    const bCategory = getSimilarityCategory(similarityScoreMap.get(bPath) ?? 0);

    if (aCategory !== bCategory) {
      return bCategory - aCategory;
    }

    return b[1] - a[1];
  });
  return sortedHits
    .map(([path, score]) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        return null;
      }
      return {
        document: {
          path,
          title: file.basename,
        },
        metadata: {
          score,
          similarityScore: similarityScoreMap.get(path),
          hasOutgoingLinks: noteLinks.get(path)?.links ?? false,
          hasBacklinks: noteLinks.get(path)?.backlinks ?? false,
        },
      };
    })
    .filter((entry) => entry !== null);
}

/**
 * Gets the similarity category for the given score.
 * @param score - The score to get the similarity category for.
 * @returns The similarity category. 1 is low, 2 is medium, 3 is high.
 */
export function getSimilarityCategory(score: number): number {
  if (score > 0.7) return 3;
  if (score > 0.55) return 2;
  return 1;
}
