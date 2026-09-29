import { logInfo } from "@/logger";
import { NoteIdRank } from "@/search/v3/interfaces";
import { extractNotePathFromChunkId } from "@/search/v3/utils/chunkIdUtils";

export interface AdaptiveCutoffConfig {
  floor: number;
  ceiling: number;
  relativeThreshold: number;
  absoluteMinScore: number;
  ensureDiversity: boolean;
}

const DEFAULT_ADAPTIVE_CUTOFF_CONFIG: AdaptiveCutoffConfig = {
  floor: 3,
  ceiling: 30,
  relativeThreshold: 0.3,
  absoluteMinScore: 0.01,
  ensureDiversity: true,
};

export interface AdaptiveCutoffResult {
  results: NoteIdRank[];
  cutoffScore: number | null;
  uniqueNotes: number;
  totalBefore: number;
}

export function adaptiveCutoff(
  results: NoteIdRank[],
  config: Partial<AdaptiveCutoffConfig> = {}
): AdaptiveCutoffResult {
  const cfg = { ...DEFAULT_ADAPTIVE_CUTOFF_CONFIG, ...config };

  if (results.length === 0) {
    return { results: [], cutoffScore: null, uniqueNotes: 0, totalBefore: 0 };
  }

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

function diverseCutoff(
  sorted: NoteIdRank[],
  scoreThreshold: number,
  cfg: AdaptiveCutoffConfig
): NoteIdRank[] {
  const selected: NoteIdRank[] = [];
  const seenNotes = new Set<string>();
  const remaining: NoteIdRank[] = [];

  for (const result of sorted) {
    const notePath = extractNotePathFromChunkId(result.id);

    if (!seenNotes.has(notePath)) {
      if (selected.length < cfg.floor || result.score >= scoreThreshold) {
        seenNotes.add(notePath);
        selected.push(result);
        if (selected.length >= cfg.ceiling) break;
        continue;
      }
    }

    remaining.push(result);
  }

  if (selected.length < cfg.ceiling) {
    for (const result of remaining) {
      if (selected.length >= cfg.ceiling) break;
      if (result.score < scoreThreshold && selected.length >= cfg.floor) break;

      selected.push(result);
    }
  }

  selected.sort((a, b) => b.score - a.score);

  return selected;
}
