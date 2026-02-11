import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { extractNoteFiles } from "@/utils";
import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App, TFile } from "obsidian";
import { ChunkManager, getSharedChunkManager } from "./chunks";
import { SearchCore } from "./SearchCore";
import { ExpandedQuery } from "./QueryExpander";
// Defer requiring ChatModelManager until runtime to avoid test-time import issues
let getChatModelManagerSingleton: (() => any) | null = null;
async function safeGetChatModel() {
  try {
    if (!getChatModelManagerSingleton) {
      // dynamic import to prevent module load side effects during tests
      const mod = await import("@/LLMProviders/chatModelManager");
      getChatModelManagerSingleton = () => mod.default.getInstance();
    }
    const chatModelManager = getChatModelManagerSingleton();
    return chatModelManager.getChatModel();
  } catch {
    return null;
  }
}

/**
 * Tiered Lexical Retriever that implements multi-stage note retrieval:
 * 1. Grep scan for initial candidates
 * 2. Graph expansion to find related notes
 * 3. Full-text search with FlexSearch
 *
 * This retriever builds ephemeral indexes on-demand for each search,
 * ensuring always-fresh results without manual index management.
 *
 * Filter matching (title mentions, tag matches, time-range) is handled
 * separately by FilterRetriever at the SearchTools orchestration layer.
 */
export class TieredLexicalRetriever extends BaseRetriever {
  public lc_namespace = ["tiered_lexical_retriever"];
  private searchCore: SearchCore;
  private chunkManager: ChunkManager;
  private lastQueryExpansion: ExpandedQuery | null = null;

  constructor(
    private app: App,
    private options: {
      minSimilarityScore?: number;
      maxK: number;
      salientTerms: string[];
      textWeight?: number;
      returnAll?: boolean;
      useRerankerThreshold?: number; // Not used in v3, kept for compatibility
      preExpandedQuery?: ExpandedQuery; // Pre-expanded query data to avoid double expansion
    }
  ) {
    super();
    // Provide safe getter for chat model (returns null in tests if unavailable)
    this.searchCore = new SearchCore(app, safeGetChatModel);
    // Use shared singleton to ensure all systems share the same cache
    this.chunkManager = getSharedChunkManager(app);
  }

  /**
   * Get the query expansion data from the last search.
   * Returns the expanded terms, salient terms, and queries used.
   * @returns The last query expansion data or null if no search has been performed
   */
  getLastQueryExpansion(): ExpandedQuery | null {
    return this.lastQueryExpansion;
  }

  /**
   * Main entry point for document retrieval, compatible with LangChain interface.
   * Performs scored BM25+ search only. Filter matching (title/tag/time-range)
   * is handled by FilterRetriever at the orchestration layer.
   *
   * @param query - The search query
   * @param config - Optional callback configuration
   * @returns Array of Document objects with content and metadata
   */
  public async getRelevantDocuments(
    query: string,
    config?: BaseCallbackConfig
  ): Promise<Document[]> {
    try {
      // Extract note TFiles wrapped in [[]] from the query for salient term enhancement
      const noteFiles = extractNoteFiles(query, this.app.vault);
      const noteTitles = noteFiles.map((file) => file.basename);

      // Combine salient terms with note titles
      const enhancedSalientTerms = [...new Set([...this.options.salientTerms, ...noteTitles])];

      if (getSettings().debug) {
        logInfo("TieredLexicalRetriever: Starting search", {
          query,
          salientTerms: enhancedSalientTerms,
          maxK: this.options.maxK,
        });
      }

      // Perform the tiered search
      const settings = getSettings();
      const retrieveResult = await this.searchCore.retrieve(query, {
        maxResults: this.options.maxK,
        salientTerms: enhancedSalientTerms,
        enableLexicalBoosts: settings.enableLexicalBoosts,
        preExpandedQuery: this.options.preExpandedQuery,
      });
      const searchResults = retrieveResult.results;
      this.lastQueryExpansion = retrieveResult.queryExpansion;

      // Convert search results to Document format
      const searchDocuments = await this.convertToDocuments(searchResults);

      // Sort by score descending, maintaining chunk order for same-note near-ties
      const sortedDocuments = this.sortResults(searchDocuments);

      if (getSettings().debug) {
        logInfo("TieredLexicalRetriever: Search complete", {
          totalResults: sortedDocuments.length,
          searchResults: searchResults.length,
        });
      }

      return sortedDocuments;
    } catch (error) {
      logWarn("TieredLexicalRetriever: Error during search", error);
      // Fallback to empty results on error
      return [];
    }
  }

  /**
   * Convert v3 search results to LangChain Document format.
   * Supports both chunk IDs (note_path#chunk_index) and note IDs.
   */
  private async convertToDocuments(
    searchResults: Array<{ id: string; score: number; engine?: string; explanation?: any }>
  ): Promise<Document[]> {
    const documents: Document[] = [];

    for (const result of searchResults) {
      try {
        // Check if this is a chunk ID (contains #) or note ID
        const isChunkId = result.id.includes("#");

        if (isChunkId) {
          // Handle chunk result: get chunk content from ChunkManager
          const [notePath] = result.id.split("#");
          const file = this.app.vault.getAbstractFileByPath(notePath);
          if (!file || !(file instanceof TFile)) continue;

          // Get chunk content (not full note content)
          // Prefer async getter to auto-regenerate on cache miss; fall back to sync for test mocks
          let chunkContent = "";
          const cm: any = this.chunkManager as any;
          if (typeof cm.getChunkText === "function") {
            chunkContent = await cm.getChunkText(result.id);
          } else if (typeof cm.getChunkTextSync === "function") {
            chunkContent = cm.getChunkTextSync(result.id) || "";
          }
          if (!chunkContent) continue;

          const cache = this.app.metadataCache.getFileCache(file);

          documents.push(
            new Document({
              pageContent: chunkContent,
              metadata: {
                path: notePath,
                chunkId: result.id,
                title: file.basename,
                mtime: file.stat.mtime,
                ctime: file.stat.ctime,
                tags: cache?.tags?.map((t) => t.tag) || [],
                score: result.score,
                rerank_score: result.score,
                engine: result.engine || "chunk-v3",
                includeInContext: result.score > (this.options.minSimilarityScore || 0.1),
                explanation: result.explanation,
                isChunk: true,
              },
            })
          );
        } else {
          // Handle note result: full note content (legacy path)
          const file = this.app.vault.getAbstractFileByPath(result.id);
          if (!file || !(file instanceof TFile)) continue;

          const content = await this.app.vault.cachedRead(file);
          if (!content) continue;

          const cache = this.app.metadataCache.getFileCache(file);

          documents.push(
            new Document({
              pageContent: content,
              metadata: {
                path: result.id,
                title: file.basename,
                mtime: file.stat.mtime,
                ctime: file.stat.ctime,
                tags: cache?.tags?.map((t) => t.tag) || [],
                score: result.score,
                rerank_score: result.score,
                engine: result.engine || "v3",
                includeInContext: result.score > (this.options.minSimilarityScore || 0.1),
                explanation: result.explanation,
                isChunk: false,
              },
            })
          );
        }
      } catch (error) {
        logWarn(`TieredLexicalRetriever: Failed to convert result ${result.id}`, error);
      }
    }

    logInfo(`TieredLexicalRetriever: Converted ${documents.length} results to Documents`);
    return documents;
  }

  /**
   * Sort documents by score descending, maintaining chunk order for same-note near-ties.
   */
  private sortResults(documents: Document[]): Document[] {
    return documents.sort((a, b) => {
      const scoreA = a.metadata.score || 0;
      const scoreB = b.metadata.score || 0;

      const scoreDiff = scoreB - scoreA;
      if (Math.abs(scoreDiff) > 0.01) {
        return scoreDiff;
      }

      // If scores are similar and both are chunks from the same note, sort by chunk index
      if (a.metadata.isChunk && b.metadata.isChunk && a.metadata.path === b.metadata.path) {
        const aChunkIndex = parseInt(a.metadata.chunkId?.split("#")[1] || "0");
        const bChunkIndex = parseInt(b.metadata.chunkId?.split("#")[1] || "0");
        return aChunkIndex - bChunkIndex;
      }

      return scoreDiff;
    });
  }
}
