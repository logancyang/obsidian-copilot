import { logInfo } from "@/logger";
import { NoteIdRank } from "../interfaces";
import { extractNotePathFromChunkId } from "../utils/chunkIdUtils";

/**
 * Configuration for adaptive score-based cutoff
 */
export interface AdaptiveCutoffConfig {
  /** Minimum results to always return, regardless of score drop (default: 3) */
  floor: number;
  /** Maximum results to return — acts as a ceiling (default: 30) */
  ceiling: number;
  /** Drop below this fraction of the top score to trigger cutoff (default: 0.3) */
  relativeThreshold: number;
  /** Minimum absolute score to include (default: 0.01) */
  absoluteMinScore: number;
  /** Enable note-diverse selection: ensure unique notes before filling duplicates (default: true) */
  ensureDiversity: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_ADAPTIVE_CUTOFF_CONFIG: AdaptiveCutoffConfig = {
  floor: 3,
  ceiling: 30,
  relativeThreshold: 0.3,
  absoluteMinScore: 0.01,
  ensureDiversity: true,
};

/**
 * Result metadata from adaptive cutoff
 */
export interface AdaptiveCutoffResult {
  /** Selected results after cutoff */
  results: NoteIdRank[];
  /** Score at which cutoff was applied (null if no cutoff) */
  cutoffScore: number | null;
  /** Number of unique notes in output */
  uniqueNotes: number;
  /** Total results before cutoff */
  totalBefore: number;
}

/**
 * Adaptive score-based cutoff that finds the natural "relevance cliff" in a
 * score-sorted result list instead of using a fixed K.
 *
 * Designed to be applied on reranker output (e.g., Jina Reranker v3) where
 * scores are well-calibrated relevance probabilities, but also works on any
 * monotonically-scored result list.
 *
 * Algorithm:
 * 1. Always include at least `floor` results
 * 2. Never exceed `ceiling` results
 * 3. After the floor, stop adding results when score drops below
 *    max(topScore * relativeThreshold, absoluteMinScore)
 * 4. If ensureDiversity is enabled, guarantee each unique note gets
 *    representation before any note gets a second chunk
 */
export function adaptiveCutoff(
  results: NoteIdRank[],
  config: Partial<AdaptiveCutoffConfig> = {}
): AdaptiveCutoffResult {
  const cfg = { ...DEFAULT_ADAPTIVE_CUTOFF_CONFIG, ...config };

  if (results.length === 0) {
    return { results: [], cutoffScore: null, uniqueNotes: 0, totalBefore: 0 };
  }

  // Ensure results are score-sorted descending
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const topScore = sorted[0].score;
  const scoreThreshold = Math.max(topScore * cfg.relativeThreshold, cfg.absoluteMinScore);

  let selected: NoteIdRank[];

  if (cfg.ensureDiversity) {
    selected = diverseCutoff(sorted, scoreThreshold, cfg);
  } else {
    selected = simpleCutoff(sorted, scoreThreshold, cfg);
  }

  const uniqueNotes = new Set(selected.map((r) => extractNotePathFromChunkId(r.id))).size;
  const cutoffScore = selected.length < sorted.length ? scoreThreshold : null;

  logInfo(
    `AdaptiveCutoff: ${selected.length}/${sorted.length} results kept ` +
      `(${uniqueNotes} unique notes, threshold=${scoreThreshold.toFixed(3)})`
  );

  return {
    results: selected,
    cutoffScore,
    uniqueNotes,
    totalBefore: sorted.length,
  };
}

/**
 * Simple cutoff without diversity: take results above threshold, respecting floor/ceiling.
 */
function simpleCutoff(
  sorted: NoteIdRank[],
  scoreThreshold: number,
  cfg: AdaptiveCutoffConfig
): NoteIdRank[] {
  const selected: NoteIdRank[] = [];

  for (const result of sorted) {
    if (selected.length >= cfg.ceiling) break;

    if (selected.length >= cfg.floor && result.score < scoreThreshold) {
      break;
    }

    selected.push(result);
  }

  return selected;
}

/**
 * Diversity-aware cutoff: guarantees each unique note gets at least one chunk
 * before any note gets a second, then fills remaining slots by score above threshold.
 */
function diverseCutoff(
  sorted: NoteIdRank[],
  scoreThreshold: number,
  cfg: AdaptiveCutoffConfig
): NoteIdRank[] {
  // Phase 1: Pick best chunk per unique note (above threshold, or within floor)
  const selected: NoteIdRank[] = [];
  const seenNotes = new Set<string>();
  const remaining: NoteIdRank[] = [];

  for (const result of sorted) {
    const notePath = extractNotePathFromChunkId(result.id);

    if (!seenNotes.has(notePath)) {
      // Always include if within floor, or if score is above threshold
      if (selected.length < cfg.floor || result.score >= scoreThreshold) {
        seenNotes.add(notePath);
        selected.push(result);
        if (selected.length >= cfg.ceiling) break;
        continue;
      }
    }

    remaining.push(result);
  }

  // Phase 2: Fill remaining slots with next-best chunks above threshold
  if (selected.length < cfg.ceiling) {
    for (const result of remaining) {
      if (selected.length >= cfg.ceiling) break;
      if (result.score < scoreThreshold && selected.length >= cfg.floor) break;

      selected.push(result);
    }
  }

  // Re-sort by score descending
  selected.sort((a, b) => b.score - a.score);

  return selected;
}
