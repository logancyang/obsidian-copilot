import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { extractNoteFiles } from "@/utils";
import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App, TFile } from "obsidian";
import { SearchCore } from "./SearchCore";
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
    // Provide safe getter for chat model (returns null in tests if unavailable)
    this.searchCore = new SearchCore(app, safeGetChatModel);
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
      // If time range is specified, ONLY return time-relevant documents
      if (this.options.timeRange) {
        return this.getTimeRangeDocuments(query);
      }

      // Normal search flow when no time range
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
        enableSemantic: !!getSettings().enableSemanticSearchV3,
      });

      // Get title-matched notes that should always be included
      const titleMatches = await this.getTitleMatches(noteFiles);

      // Convert search results to Document format
      const searchDocuments = await this.convertToDocuments(searchResults);

      // Combine and deduplicate results
      const combinedDocuments = this.combineResults(searchDocuments, titleMatches);

      if (getSettings().debug) {
        logInfo("TieredLexicalRetriever: Search complete", {
          totalResults: combinedDocuments.length,
          titleMatches: titleMatches.length,
          searchResults: searchResults.length,
        });
      }

      return combinedDocuments;
    } catch (error) {
      logWarn("TieredLexicalRetriever: Error during search", error);
      // Fallback to empty results on error
      return [];
    }
  }

  /**
   * Get documents for time-based queries.
   * ONLY returns daily notes and documents within the time range.
   */
  private async getTimeRangeDocuments(_query: string): Promise<Document[]> {
    if (!this.options.timeRange) {
      return [];
    }

    const { startTime, endTime } = this.options.timeRange;

    // Generate daily note titles for the date range
    const dailyNoteTitles = this.generateDailyNoteDateRange(startTime, endTime);

    if (getSettings().debug) {
      logInfo("TieredLexicalRetriever: Generated daily note titles", {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        titlesCount: dailyNoteTitles.length,
        firstTitle: dailyNoteTitles[0],
        lastTitle: dailyNoteTitles[dailyNoteTitles.length - 1],
      });
    }

    // Extract daily note files by exact title match
    const dailyNoteQuery = dailyNoteTitles.join(", ");
    const dailyNoteFiles = extractNoteFiles(dailyNoteQuery, this.app.vault);

    // Get documents for daily notes
    const dailyNoteDocuments = await this.getTitleMatches(dailyNoteFiles);

    // Mark all daily notes for inclusion in context
    const dailyNotesWithContext = dailyNoteDocuments.map((doc) => {
      doc.metadata.includeInContext = true;
      return doc;
    });

    // For time-based queries, we DON'T run regular search
    // Instead, find all documents modified within the time range
    const allFiles = this.app.vault.getMarkdownFiles();
    const timeFilteredDocuments: Document[] = [];

    // Limit the number of time-filtered documents to avoid overwhelming results
    const maxTimeFilteredDocs = Math.min(this.options.maxK, 100);

    for (const file of allFiles) {
      // Only include files modified within the time range
      if (file.stat.mtime >= startTime && file.stat.mtime <= endTime) {
        // Skip if already included as daily note
        if (dailyNoteFiles.some((f) => f.path === file.path)) {
          continue;
        }

        // Stop if we have enough documents
        if (timeFilteredDocuments.length >= maxTimeFilteredDocs) {
          break;
        }

        try {
          const content = await this.app.vault.cachedRead(file);
          const cache = this.app.metadataCache.getFileCache(file);

          // Calculate score based on recency (more recent = higher score)
          const daysSinceModified = (Date.now() - file.stat.mtime) / (1000 * 60 * 60 * 24);
          const recencyScore = Math.max(0.3, Math.min(1.0, 1.0 - daysSinceModified / 30));

          timeFilteredDocuments.push(
            new Document({
              pageContent: content,
              metadata: {
                path: file.path,
                title: file.basename,
                mtime: file.stat.mtime,
                ctime: file.stat.ctime,
                tags: cache?.tags?.map((t) => t.tag) || [],
                includeInContext: true,
                score: recencyScore,
                source: "time-filtered",
              },
            })
          );
        } catch (error) {
          logWarn(`TieredLexicalRetriever: Failed to read file ${file.path}`, error);
        }
      }
    }

    // Combine and deduplicate
    const documentMap = new Map<string, Document>();

    // Add daily notes first (they have priority)
    for (const doc of dailyNotesWithContext) {
      documentMap.set(doc.metadata.path, doc);
    }

    // Add time-filtered documents
    for (const doc of timeFilteredDocuments) {
      if (!documentMap.has(doc.metadata.path)) {
        documentMap.set(doc.metadata.path, {
          ...doc,
          metadata: {
            ...doc.metadata,
            includeInContext: true,
          },
        });
      }
    }

    // Sort by score (daily notes get score 1.0, time-filtered by recency)
    const results = Array.from(documentMap.values()).sort((a, b) => {
      const scoreA = a.metadata.score || 0;
      const scoreB = b.metadata.score || 0;
      return scoreB - scoreA;
    });

    if (getSettings().debug) {
      logInfo("TieredLexicalRetriever: Time range search complete", {
        timeRange: this.options.timeRange,
        dailyNotesFound: dailyNoteFiles.length,
        timeFilteredDocs: timeFilteredDocuments.length,
        totalResults: results.length,
      });
    }

    return results;
  }

  /**
   * Generate daily note titles for a date range.
   * Returns titles in [[YYYY-MM-DD]] format.
   */
  private generateDailyNoteDateRange(startTime: number, endTime: number): string[] {
    const dailyNotes: string[] = [];
    const start = new Date(startTime);
    const end = new Date(endTime);

    // Limit to 365 days for performance
    const maxDays = 365;
    const daysDiff = Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24));

    if (daysDiff > maxDays) {
      logWarn(
        `TieredLexicalRetriever: Date range exceeds ${maxDays} days, limiting to recent ${maxDays} days`
      );
      start.setTime(end.getTime() - maxDays * 24 * 60 * 60 * 1000);
    }

    const current = new Date(start);
    while (current <= end) {
      // Use en-CA locale for YYYY-MM-DD format
      dailyNotes.push(`[[${current.toLocaleDateString("en-CA")}]]`);
      current.setDate(current.getDate() + 1);
    }

    return dailyNotes;
  }

  /**
   * Get documents for notes matching by title (explicit [[]] mentions or time-based queries).
   * These are always included in results regardless of search score.
   */
  private async getTitleMatches(noteFiles: TFile[]): Promise<Document[]> {
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
              includeInContext: true, // Always include title matches
              score: 1.0, // Max score for title matches
              source: "title-match",
            },
          })
        );
      } catch (error) {
        logWarn(`TieredLexicalRetriever: Failed to read title-matched file ${file.path}`, error);
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
  private combineResults(searchDocuments: Document[], titleMatches: Document[]): Document[] {
    const documentMap = new Map<string, Document>();

    // Add title matches first (they have priority)
    for (const doc of titleMatches) {
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
}
