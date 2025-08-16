import { logInfo } from "@/logger";
import { App } from "obsidian";
import { NoteIdRank } from "../interfaces";

/**
 * Configuration for folder boost calculation
 */
export interface FolderBoostConfig {
  enabled: boolean;
  minDocsForBoost: number;
  maxBoostFactor: number;
  minRelevanceRatio: number; // Minimum ratio of relevant/total docs in folder to apply boost
}

/**
 * Default configuration for folder boost
 */
export const DEFAULT_FOLDER_BOOST_CONFIG: FolderBoostConfig = {
  enabled: true,
  minDocsForBoost: 2,
  maxBoostFactor: 1.15, // Max 15% boost, aligned with graph boost
  minRelevanceRatio: 0.4, // At least 40% of folder docs must be relevant to apply boost
};

/**
 * Result of folder boost calculation for a single document
 */
export interface FolderBoostResult {
  folderPath: string;
  documentCount: number;
  totalDocsInFolder: number;
  relevanceRatio: number;
  boostFactor: number;
}

/**
 * Calculates folder-based boost scores for search results.
 * Documents in folders with multiple search results get boosted,
 * but only when they represent a significant portion of the folder.
 *
 * The boost helps surface clusters of related documents that share
 * a common folder structure, while avoiding false positives from
 * large folders with only a few relevant documents.
 */
export class FolderBoostCalculator {
  private config: FolderBoostConfig = DEFAULT_FOLDER_BOOST_CONFIG;
  private app: App | null;

  constructor(app?: App) {
    this.app = app || null;
  }

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

      if (stats) {
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
                  totalDocsInFolder: stats.totalDocsInFolder,
                  relevanceRatio: stats.relevanceRatio,
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

    // Get total document counts per folder from vault
    const folderTotalCounts = this.getTotalDocsPerFolder();

    // Calculate boost factors
    const folderStats = new Map<string, FolderBoostResult>();
    for (const [folder, count] of folderCounts.entries()) {
      const totalInFolder = folderTotalCounts.get(folder) || count;
      const relevanceRatio = count / totalInFolder;

      // Apply boost only if:
      // 1. We have minimum number of relevant docs
      // 2. The relevance ratio meets the threshold
      if (count >= this.config.minDocsForBoost && relevanceRatio >= this.config.minRelevanceRatio) {
        // Scale boost by both count and relevance ratio
        // Base logarithmic boost: 1 + log2(count + 1)
        const baseBoost = 1 + Math.log2(count + 1);

        // Scale by relevance ratio (higher ratio = stronger boost)
        // Use sqrt to avoid being too aggressive
        const scaledBoost = 1 + (baseBoost - 1) * Math.sqrt(relevanceRatio);

        const boostFactor = Math.min(scaledBoost, this.config.maxBoostFactor);

        folderStats.set(folder, {
          folderPath: folder,
          documentCount: count,
          totalDocsInFolder: totalInFolder,
          relevanceRatio,
          boostFactor,
        });
      }
    }

    return folderStats;
  }

  /**
   * Get total document counts for each folder in the vault
   * @returns Map of folder paths to total document counts
   */
  private getTotalDocsPerFolder(): Map<string, number> {
    const folderCounts = new Map<string, number>();

    if (!this.app) {
      return folderCounts;
    }

    // Count all markdown files per folder
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const folder = this.extractFolder(file.path);
      folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
    }

    return folderCounts;
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
      (a, b) => b.relevanceRatio - a.relevanceRatio
    );

    if (boostedFolders.length > 0) {
      logInfo(`Folder boost: Boosting ${boostedFolders.length} folders with significant relevance`);
      boostedFolders.slice(0, 5).forEach((stats) => {
        const ratioPercent = (stats.relevanceRatio * 100).toFixed(1);
        logInfo(
          `  ${stats.folderPath || "(root)"}: ${stats.documentCount}/${stats.totalDocsInFolder} docs (${ratioPercent}% relevant, ${stats.boostFactor.toFixed(2)}x boost)`
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
