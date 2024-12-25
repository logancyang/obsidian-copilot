import { DBOperations } from "@/search/dbOperations";
import { getSettings } from "@/settings/model";
import { extractNoteTitles, getNoteFileFromTitle } from "@/utils";
import { InternalTypedDocument, Orama, Result } from "@orama/orama";
import { TFile } from "obsidian";

const MIN_SIMILARITY_SCORE = 0.3;
const MAX_K = 20;
const ORIGINAL_WEIGHT = 0.7;
const LINKED_WEIGHT = 0.3;

/**
 * Checks if the index exists for the given file path.
 * @param db - The Orama database.
 * @param filePath - The file path to check.
 * @returns True if the index exists, false otherwise.
 */
async function checkIndexExists(db: Orama<any>, filePath: string) {
  const hits = await DBOperations.getDocsByPath(db, filePath);
  if (!hits) {
    return false;
  }
  // Filter the results to only include exact path matches
  const exactMatches = hits.filter((hit) => hit.document.path === filePath);
  return exactMatches.length > 0 && exactMatches.some((hit) => hit.document.embedding);
}

/**
 * Gets the embeddings for the given note titles.
 * @param noteTitles - The note titles to get embeddings for.
 * @param db - The Orama database.
 * @returns The embeddings for the given note titles.
 */
async function getEmbeddings(noteTitles: string[], db: Orama<any>): Promise<number[][]> {
  const debug = getSettings().debug;
  const embeddings: number[][] = [];
  for (const noteTitle of noteTitles) {
    const noteFile = await getNoteFileFromTitle(app.vault, noteTitle);
    if (!noteFile?.path) {
      continue;
    }
    const hits = await DBOperations.getDocsByPath(db, noteFile?.path ?? "");
    if (!hits) {
      if (debug) {
        console.log("No hits found for note:", noteTitle);
      }
      continue;
    }

    for (const hit of hits) {
      if (!hit.document.embedding) {
        if (debug) {
          console.log("No embedding found for note:", noteTitle);
        }
        continue;
      }
      embeddings.push(hit.document.embedding);
    }
  }
  return embeddings;
}

/**
 * Gets the weighted average embedding for the given embeddings.
 * @param originNoteEmbeddings - The embeddings of the original note.
 * @param linkedNoteEmbeddings - The embeddings of the linked notes.
 * @returns The weighted average embedding.
 */
async function getWeightedAverageEmbedding(
  originNoteEmbeddings: number[][],
  linkedNoteEmbeddings: number[][]
): Promise<number[]> {
  if (originNoteEmbeddings.length === 0 && linkedNoteEmbeddings.length === 0) {
    return [];
  }

  const totalOriginalNotes = originNoteEmbeddings.length;
  const totalLinkedNotes = linkedNoteEmbeddings.length;

  // Distribute weights evenly across embeddings
  const originalEmbeddingWeight = totalOriginalNotes > 0 ? ORIGINAL_WEIGHT / totalOriginalNotes : 0;
  const linkedEmbeddingWeight = totalLinkedNotes > 0 ? LINKED_WEIGHT / totalLinkedNotes : 0;

  // Initialize the weighted sum array with zeros
  const embeddingLength = originNoteEmbeddings[0]?.length || linkedNoteEmbeddings[0]?.length || 0;
  const weightedSum = Array(embeddingLength).fill(0);

  // Add weighted contributions from original note embeddings
  originNoteEmbeddings.forEach((embedding) => {
    embedding.forEach((value, index) => {
      weightedSum[index] += value * originalEmbeddingWeight;
    });
  });

  // Add weighted contributions from linked note embeddings
  linkedNoteEmbeddings.forEach((embedding) => {
    embedding.forEach((value, index) => {
      weightedSum[index] += value * linkedEmbeddingWeight;
    });
  });

  return weightedSum;
}

/**
 * Gets the highest score hits for each note and removes the current file path
 * from the results.
 * @param hits - The hits to get the highest score for.
 * @param currentFilePath - The current file path.
 * @returns An array of the highest score hits for each note.
 */
function getHighestScoreHits(hits: Result<InternalTypedDocument<any>>[], currentFilePath: string) {
  const hitMap = new Map<string, Result<InternalTypedDocument<any>>>();
  for (const hit of hits) {
    const matchingHits = hitMap.get(hit.document.path);
    if (matchingHits) {
      if (hit.score > matchingHits.score) {
        hitMap.set(hit.document.path, hit);
      }
    } else {
      hitMap.set(hit.document.path, hit);
    }
  }
  hitMap.delete(currentFilePath);
  return Array.from(hitMap.values()).sort((a, b) => b.score - a.score);
}

/**
 * Gets the note titles for the given file path. It includes the note titles
 * from the file content and the file name.
 * @param currentFilePath - The file path to get the note titles for.
 * @returns Object with the current note title and the linked note titles.
 */
async function getNoteTitles(currentFilePath: string) {
  const file = app.vault.getAbstractFileByPath(currentFilePath);
  if (!(file instanceof TFile)) {
    return;
  }
  const content = await app.vault.cachedRead(file);
  return {
    current: file.basename,
    linked: extractNoteTitles(content),
  };
}

/**
 * Finds the similar notes for the given file path.
 * @param db - The Orama database.
 * @param filePath - The file path to find similar notes for.
 * @returns The similar notes hits for the given file path. Empty array if no
 *   similar notes are found or the index does not exist.
 */
export async function findSimilarNotes({
  db,
  filePath,
}: {
  db: Orama<any>;
  filePath: string;
}): Promise<Result<InternalTypedDocument<any>>[]> {
  const debug = getSettings().debug;
  const indexExists = await checkIndexExists(db, filePath);
  if (!indexExists) {
    if (debug) {
      console.log("Index does not exist for file:", filePath);
    }
    return [];
  }

  const noteTitles = await getNoteTitles(filePath);
  if (!noteTitles) {
    return [];
  }

  const currentNoteEmbeddings = await getEmbeddings([noteTitles.current], db);
  let linkedNoteEmbeddings: number[][] = [];
  if (noteTitles.linked.length > 0) {
    linkedNoteEmbeddings = await getEmbeddings(noteTitles.linked, db);
  }
  const averageEmbedding = await getWeightedAverageEmbedding(
    currentNoteEmbeddings,
    linkedNoteEmbeddings
  );

  const hits = await DBOperations.getDocsByEmbedding(db, averageEmbedding, {
    limit: MAX_K,
    similarity: MIN_SIMILARITY_SCORE,
  });
  const highestScoreHits = getHighestScoreHits(hits, filePath);
  return highestScoreHits;
}
