import { NoteIdRank } from "../interfaces";
import { logInfo } from "@/logger";

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
 * @param config - RRF configuration with rankings and weights
 * @returns Fused ranking of note IDs with normalized scores
 */
export function weightedRRF(config: RRFConfig): NoteIdRank[] {
  const { lexical = [], semantic = [], grepPrior = [], weights = {}, k = 60 } = config;
  const finalWeights = { lexical: 1.0, semantic: 2.0, grepPrior: 0.3, ...weights };

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

  // Normalize scores to 0-1 range
  if (sortedResults.length > 0) {
    const maxScore = sortedResults[0][1];
    const minScore = sortedResults[sortedResults.length - 1][1];
    const range = maxScore - minScore || 1; // Avoid division by zero

    return sortedResults.map(([id, score]) => ({
      id,
      score: (score - minScore) / range, // Normalize to 0-1
      engine: "rrf",
    }));
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
