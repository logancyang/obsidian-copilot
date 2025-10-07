import { LLM_TIMEOUT_MS } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { App } from "obsidian";
import { ChunkManager } from "./chunks";
import { FullTextEngine } from "./engines/FullTextEngine";
import { NoteIdRank, SearchOptions } from "./interfaces";
import { QueryExpander } from "./QueryExpander";
import { GrepScanner } from "./scanners/GrepScanner";
import { FolderBoostCalculator } from "./scoring/FolderBoostCalculator";
import { GraphBoostCalculator } from "./scoring/GraphBoostCalculator";
import { ScoreNormalizer } from "./utils/ScoreNormalizer";

// Search constants
const FULLTEXT_RESULT_MULTIPLIER = 2;
export const RETURN_ALL_LIMIT = 200;

/**
 * Core search engine that orchestrates the multi-stage retrieval pipeline
 * Updated to support unified chunking architecture
 */
export class SearchCore {
  private grepScanner: GrepScanner;
  private fullTextEngine: FullTextEngine;
  private queryExpander: QueryExpander;
  private folderBoostCalculator: FolderBoostCalculator;
  private graphBoostCalculator: GraphBoostCalculator;
  private scoreNormalizer: ScoreNormalizer;
  private chunkManager: ChunkManager;

  constructor(
    private app: App,
    private getChatModel?: () => Promise<BaseChatModel | null>
  ) {
    this.grepScanner = new GrepScanner(app);
    this.chunkManager = new ChunkManager(app);
    this.fullTextEngine = new FullTextEngine(app, this.chunkManager);
    this.queryExpander = new QueryExpander({
      getChatModel: this.getChatModel,
      maxVariants: 3,
      timeout: LLM_TIMEOUT_MS,
    });
    this.folderBoostCalculator = new FolderBoostCalculator(app);
    this.graphBoostCalculator = new GraphBoostCalculator(app, {
      enabled: true,
      maxCandidates: 10, // Absolute ceiling
      boostStrength: 0.1,
      maxBoostMultiplier: 1.15,
    });
    this.scoreNormalizer = new ScoreNormalizer({
      method: "minmax", // Use min-max to preserve monotonicity
      clipMin: 0.02,
      clipMax: 0.98,
    });
  }

  /**
   * Main retrieval pipeline (now chunk-based by default)
   * @param query - User's search query
   * @param options - Search options
   * @returns Ranked list of chunk IDs
   */
  async retrieve(query: string, options: SearchOptions = {}): Promise<NoteIdRank[]> {
    // Input validation: check query
    if (!query || typeof query !== "string") {
      logWarn("SearchCore: Invalid query provided");
      return [];
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      logWarn("SearchCore: Empty query provided");
      return [];
    }

    if (trimmedQuery.length > 1000) {
      logWarn("SearchCore: Query too long, truncating");
      query = trimmedQuery.substring(0, 1000);
    } else {
      query = trimmedQuery;
    }

    // Validate and sanitize options with bounds checking
    const returnAll = Boolean(options.returnAll);
    const maxResults = returnAll
      ? RETURN_ALL_LIMIT
      : Math.min(Math.max(1, options.maxResults || 30), 100);
    const candidateLimit = returnAll
      ? RETURN_ALL_LIMIT
      : Math.min(Math.max(10, options.candidateLimit || 500), 1000);
    const enableLexicalBoosts = Boolean(options.enableLexicalBoosts ?? true); // Default to enabled

    try {
      // Log search start with minimal verbosity
      logInfo(`SearchCore: Searching for "${query}"`);

      // 1. Expand query into variants and terms
      const expanded = await this.queryExpander.expand(query);
      const queries = expanded.queries;
      // Combine expanded salient terms with any provided salient terms
      const salientTerms = options.salientTerms
        ? [...new Set([...expanded.salientTerms, ...options.salientTerms])]
        : expanded.salientTerms;

      // Build recall queries, ensuring tag variants are included for maximum recall
      const tagRecallTerms = this.buildTagRecallQueries(salientTerms);
      const recallQueries: string[] = [];
      const recallLookup = new Set<string>();

      const addRecallTerm = (term: string | undefined) => {
        if (!term) {
          return;
        }
        const normalized = term.toLowerCase();
        if (normalized.length === 0 || recallLookup.has(normalized)) {
          return;
        }
        recallLookup.add(normalized);
        recallQueries.push(term);
      };

      queries.forEach(addRecallTerm);
      expanded.expandedTerms.forEach(addRecallTerm);
      salientTerms.forEach(addRecallTerm);
      tagRecallTerms.forEach(addRecallTerm);

      // Only log details if expansion produced significant variants
      if (queries.length > 1 || salientTerms.length > 0 || expanded.expandedTerms.length > 0) {
        logInfo(
          `Query expansion: variants=${JSON.stringify(queries)}, salient=${JSON.stringify(
            salientTerms
          )}, recall=${JSON.stringify(expanded.expandedTerms)}`
        );
      }

      // 2. GREP for initial candidates (use all terms for maximum recall)
      const grepLimit = returnAll ? RETURN_ALL_LIMIT : 200;
      const grepHits = await this.grepScanner.batchCachedReadGrep(recallQueries, grepLimit);

      // 3. Limit candidates (no graph expansion - we use graph for boost only)
      const candidates = grepHits.slice(0, candidateLimit);

      // Log candidate info concisely
      logInfo(`SearchCore: ${candidates.length} candidates (from ${grepHits.length} grep hits)`);

      // 5. Run lexical search only (semantic search removed)
      const lexicalResults = await this.executeLexicalSearch(
        candidates,
        recallQueries,
        salientTerms,
        maxResults,
        expanded.originalQuery,
        returnAll
      );

      // 6. Apply boosts to lexical results (if enabled)
      let finalResults = lexicalResults;
      if (enableLexicalBoosts) {
        finalResults = this.folderBoostCalculator.applyBoosts(finalResults);
        finalResults = this.graphBoostCalculator.applyBoost(finalResults);
      }

      // 7. Apply score normalization to prevent auto-1.0
      finalResults = this.scoreNormalizer.normalize(finalResults);

      // 8. Clean up full-text index to free memory
      this.fullTextEngine.clear();

      // 9. Return top K results
      if (finalResults.length > maxResults) {
        finalResults = finalResults.slice(0, maxResults);
      }

      // Log final result summary
      if (finalResults.length > 0) {
        const topResult = this.app.vault.getAbstractFileByPath(finalResults[0].id);
        logInfo(
          `SearchCore: ${finalResults.length} results found (top: ${topResult?.name || finalResults[0].id})`
        );
      } else {
        logInfo("SearchCore: No results found");
      }

      return finalResults;
    } catch (error) {
      logError("SearchCore: Retrieval failed", error);

      // Fallback to simple grep results (guaranteed to return [])
      try {
        const fallbackResults = await this.fallbackSearch(query, maxResults);
        return fallbackResults;
      } catch (fallbackError) {
        logError("SearchCore: Fallback search also failed", fallbackError);
        return []; // Always return empty array on complete failure
      }
    }
  }

  /**
   * Fallback search using only grep
   * @param query - Search query
   * @param limit - Maximum results
   * @returns Basic grep results as NoteIdRank
   */
  private async fallbackSearch(query: string, limit: number): Promise<NoteIdRank[]> {
    try {
      const grepHits = await this.grepScanner.grep(query, limit);
      return grepHits.map((id, idx) => ({
        id,
        score: 1 / (idx + 1),
        engine: "grep",
      }));
    } catch (error) {
      logError("SearchCore: Fallback search failed", error);
      return [];
    }
  }

  /**
   * Get statistics about the last retrieval
   */
  getStats(): {
    fullTextStats: { documentsIndexed: number; memoryUsed: number; memoryPercent: number };
  } {
    return {
      fullTextStats: this.fullTextEngine.getStats(),
    };
  }

  /**
   * Get the shared ChunkManager instance
   */
  getChunkManager(): ChunkManager {
    return this.chunkManager;
  }

  /**
   * Clear all caches and reset state
   */
  clear(): void {
    this.fullTextEngine.clear();
    this.queryExpander.clearCache();
    logInfo("SearchCore: Cleared all caches");
  }

  /**
   * Builds additional recall terms for tag queries so that tagged notes are always considered during recall.
   * Generates lowercase variants without the hash prefix and splits hierarchical tags into their components.
   *
   * @param salientTerms - Salient terms extracted from the original query (may include hash-prefixed tags)
   * @returns Unique recall terms derived from tag tokens (e.g., ['project/alpha', 'project', 'alpha'])
   */
  private buildTagRecallQueries(salientTerms: string[]): string[] {
    const tagQueries = new Set<string>();

    for (const term of salientTerms) {
      if (!term || !term.startsWith("#")) {
        continue;
      }

      const normalized = term.toLowerCase();
      if (normalized.length <= 1) {
        continue;
      }

      const withoutHash = normalized.slice(1);
      if (withoutHash.length === 0) {
        continue;
      }

      tagQueries.add(withoutHash);

      const segments = withoutHash.split("/").filter((segment) => segment.length > 0);
      if (segments.length > 0) {
        let prefix = "";
        for (const segment of segments) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          tagQueries.add(prefix);
          tagQueries.add(segment);
        }
      }
    }

    return Array.from(tagQueries);
  }

  /**
   * Execute lexical search with full-text index
   * @param candidates - Candidate documents to index
   * @param recallQueries - All queries for recall (original + expanded + salient terms)
   * @param salientTerms - Salient terms for scoring (extracted from original query)
   * @param maxResults - Maximum number of results
   * @param originalQuery - The original user query for scoring
   * @returns Ranked list of documents from lexical search
   */
  private async executeLexicalSearch(
    candidates: string[],
    recallQueries: string[],
    salientTerms: string[],
    maxResults: number,
    originalQuery?: string,
    returnAll: boolean = false
  ): Promise<NoteIdRank[]> {
    try {
      // Build ephemeral full-text index
      const buildStartTime = Date.now();
      const indexed = await this.fullTextEngine.buildFromCandidates(candidates);
      const buildTime = Date.now() - buildStartTime;

      // Search the index
      const searchStartTime = Date.now();
      const effectiveMaxResults = returnAll
        ? RETURN_ALL_LIMIT
        : Number.isFinite(maxResults)
          ? Math.min(maxResults, 1000)
          : candidates.length || 30;
      const searchLimit = returnAll
        ? RETURN_ALL_LIMIT * FULLTEXT_RESULT_MULTIPLIER
        : Math.max(effectiveMaxResults * FULLTEXT_RESULT_MULTIPLIER, FULLTEXT_RESULT_MULTIPLIER);
      const results = this.fullTextEngine.search(
        recallQueries,
        searchLimit,
        salientTerms,
        originalQuery
      );
      const searchTime = Date.now() - searchStartTime;

      // Single consolidated log for lexical search
      logInfo(
        `Full-text: ${indexed} docs indexed (${buildTime}ms), ${results.length} results (${searchTime}ms)`
      );
      return results;
    } catch (error) {
      logError("Full-text search failed", error);
      return [];
    }
  }
}
