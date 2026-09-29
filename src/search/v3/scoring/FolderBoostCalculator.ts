import { logInfo } from "@/logger";
import { App } from "obsidian";
import { NoteIdRank } from "@/search/v3/interfaces";
import { extractNotePathFromChunkId } from "@/search/v3/utils/chunkIdUtils";

export interface FolderBoostConfig {
  enabled: boolean;
  minDocsForBoost: number;
  maxBoostFactor: number;
  minRelevanceRatio: number;
}

const DEFAULT_FOLDER_BOOST_CONFIG: FolderBoostConfig = {
  enabled: true,
  minDocsForBoost: 2,
  maxBoostFactor: 1.15,
  minRelevanceRatio: 0.4,
};

export interface FolderBoostResult {
  folderPath: string;
  documentCount: number;
  totalDocsInFolder: number;
  relevanceRatio: number;
  boostFactor: number;
}

export class FolderBoostCalculator {
  private config: FolderBoostConfig = DEFAULT_FOLDER_BOOST_CONFIG;
  private app: App | null;

  constructor(app?: App) {
    this.app = app || null;
  }

  setConfig(config: Partial<FolderBoostConfig>): void {
    this.config = { ...this.config, ...config };
  }

  applyBoosts(results: NoteIdRank[]): NoteIdRank[] {
    if (!this.config.enabled || results.length === 0) {
      return results;
    }

    const folderStats = this.calculateFolderStats(results);

    this.logBoostedFolders(folderStats);

    return results.map((result) => {
      const notePath = extractNotePathFromChunkId(result.id);
      const folder = this.extractFolder(notePath);
      const stats = folderStats.get(folder);

      if (stats) {
        const boostedScore = result.score * stats.boostFactor;
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

  private calculateFolderStats(results: NoteIdRank[]): Map<string, FolderBoostResult> {
    const folderNotes = new Map<string, Set<string>>();

    for (const result of results) {
      const notePath = extractNotePathFromChunkId(result.id);
      const folder = this.extractFolder(notePath);
      if (!folderNotes.has(folder)) {
        folderNotes.set(folder, new Set());
      }
      folderNotes.get(folder)!.add(notePath);
    }

    const folderCounts = new Map<string, number>();
    for (const [folder, notes] of folderNotes.entries()) {
      folderCounts.set(folder, notes.size);
    }

    const folderTotalCounts = this.getTotalDocsPerFolder();

    const folderStats = new Map<string, FolderBoostResult>();
    for (const [folder, count] of folderCounts.entries()) {
      const totalInFolder = folderTotalCounts.get(folder) || count;
      const relevanceRatio = count / totalInFolder;

      if (count >= this.config.minDocsForBoost && relevanceRatio >= this.config.minRelevanceRatio) {
        const baseBoost = 1 + Math.log2(count + 1);

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

  private getTotalDocsPerFolder(): Map<string, number> {
    const folderCounts = new Map<string, number>();

    if (!this.app) {
      return folderCounts;
    }

    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const folder = this.extractFolder(file.path);
      folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
    }

    return folderCounts;
  }

  private extractFolder(filePath: string): string {
    return filePath.substring(0, filePath.lastIndexOf("/")) || "";
  }

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

  getFolderBoosts(results: NoteIdRank[]): Map<string, FolderBoostResult> {
    if (!this.config.enabled) {
      return new Map();
    }
    return this.calculateFolderStats(results);
  }
}
