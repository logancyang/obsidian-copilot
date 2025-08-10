import { logInfo } from "@/logger";
import { NoteIdRank } from "../interfaces";

/**
 * Configuration for RRF (Reciprocal Rank Fusion)
 */
export interface RRFConfig {
  lexical?: NoteIdRank[]; // L1 results
  semantic?: NoteIdRank[]; // Semantic results
  grepPrior?: NoteIdRank[]; // Initial grep results as weak prior
  weights?: {
    lexical?: number; // Default: 1.0
    semantic?: number; // Default: 2.0
    grepPrior?: number; // Default: 0.3
  };
  k?: number; // RRF constant (default: 60)
}

/**
 * Perform weighted Reciprocal Rank Fusion to combine multiple rankings
 *
 * Scoring formula: score = Σ(weight / (k + rank + 1)) for each ranking
 * Final score = raw_score * k / 2 (capped at 1.0)
 *
 * Simple linear scaling for reasonable score distribution
 *
 * @param config - RRF configuration with rankings and weights
 * @returns Fused ranking with scores in 0-1 range
 */
export function weightedRRF(config: RRFConfig): NoteIdRank[] {
  const { lexical = [], semantic = [], grepPrior = [], weights = {}, k = 60 } = config;
  // Reduce semantic weight and compress final scores slightly to avoid many 1.0s
  const finalWeights = { lexical: 1.0, semantic: 1.5, grepPrior: 0.3, ...weights };

  const scores = new Map<string, number>();

  [
    { items: lexical, weight: finalWeights.lexical, name: "lexical" },
    { items: semantic, weight: finalWeights.semantic, name: "semantic" },
    { items: grepPrior, weight: finalWeights.grepPrior, name: "grepPrior" },
  ]
    .filter(({ items }) => items.length > 0)
    .forEach(({ items, weight, name }) => {
      items.forEach((item, idx) => {
        const current = scores.get(item.id) || 0;
        scores.set(item.id, current + weight / (k + idx + 1));
      });
      logInfo(`RRF: Processed ${items.length} items from ${name} with weight ${weight}`);
    });

  logInfo(`RRF: Fused ${scores.size} unique results`);

  // Sort by score
  const sortedResults = Array.from(scores.entries()).sort(([, a], [, b]) => b - a);

  // Simple linear scaling: multiply by k/2 to get reasonable range
  // This maps typical RRF scores to a 0-1 range with good distribution
  if (sortedResults.length > 0) {
    const scaleFactor = k / 2;
    const compressed = sortedResults.map(([id, score]) => ({
      id,
      score: Math.min(score * scaleFactor, 1),
      engine: "rrf" as const,
    }));
    // Apply a light global compression to pull back near-1.0 scores
    return compressed.map((r) => ({ ...r, score: Math.min(r.score * 0.9, 0.95) }));
  }

  return [];
}

/**
 * Simple RRF without weights (equal weight for all sources)
 * @param rankings - Array of ranking lists
 * @param k - RRF constant
 * @returns Fused ranking
 */
export function simpleRRF(rankings: NoteIdRank[][], k: number = 60): NoteIdRank[] {
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    ranking.forEach((item, idx) => {
      const current = scores.get(item.id) || 0;
      scores.set(item.id, current + 1 / (k + idx + 1));
    });
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({
      id,
      score,
      engine: "rrf",
    }));
}

/**
 * Apply tie-breakers to rankings (recency, term coverage, etc.)
 * @param rankings - Initial rankings
 * @param tieBreakers - Functions to compute tie-breaker scores
 * @returns Rankings with tie-breakers applied
 */
export function applyTieBreakers(
  rankings: NoteIdRank[],
  tieBreakers: Array<(id: string) => number>
): NoteIdRank[] {
  return rankings
    .map((item) => {
      let tieScore = 0;
      for (const breaker of tieBreakers) {
        tieScore += breaker(item.id);
      }

      return {
        ...item,
        score: item.score + tieScore * 0.001, // Small weight for tie-breakers
      };
    })
    .sort((a, b) => b.score - a.score);
}
