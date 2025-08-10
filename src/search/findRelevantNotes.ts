import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import { MemoryIndexManager } from "@/search/v3/MemoryIndexManager";
import { getSettings } from "@/settings/model";
import { TFile } from "obsidian";

const MIN_SIMILARITY_SCORE = 0.4;
const MAX_K = 20;
const ORIGINAL_WEIGHT = 0.7;
const LINKS_WEIGHT = 0.3;

/**
 * Collect all chunk embeddings for a given note path from the in-memory JSONL index.
 * Performance: O(chunks_for_note) over preloaded records (no file I/O).
 */
async function getNoteEmbeddingsFromMemoryIndex(notePath: string): Promise<number[][]> {
  try {
    const manager = MemoryIndexManager.getInstance(app);
    await manager.ensureLoaded();
    // @ts-ignore access underlying records to collect embeddings per note
    const records = (manager as any)["records"] as
      | Array<{ path: string; embedding: number[] }>
      | undefined;
    if (!records || records.length === 0) return [];
    return records.filter((r) => r.path === notePath).map((r) => r.embedding);
  } catch {
    return [];
  }
}

/**
 * Compute the arithmetic mean embedding for a list of vectors.
 * Returns empty array when input is empty.
 */
function getAverageEmbedding(noteEmbeddings: number[][]): number[] {
  if (noteEmbeddings.length === 0) {
    return [];
  }

  const embeddingLength = noteEmbeddings[0].length;
  const averageEmbedding = Array(embeddingLength).fill(0);
  for (const embedding of noteEmbeddings) {
    for (let i = 0; i < embeddingLength; i++) {
      averageEmbedding[i] += embedding[i];
    }
  }
  for (let i = 0; i < embeddingLength; i++) {
    averageEmbedding[i] /= noteEmbeddings.length;
  }
  return averageEmbedding;
}

/**
 * Gets the highest score hits for each note and removes the current file path
 * from the results.
 * @param hits - The hits to get the highest score for.
 * @param currentFilePath - The current file path.
 * @returns A map of the highest score hits for each note.
 */
/**
 * Keep highest score per path and exclude the current file from results.
 */
function getHighestScoreHits(
  hits: Array<{ path: string; score: number }>,
  currentFilePath: string
) {
  const hitMap = new Map<string, number>();
  for (const hit of hits) {
    const { path, score } = hit;
    const existing = hitMap.get(path);
    if (existing != null) {
      if (score > existing) hitMap.set(path, score);
    } else hitMap.set(path, score);
  }
  hitMap.delete(currentFilePath);
  return hitMap;
}

/**
 * Compute semantic similarity scores for notes relative to a given file path.
 * Fast-path: use averaged chunk embedding and query the in-memory vector store.
 * Fallback: use a lightweight text query via MemoryIndexManager.search().
 */
async function calculateSimilarityScore({
  filePath,
}: {
  filePath: string;
}): Promise<Map<string, number>> {
  const debug = getSettings().debug;

  const currentNoteEmbeddings = await getNoteEmbeddingsFromMemoryIndex(filePath);
  const averageEmbedding = getAverageEmbedding(currentNoteEmbeddings);
  if (averageEmbedding.length === 0) {
    if (debug) {
      console.log("No embeddings found for note:", filePath);
    }
    return new Map();
  }
  const manager = MemoryIndexManager.getInstance(app);
  await manager.ensureLoaded();
  // Try vector path first
  try {
    // @ts-ignore internal access within codebase
    const store = (manager as any)["vectorStore"] as {
      similaritySearchVectorWithScore: (vec: number[], k: number) => Promise<[any, number][]>;
    } | null;
    if (store) {
      const k = Math.max(MAX_K, 50);
      const results = await store.similaritySearchVectorWithScore(averageEmbedding, k);
      const hits = results.map(([doc, score]) => ({
        path: (doc.metadata as any)?.path as string,
        score: typeof score === "number" ? score : 0,
      }));
      const filteredHits = hits.filter(
        (h) => h.path && h.path !== filePath && h.score >= MIN_SIMILARITY_SCORE
      );
      return getHighestScoreHits(filteredHits, filePath);
    }
  } catch (e) {
    if (debug) console.warn("RelevantNotes: vector path failed, falling back to text", e);
  }

  // Fallback text path
  const basename = filePath.split("/").pop()?.replace(/\.md$/, "") || filePath;
  const results = await manager.search([basename], Math.max(MAX_K, 50));
  const filtered = results
    .filter((r) => r.id !== filePath && r.score >= MIN_SIMILARITY_SCORE)
    .map((r) => ({ path: r.id, score: r.score }));
  return getHighestScoreHits(filtered, filePath);
}

/**
 * Collect outgoing and incoming link signals for a note.
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
 * Blend semantic similarity with link-based evidence.
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
 * Find relevant notes for a file path by combining:
 *  - Semantic similarity (averaged chunk vector → vector store search)
 *  - Link-based evidence (outgoing/backlinks)
 * Returns a ranked list with metadata for UI.
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

  const similarityScoreMap = await calculateSimilarityScore({ filePath });
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
 * Map a similarity score into coarse buckets for UI badges.
 */
export function getSimilarityCategory(score: number): number {
  if (score > 0.7) return 3;
  if (score > 0.55) return 2;
  return 1;
}
