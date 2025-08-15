import { NoteIdRank } from "../interfaces";

/**
 * Configuration for score normalization
 */
export interface NormalizationConfig {
  method: "zscore-tanh" | "minmax" | "percentile";
  tanhScale?: number; // Scale factor for tanh (default 2.5)
  clipMin?: number; // Minimum score after normalization (default 0.02)
  clipMax?: number; // Maximum score after normalization (default 0.98)
}

/**
 * Normalizes search result scores to meaningful 0-1 range
 * Prevents auto-1.0 scores and provides statistical confidence
 */
export class ScoreNormalizer {
  private config: NormalizationConfig = {
    method: "zscore-tanh",
    tanhScale: 2.5,
    clipMin: 0.02,
    clipMax: 0.98,
  };

  constructor(config: Partial<NormalizationConfig> = {}) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Normalize scores using configured method
   *
   * @param results - Search results with scores
   * @returns Results with normalized scores
   */
  normalize(results: NoteIdRank[]): NoteIdRank[] {
    if (results.length === 0) {
      return results;
    }

    switch (this.config.method) {
      case "zscore-tanh":
        return this.normalizeZScoreTanh(results);
      case "minmax":
        return this.normalizeMinMax(results);
      case "percentile":
        return this.normalizePercentile(results);
      default:
        return results;
    }
  }

  /**
   * Z-score normalization with tanh squashing
   * Provides statistical confidence: scores reflect how many standard deviations
   * above/below the mean a result is
   *
   * @param results - Search results
   * @returns Normalized results
   */
  private normalizeZScoreTanh(results: NoteIdRank[]): NoteIdRank[] {
    const scores = results.map((r) => r.score);

    // Calculate mean and standard deviation
    const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const std = Math.sqrt(variance);

    // Handle edge case where all scores are identical
    if (std === 0) {
      return results.map((r) => ({
        ...r,
        score: 0.5, // All identical scores map to middle
        explanation: r.explanation
          ? {
              ...r.explanation,
              finalScore: 0.5,
            }
          : undefined,
      }));
    }

    // Apply z-score normalization with tanh squashing
    const scale = this.config.tanhScale || 2.5;
    const clipMin = this.config.clipMin || 0.02;
    const clipMax = this.config.clipMax || 0.98;

    return results.map((r) => {
      // Calculate z-score
      const zScore = (r.score - mean) / std;

      // Apply tanh to squash to [-1, 1], then shift to [0, 1]
      const normalized = 0.5 + 0.5 * Math.tanh(zScore / scale);

      // Clip to avoid exact 0 or 1
      const clipped = Math.max(clipMin, Math.min(clipMax, normalized));

      // Update explanation if present
      const explanation = r.explanation
        ? {
            ...r.explanation,
            // Update baseScore to be the pre-normalization score for accurate display
            baseScore: r.score,
            finalScore: clipped,
          }
        : undefined;

      return {
        ...r,
        score: clipped,
        explanation,
      };
    });
  }

  /**
   * Min-max normalization with clipping
   * Simple linear scaling to [0, 1] range
   *
   * @param results - Search results
   * @returns Normalized results
   */
  private normalizeMinMax(results: NoteIdRank[]): NoteIdRank[] {
    const scores = results.map((r) => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    // Handle edge case where all scores are identical
    if (max === min) {
      return results.map((r) => ({
        ...r,
        score: 0.5,
      }));
    }

    const clipMin = this.config.clipMin || 0.02;
    const clipMax = this.config.clipMax || 0.98;

    const normalizedResults = results.map((r) => {
      const normalized = (r.score - min) / (max - min);
      const clipped = clipMin + normalized * (clipMax - clipMin);

      return {
        ...r,
        score: clipped,
        explanation: r.explanation
          ? {
              ...r.explanation,
              // Update baseScore to be the pre-normalization score for accurate display
              baseScore: r.score,
              finalScore: clipped,
            }
          : undefined,
      };
    });

    return normalizedResults;
  }

  /**
   * Percentile-based normalization
   * Maps scores to their percentile rank
   *
   * @param results - Search results
   * @returns Normalized results
   */
  private normalizePercentile(results: NoteIdRank[]): NoteIdRank[] {
    const n = results.length;
    const clipMin = this.config.clipMin || 0.02;
    const clipMax = this.config.clipMax || 0.98;

    // Sort by score to get percentile ranks
    const sorted = [...results].sort((a, b) => a.score - b.score);
    const percentileMap = new Map<string, number>();

    sorted.forEach((r, idx) => {
      // Calculate percentile (0 to 1)
      const percentile = idx / (n - 1);
      const clipped = clipMin + percentile * (clipMax - clipMin);
      percentileMap.set(r.id, clipped);
    });

    return results.map((r) => {
      const percentileScore = percentileMap.get(r.id) || 0.5;

      return {
        ...r,
        score: percentileScore,
        explanation: r.explanation
          ? {
              ...r.explanation,
              // Update baseScore to be the pre-normalization score for accurate display
              baseScore: r.score,
              finalScore: percentileScore,
            }
          : undefined,
      };
    });
  }

  /**
   * Get statistics about the score distribution
   * Useful for debugging and understanding the normalization
   *
   * @param results - Search results
   * @returns Statistics object
   */
  getStatistics(results: NoteIdRank[]): {
    mean: number;
    std: number;
    min: number;
    max: number;
    median: number;
  } {
    if (results.length === 0) {
      return { mean: 0, std: 0, min: 0, max: 0, median: 0 };
    }

    const scores = results.map((r) => r.score);
    const sorted = [...scores].sort((a, b) => a - b);

    const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const std = Math.sqrt(variance);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];

    return { mean, std, min, max, median };
  }
}
