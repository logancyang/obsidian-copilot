import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App, Notice } from "obsidian";
import { HybridRetriever } from "./hybridRetriever";
import { TieredLexicalRetriever } from "./v3/TieredLexicalRetriever";

/**
 * Unified interface for search operations (retrieval and indexing)
 */
export interface IndexingResult {
  success: boolean;
  documentCount?: number;
  message?: string;
}

/**
 * Interface for search indexing operations
 */
export interface SearchIndexer {
  indexVaultIncremental(app: App): Promise<IndexingResult>;
  indexVaultFull(app: App): Promise<IndexingResult>;
  ensureLoaded(app: App): Promise<void>;
  clearIndex(app: App): Promise<void>;
}

/**
 * Retriever options interface
 */
export interface RetrieverOptions {
  minSimilarityScore?: number;
  maxK: number;
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll?: boolean;
  useRerankerThreshold?: number;
}

/**
 * Abstract interface for search systems
 */
export interface SearchSystem {
  readonly name: string;
  readonly version: string;
  readonly isLegacy: boolean;

  createRetriever(app: App, options: RetrieverOptions): BaseRetriever;
  getIndexer(): SearchIndexer;
  isSemanticSearchEnabled(): boolean;
}

/**
 * Legacy Orama-based search indexer implementation
 */
class LegacySearchIndexer implements SearchIndexer {
  async indexVaultIncremental(app: App): Promise<IndexingResult> {
    logInfo("LegacySearchIndexer: Incremental indexing");
    try {
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(false);
      return { success: true, documentCount: count };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async indexVaultFull(app: App): Promise<IndexingResult> {
    logInfo("LegacySearchIndexer: Full indexing");
    try {
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(true);
      return { success: true, documentCount: count };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async ensureLoaded(app: App): Promise<void> {
    logInfo("LegacySearchIndexer: Ensuring index is loaded");
    const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
    const isEmpty = await VectorStoreManager.getInstance().isIndexEmpty();
    if (isEmpty) {
      new Notice("Legacy Orama index is empty. Please rebuild the index.");
    }
  }

  async clearIndex(app: App): Promise<void> {
    logInfo("LegacySearchIndexer: Clearing index");
    const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
    await VectorStoreManager.getInstance().clearIndex();
  }
}

/**
 * V3 MemoryIndexManager-based search indexer implementation
 */
class V3SearchIndexer implements SearchIndexer {
  async indexVaultIncremental(app: App): Promise<IndexingResult> {
    logInfo("V3SearchIndexer: Incremental indexing");
    try {
      const { MemoryIndexManager } = await import("@/search/v3/MemoryIndexManager");
      await MemoryIndexManager.getInstance(app).indexVaultIncremental();
      await MemoryIndexManager.getInstance(app).ensureLoaded();
      // V3 doesn't provide a direct count
      return { success: true, message: "V3 index updated" };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async indexVaultFull(app: App): Promise<IndexingResult> {
    logInfo("V3SearchIndexer: Full indexing");
    try {
      const { MemoryIndexManager } = await import("@/search/v3/MemoryIndexManager");
      await MemoryIndexManager.getInstance(app).indexVault();
      await MemoryIndexManager.getInstance(app).ensureLoaded();
      return { success: true, message: "V3 index rebuilt" };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async ensureLoaded(app: App): Promise<void> {
    logInfo("V3SearchIndexer: Ensuring index is loaded");
    const { MemoryIndexManager } = await import("@/search/v3/MemoryIndexManager");
    await MemoryIndexManager.getInstance(app).ensureLoaded();
  }

  async clearIndex(app: App): Promise<void> {
    logInfo("V3SearchIndexer: Clear not supported - index rebuilds on demand");
    new Notice("V3 search rebuilds index automatically on demand.");
  }
}

/**
 * Legacy Orama-based search system implementation
 * @deprecated Will be removed in v3.0.0
 */
class LegacySearchSystem implements SearchSystem {
  readonly name = "Orama";
  readonly version = "legacy";
  readonly isLegacy = true;
  private indexer = new LegacySearchIndexer();

  createRetriever(app: App, options: RetrieverOptions): BaseRetriever {
    return new HybridRetriever({
      ...options,
      minSimilarityScore: options.minSimilarityScore ?? 0.1,
    });
  }

  getIndexer(): SearchIndexer {
    return this.indexer;
  }

  isSemanticSearchEnabled(): boolean {
    // Legacy always has semantic capability via embeddings
    return true;
  }
}

/**
 * V3 TieredLexical search system implementation
 */
class V3SearchSystem implements SearchSystem {
  readonly name = "TieredLexical";
  readonly version = "v3";
  readonly isLegacy = false;
  private indexer = new V3SearchIndexer();

  createRetriever(app: App, options: RetrieverOptions): BaseRetriever {
    return new TieredLexicalRetriever(app, options);
  }

  getIndexer(): SearchIndexer {
    return this.indexer;
  }

  isSemanticSearchEnabled(): boolean {
    return getSettings().enableSemanticSearchV3;
  }
}

/**
 * Factory for creating and managing search systems
 */
export class SearchSystemFactory {
  private static searchSystem: SearchSystem | null = null;

  /**
   * Get the current search system based on settings
   */
  static getSearchSystem(): SearchSystem {
    const settings = getSettings();

    // Check if we need to recreate due to settings change
    if (this.searchSystem) {
      const isCurrentlyLegacy = this.searchSystem.isLegacy;
      const shouldBeLegacy = settings.useLegacySearch;

      if (isCurrentlyLegacy !== shouldBeLegacy) {
        this.searchSystem = null;
      }
    }

    if (!this.searchSystem) {
      if (settings.useLegacySearch) {
        logWarn(
          "DEPRECATED: Legacy Orama search is deprecated and will be removed in a future version. Please switch to v3 search in QA Settings."
        );
        this.searchSystem = new LegacySearchSystem();
      } else {
        this.searchSystem = new V3SearchSystem();
      }
    }

    return this.searchSystem;
  }

  /**
   * Reset the cached search system (use when settings change)
   */
  static reset(): void {
    this.searchSystem = null;
  }

  /**
   * Create a retriever using the current search system
   */
  static createRetriever(app: App, options: RetrieverOptions): BaseRetriever {
    const searchSystem = this.getSearchSystem();
    logInfo(`Creating retriever using ${searchSystem.name} (${searchSystem.version})`);

    try {
      return searchSystem.createRetriever(app, options);
    } catch (error) {
      // Fallback to v3 if legacy fails
      if (searchSystem.isLegacy) {
        logWarn("Failed to create legacy retriever, falling back to v3");
        return new V3SearchSystem().createRetriever(app, options);
      }
      throw error;
    }
  }

  /**
   * Get the indexer for the current search system
   */
  static getIndexer(): SearchIndexer {
    return this.getSearchSystem().getIndexer();
  }
}
