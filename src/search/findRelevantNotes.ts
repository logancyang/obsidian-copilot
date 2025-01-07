import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import { DBOperations } from "@/search/dbOperations";
import { getSettings } from "@/settings/model";
import { InternalTypedDocument, Orama, Result } from "@orama/orama";
import { TFile } from "obsidian";

const MIN_SIMILARITY_SCORE = 0.4;
const MAX_K = 20;
const ORIGINAL_WEIGHT = 0.7;
const LINKS_WEIGHT = 0.3;

/**
 * Gets the embeddings for the given note path.
 * @param notePath - The note path to get embeddings for.
 * @param db - The Orama database.
 * @returns The embeddings for the given note path.
 */
async function getNoteEmbeddings(notePath: string, db: Orama<any>): Promise<number[][]> {
  const debug = getSettings().debug;
  const hits = await DBOperations.getDocsByPath(db, notePath);
  if (!hits) {
    if (debug) {
      console.log("No hits found for note:", notePath);
    }
    return [];
  }

  const embeddings: number[][] = [];
  for (const hit of hits) {
    if (!hit?.document?.embedding) {
      if (debug) {
        console.log("No embedding found for note:", notePath);
      }
      continue;
    }
    embeddings.push(hit.document.embedding);
  }
  return embeddings;
}

/**
 * Gets the average embedding for the given embeddings.
 * @param noteEmbeddings - The embeddings of the original note.
 * @returns The average embedding.
 */
function getAverageEmbedding(noteEmbeddings: number[][]): number[] {
  if (noteEmbeddings.length === 0) {
    return [];
  }

  const embeddingLength = noteEmbeddings[0].length;
  const averageEmbedding = Array(embeddingLength).fill(0);
  noteEmbeddings.forEach((embedding) => {
    embedding.forEach((value, index) => {
      averageEmbedding[index] += value / embeddingLength;
    });
  });
  return averageEmbedding;
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

async function calculateSimilarityScore({
  db,
  filePath,
}: {
  db: Orama<any>;
  filePath: string;
}): Promise<Map<string, number>> {
  const debug = getSettings().debug;

  const currentNoteEmbeddings = await getNoteEmbeddings(filePath, db);
  const averageEmbedding = getAverageEmbedding(currentNoteEmbeddings);
  if (averageEmbedding.length === 0) {
    if (debug) {
      console.log("No embeddings found for note:", filePath);
    }
    return new Map();
  }

  const hits = await DBOperations.getDocsByEmbedding(db, averageEmbedding, {
    limit: MAX_K,
    similarity: MIN_SIMILARITY_SCORE,
  });
  return getHighestScoreHits(hits, filePath);
}

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
 * @param db - The Orama database.
 * @param filePath - The file path to find relevant notes for.
 * @returns The relevant notes hits for the given file path. Empty array if no
 *   relevant notes are found or the index does not exist.
 */
export async function findRelevantNotes({
  db,
  filePath,
}: {
  db: Orama<any>;
  filePath: string;
}): Promise<RelevantNoteEntry[]> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    return [];
  }

  const similarityScoreMap = await calculateSimilarityScore({ db, filePath });
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
      if (!(file instanceof TFile)) {
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
