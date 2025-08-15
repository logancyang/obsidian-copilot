import { logInfo } from "@/logger";
import { NoteIdRank } from "../interfaces";

/**
 * Configuration for folder boost calculation
 */
export interface FolderBoostConfig {
  enabled: boolean;
  minDocsForBoost: number;
  maxBoostFactor: number;
}

/**
 * Default configuration for folder boost
 */
export const DEFAULT_FOLDER_BOOST_CONFIG: FolderBoostConfig = {
  enabled: true,
  minDocsForBoost: 2,
  maxBoostFactor: 1.5, // Reduced from 3.0 to 1.5 - max 50% boost instead of 3x
};

/**
 * Result of folder boost calculation for a single document
 */
export interface FolderBoostResult {
  folderPath: string;
  documentCount: number;
  boostFactor: number;
}

/**
 * Calculates folder-based boost scores for search results.
 * Documents in folders with multiple search results get boosted.
 *
 * The boost helps surface clusters of related documents that share
 * a common folder structure, improving result quality by promoting
 * topically coherent groups.
 */
export class FolderBoostCalculator {
  private config: FolderBoostConfig = DEFAULT_FOLDER_BOOST_CONFIG;

  /**
   * Update calculator configuration
   */
  setConfig(config: Partial<FolderBoostConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Apply folder-based boosting to search results
   * Notes in folders with multiple matches get logarithmic boost
   *
   * @param results - Search results to boost
   * @returns Boosted results with updated scores
   */
  applyBoosts(results: NoteIdRank[]): NoteIdRank[] {
    if (!this.config.enabled || results.length === 0) {
      return results;
    }

    // Calculate folder statistics
    const folderStats = this.calculateFolderStats(results);

    // Log boosted folders
    this.logBoostedFolders(folderStats);

    // Apply boosts to results
    return results.map((result) => {
      const folder = this.extractFolder(result.id);
      const stats = folderStats.get(folder);

      if (stats && stats.documentCount >= this.config.minDocsForBoost) {
        const boostedScore = result.score * stats.boostFactor; // Don't cap - let normalizer handle it
        return {
          ...result,
          score: boostedScore,
          explanation: result.explanation
            ? {
                ...result.explanation,
                folderBoost: {
                  folder: stats.folderPath,
                  documentCount: stats.documentCount,
                  boostFactor: stats.boostFactor,
                },
                finalScore: boostedScore,
              }
            : undefined,
        };
      }

      return result;
    });
  }

  /**
   * Calculate boost statistics for each folder
   *
   * @param results - Search results to analyze
   * @returns Map of folder paths to boost statistics
   */
  private calculateFolderStats(results: NoteIdRank[]): Map<string, FolderBoostResult> {
    const folderCounts = new Map<string, number>();

    // Count documents per folder
    for (const result of results) {
      const folder = this.extractFolder(result.id);
      folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
    }

    // Calculate boost factors
    const folderStats = new Map<string, FolderBoostResult>();
    for (const [folder, count] of folderCounts.entries()) {
      if (count >= this.config.minDocsForBoost) {
        // Logarithmic boost: 1 + log2(count + 1)
        // Examples: 2 docs → 1.58x, 3 docs → 2x, 5 docs → 2.58x
        const rawBoost = 1 + Math.log2(count + 1);
        const boostFactor = Math.min(rawBoost, this.config.maxBoostFactor);

        folderStats.set(folder, {
          folderPath: folder,
          documentCount: count,
          boostFactor,
        });
      }
    }

    return folderStats;
  }

  /**
   * Extract folder path from a file path
   *
   * @param filePath - Full file path
   * @returns Folder path or empty string for root files
   */
  private extractFolder(filePath: string): string {
    return filePath.substring(0, filePath.lastIndexOf("/")) || "";
  }

  /**
   * Log information about folders that will be boosted
   *
   * @param folderStats - Folder statistics map
   */
  private logBoostedFolders(folderStats: Map<string, FolderBoostResult>): void {
    const boostedFolders = Array.from(folderStats.values()).sort(
      (a, b) => b.documentCount - a.documentCount
    );

    if (boostedFolders.length > 0) {
      logInfo(`Folder boost: Boosting ${boostedFolders.length} folders with multiple matches`);
      boostedFolders.slice(0, 5).forEach((stats) => {
        logInfo(
          `  ${stats.folderPath || "(root)"}: ${stats.documentCount} docs (${stats.boostFactor.toFixed(2)}x boost)`
        );
      });
    }
  }

  /**
   * Get folder boost statistics without applying them
   * Useful for testing and debugging
   *
   * @param results - Search results to analyze
   * @returns Map of folder paths to boost results
   */
  getFolderBoosts(results: NoteIdRank[]): Map<string, FolderBoostResult> {
    if (!this.config.enabled) {
      return new Map();
    }
    return this.calculateFolderStats(results);
  }
}
