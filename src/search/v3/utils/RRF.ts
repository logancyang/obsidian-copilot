import { logInfo } from "@/logger";
import { NoteIdRank } from "../interfaces";

/**
 * Configuration for RRF (Reciprocal Rank Fusion)
 */
export interface RRFConfig {
  lexical?: NoteIdRank[]; // L1 results
  semantic?: NoteIdRank[]; // Semantic results
  weights?: {
    lexical?: number; // Weight for lexical results
    semantic?: number; // Weight for semantic results
  };
  k?: number; // RRF constant (default: 60)
}

/**
 * Perform weighted Reciprocal Rank Fusion to combine multiple rankings
 *
 * Weights are normalized to sum to 1.0 for consistent scoring.
 * If only lexical results provided, uses weight 1.0.
 * If both provided, normalizes weights to sum to 1.0.
 *
 * Scoring formula: score = Σ(weight / (k + rank + 1)) for each ranking
 * Final score = raw_score * k / 2 (capped at 1.0)
 *
 * @param config - RRF configuration with rankings and weights
 * @returns Fused ranking with scores in 0-1 range
 */
export function weightedRRF(config: RRFConfig): NoteIdRank[] {
  const { lexical = [], semantic = [], weights = {}, k = 60 } = config;

  // Determine weights based on what's provided
  let finalWeights: { lexical: number; semantic: number };

  if (semantic.length === 0) {
    // Only lexical results
    finalWeights = { lexical: 1.0, semantic: 0.0 };
  } else if (lexical.length === 0) {
    // Only semantic results
    finalWeights = { lexical: 0.0, semantic: 1.0 };
  } else {
    // Both provided - normalize weights to sum to 1.0
    const rawLexical = weights.lexical ?? 0.4; // Default 40% lexical
    const rawSemantic = weights.semantic ?? 0.6; // Default 60% semantic
    const sum = rawLexical + rawSemantic;

    if (sum > 0) {
      finalWeights = {
        lexical: rawLexical / sum,
        semantic: rawSemantic / sum,
      };
    } else {
      // Fallback if both weights are 0
      finalWeights = { lexical: 0.5, semantic: 0.5 };
    }
  }

  const scores = new Map<string, number>();

  [
    { items: lexical, weight: finalWeights.lexical, name: "lexical" },
    { items: semantic, weight: finalWeights.semantic, name: "semantic" },
  ]
    .filter(({ items }) => items.length > 0)
    .forEach(({ items, weight, name }) => {
      items.forEach((item, idx) => {
        const current = scores.get(item.id) || 0;
        scores.set(item.id, current + weight / (k + idx + 1));
      });
      logInfo(`RRF: Processed ${items.length} items from ${name} with weight ${weight.toFixed(2)}`);
    });

  logInfo(`RRF: Fused ${scores.size} unique results`);

  // Sort by score
  const sortedResults = Array.from(scores.entries()).sort(([, a], [, b]) => b - a);

  // Simple linear scaling: multiply by k/2 to get reasonable range
  // This maps typical RRF scores to a 0-1 range with good distribution
  if (sortedResults.length > 0) {
    const scaleFactor = k / 2;
    const base = sortedResults.map(([id, score]) => ({
      id,
      score: Math.min(score * scaleFactor, 1),
      engine: "rrf" as const,
    }));
    // Dead-simple differentiation for saturated tops: subtract tiny rank-based epsilon
    const epsilon = 0.0005; // 5e-4 drop per rank to avoid walls of identical scores
    return base.map((r, idx) => ({
      ...r,
      score: Math.max(0, Math.min(1, r.score - epsilon * idx)),
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
