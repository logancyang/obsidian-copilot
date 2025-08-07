import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { App, TFile } from "obsidian";
import { SearchCore } from "./SearchCore";
import { logInfo, logWarn } from "@/logger";
import { extractNoteFiles } from "@/utils";
import { getSettings } from "@/settings/model";
import ChatModelManager from "@/LLMProviders/chatModelManager";

/**
 * Tiered Lexical Retriever that implements multi-stage note retrieval:
 * 1. Grep scan for initial candidates
 * 2. Graph expansion to find related notes
 * 3. Full-text search with FlexSearch
 * 4. Optional semantic reranking (future)
 *
 * This retriever builds ephemeral indexes on-demand for each search,
 * ensuring always-fresh results without manual index management.
 */
export class TieredLexicalRetriever extends BaseRetriever {
  public lc_namespace = ["tiered_lexical_retriever"];
  private searchCore: SearchCore;

  constructor(
    private app: App,
    private options: {
      minSimilarityScore?: number;
      maxK: number;
      salientTerms: string[];
      timeRange?: { startTime: number; endTime: number };
      textWeight?: number;
      returnAll?: boolean;
      useRerankerThreshold?: number; // Not used in v3, kept for compatibility
    }
  ) {
    super();
    // Create a getter for the chat model
    const getChatModel = async () => {
      try {
        const chatModelManager = ChatModelManager.getInstance();
        return chatModelManager.getChatModel();
      } catch {
        // Return null if no chat model available (query expansion will use fallback)
        return null;
      }
    };
    this.searchCore = new SearchCore(app, getChatModel);
  }

  /**
   * Main entry point for document retrieval, compatible with LangChain interface.
   * @param query - The search query
   * @param config - Optional callback configuration
   * @returns Array of Document objects with content and metadata
   */
  public async getRelevantDocuments(
    query: string,
    config?: BaseCallbackConfig
  ): Promise<Document[]> {
    try {
      // Extract note TFiles wrapped in [[]] from the query
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
      const searchResults = await this.searchCore.retrieve(query, {
        maxResults: this.options.maxK,
        salientTerms: enhancedSalientTerms,
        // We're not using semantic for now, so disable it
        enableSemantic: false,
      });

      // Get mentioned notes that should always be included
      const mentionedNotes = await this.getMentionedNotes(noteFiles);

      // Convert search results to Document format
      const searchDocuments = await this.convertToDocuments(searchResults);

      // Combine and deduplicate results
      const combinedDocuments = this.combineResults(searchDocuments, mentionedNotes);

      // Apply time range filter if specified
      const filteredDocuments = this.applyTimeRangeFilter(combinedDocuments);

      if (getSettings().debug) {
        logInfo("TieredLexicalRetriever: Search complete", {
          totalResults: filteredDocuments.length,
          mentionedNotes: mentionedNotes.length,
          searchResults: searchResults.length,
        });
      }

      return filteredDocuments;
    } catch (error) {
      logWarn("TieredLexicalRetriever: Error during search", error);
      // Fallback to empty results on error
      return [];
    }
  }

  /**
   * Get documents for explicitly mentioned note files (using [[]] syntax).
   * These are always included in results regardless of search score.
   */
  private async getMentionedNotes(noteFiles: TFile[]): Promise<Document[]> {
    const chunks: Document[] = [];

    for (const file of noteFiles) {
      try {
        const content = await this.app.vault.cachedRead(file);
        const cache = this.app.metadataCache.getFileCache(file);

        // Create a document for the entire note
        chunks.push(
          new Document({
            pageContent: content,
            metadata: {
              path: file.path,
              title: file.basename,
              mtime: file.stat.mtime,
              ctime: file.stat.ctime,
              tags: cache?.tags?.map((t) => t.tag) || [],
              includeInContext: true, // Always include mentioned notes
              score: 1.0, // Max score for explicit mentions
              source: "mentioned",
            },
          })
        );
      } catch (error) {
        logWarn(`TieredLexicalRetriever: Failed to read mentioned file ${file.path}`, error);
      }
    }

    return chunks;
  }

  /**
   * Convert v3 search results to LangChain Document format.
   */
  private async convertToDocuments(
    searchResults: Array<{ id: string; score: number; engine?: string }>
  ): Promise<Document[]> {
    const documents: Document[] = [];

    for (const result of searchResults) {
      try {
        const file = this.app.vault.getAbstractFileByPath(result.id);
        if (!(file instanceof TFile)) continue;

        const content = await this.app.vault.cachedRead(file);
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
              engine: result.engine || "v3",
              includeInContext: result.score > (this.options.minSimilarityScore || 0.1),
            },
          })
        );
      } catch (error) {
        logWarn(`TieredLexicalRetriever: Failed to convert result ${result.id}`, error);
      }
    }

    return documents;
  }

  /**
   * Combine search results with mentioned notes, deduplicating by path.
   */
  private combineResults(searchDocuments: Document[], mentionedNotes: Document[]): Document[] {
    const documentMap = new Map<string, Document>();

    // Add mentioned notes first (they have priority)
    for (const doc of mentionedNotes) {
      documentMap.set(doc.metadata.path, doc);
    }

    // Add search results (won't override explicit chunks)
    for (const doc of searchDocuments) {
      if (!documentMap.has(doc.metadata.path)) {
        documentMap.set(doc.metadata.path, doc);
      }
    }

    // Sort by score descending
    return Array.from(documentMap.values()).sort((a, b) => {
      const scoreA = a.metadata.score || 0;
      const scoreB = b.metadata.score || 0;
      return scoreB - scoreA;
    });
  }

  /**
   * Apply folder-based boosting to improve ranking of related notes.
   * Notes in the same folder get a slight boost when multiple notes from that folder are found.
   * @deprecated Moved to FullTextEngine for proper integration with RRF
   */
  private applyFolderBoost(documents: Document[]): void {
    // Count notes per folder
    const folderCounts = new Map<string, number>();

    for (const doc of documents) {
      const path = doc.metadata.path as string;
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash > 0) {
        const folder = path.substring(0, lastSlash);
        folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
      }
    }

    // Apply boost to notes in folders with multiple matches
    for (const doc of documents) {
      const path = doc.metadata.path as string;
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash > 0) {
        const folder = path.substring(0, lastSlash);
        const count = folderCounts.get(folder) || 1;

        // Boost score based on folder prevalence (more notes in folder = higher boost)
        if (count > 1) {
          const currentScore = doc.metadata.score || 0;
          // Apply 10-30% boost based on folder prevalence
          const boostFactor = 1 + Math.min(0.3, 0.1 * Math.log2(count));
          doc.metadata.score = currentScore * boostFactor;
          doc.metadata.folderBoost = boostFactor;
        }
      }
    }
  }

  /**
   * Apply time range filter if specified in options.
   */
  private applyTimeRangeFilter(documents: Document[]): Document[] {
    if (!this.options.timeRange) {
      return documents;
    }

    const { startTime, endTime } = this.options.timeRange;

    return documents.filter((doc) => {
      const mtime = doc.metadata.mtime;
      if (typeof mtime !== "number") return false;

      return mtime >= startTime && mtime <= endTime;
    });
  }
}
