import { NoteIdRank, SearchExplanation } from "@/search/v3/interfaces";

export interface NormalizationConfig {
  method: "zscore-tanh" | "minmax" | "percentile";
  tanhScale?: number;
  clipMin?: number;
  clipMax?: number;
}

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

  private updateExplanation(
    explanation: SearchExplanation | undefined,
    originalScore: number,
    normalizedScore: number
  ): SearchExplanation | undefined {
    if (!explanation) return undefined;

    return {
      ...explanation,
      baseScore: originalScore,
      finalScore: normalizedScore,
    };
  }

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

  private normalizeZScoreTanh(results: NoteIdRank[]): NoteIdRank[] {
    const scores = results.map((r) => r.score);

    const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const std = Math.sqrt(variance);

    if (std === 0) {
      return results.map((r) => ({
        ...r,
        score: 0.5,
        explanation: this.updateExplanation(r.explanation, r.score, 0.5),
      }));
    }

    const scale = this.config.tanhScale || 2.5;
    const clipMin = this.config.clipMin || 0.02;
    const clipMax = this.config.clipMax || 0.98;

    return results.map((r) => {
      const zScore = (r.score - mean) / std;

      const normalized = 0.5 + 0.5 * Math.tanh(zScore / scale);

      const clipped = Math.max(clipMin, Math.min(clipMax, normalized));

      return {
        ...r,
        score: clipped,
        explanation: this.updateExplanation(r.explanation, r.score, clipped),
      };
    });
  }

  private normalizeMinMax(results: NoteIdRank[]): NoteIdRank[] {
    const scores = results.map((r) => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    if (max === min) {
      return results.map((r) => ({
        ...r,
        score: 0.5,
        explanation: this.updateExplanation(r.explanation, r.score, 0.5),
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
        explanation: this.updateExplanation(r.explanation, r.score, clipped),
      };
    });

    return normalizedResults;
  }

  private normalizePercentile(results: NoteIdRank[]): NoteIdRank[] {
    const n = results.length;
    const clipMin = this.config.clipMin || 0.02;
    const clipMax = this.config.clipMax || 0.98;

    const sorted = [...results].sort((a, b) => a.score - b.score);
    const percentileMap = new Map<string, number>();

    sorted.forEach((r, idx) => {
      const percentile = idx / (n - 1);
      const clipped = clipMin + percentile * (clipMax - clipMin);
      percentileMap.set(r.id, clipped);
    });

    return results.map((r) => {
      const percentileScore = percentileMap.get(r.id) || 0.5;

      return {
        ...r,
        score: percentileScore,
        explanation: this.updateExplanation(r.explanation, r.score, percentileScore),
      };
    });
  }
}
