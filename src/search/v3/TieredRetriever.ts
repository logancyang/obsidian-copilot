import { logError, logInfo } from "@/logger";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { App } from "obsidian";
import { FullTextEngine } from "./engines/FullTextEngine";
import { GraphExpander } from "./expanders/GraphExpander";
import { NoteIdRank, SearchOptions } from "./interfaces";
import { QueryExpander } from "./QueryExpander";
import { GrepScanner } from "./scanners/GrepScanner";
import { weightedRRF } from "./utils/RRFFusion";

/**
 * Main orchestrator for tiered note-level lexical retrieval
 */
export class TieredRetriever {
  private grepScanner: GrepScanner;
  private graphExpander: GraphExpander;
  private fullTextEngine: FullTextEngine;
  private queryExpander: QueryExpander;

  constructor(
    private app: App,
    private getChatModel?: () => Promise<BaseChatModel | null>
  ) {
    this.grepScanner = new GrepScanner(app);
    this.graphExpander = new GraphExpander(app);
    this.fullTextEngine = new FullTextEngine(app);
    this.queryExpander = new QueryExpander({
      getChatModel: this.getChatModel,
      maxVariants: 2,
      timeout: 500,
    });
  }

  /**
   * Main retrieval pipeline
   * @param query - User's search query
   * @param options - Search options
   * @returns Ranked list of note IDs
   */
  async retrieve(query: string, options: SearchOptions = {}): Promise<NoteIdRank[]> {
    const {
      maxResults = 30,
      enableSemantic = false,
      semanticWeight = 2.0,
      candidateLimit = 500,
      graphHops = 1,
      rrfK = 60,
    } = options;

    try {
      logInfo(`\n=== TieredRetriever: Starting search for "${query}" ===`);

      // 1. Expand query into variants and terms
      const expanded = await this.queryExpander.expand(query);
      const queries = expanded.queries;

      logInfo(
        `Query expansion: ${queries.length} variants - [${queries.map((q) => `"${q}"`).join(", ")}]`
      );

      // 2. GREP for initial candidates
      const grepHits = await this.grepScanner.batchCachedReadGrep(queries, 200);

      logInfo(`Grep scan: Found ${grepHits.length} initial matches`);

      // 3. Graph expansion from grep results
      const activeFile = this.app.workspace.getActiveFile();
      const expandedCandidates = await this.graphExpander.expandCandidates(
        grepHits,
        activeFile,
        graphHops
      );

      // 4. Limit candidates
      const candidates = expandedCandidates.slice(0, candidateLimit);

      logInfo(
        `Graph expansion: ${grepHits.length} grep → ${expandedCandidates.length} expanded → ${candidates.length} final candidates`
      );

      // 5. Build ephemeral full-text index
      const indexed = await this.fullTextEngine.buildFromCandidates(candidates);

      logInfo(`Full-text index: Built with ${indexed} documents`);

      // 6. Search full-text index with all query variants
      const fullTextResults = this.fullTextEngine.search(queries, maxResults * 2);

      logInfo(`Full-text search: Found ${fullTextResults.length} results`);

      // 7. Optional semantic re-ranking
      const semanticResults: NoteIdRank[] = [];
      if (enableSemantic && this.getChatModel) {
        // TODO: Implement semantic search when SemanticReranker is ready
        logInfo("TieredRetriever: Semantic search not yet implemented");
      }

      // 8. Convert grep hits to NoteIdRank for fusion
      const grepPrior: NoteIdRank[] = grepHits.slice(0, 50).map((id, idx) => ({
        id,
        score: 1 / (idx + 1),
        engine: "grep",
      }));

      // 9. Weighted RRF fusion
      const fusedResults = weightedRRF({
        lexical: fullTextResults,
        semantic: semanticResults,
        grepPrior: grepPrior,
        weights: {
          lexical: 1.0,
          semantic: semanticWeight,
          grepPrior: 0.3,
        },
        k: rrfK,
      });

      // 10. Clean up full-text index to free memory
      this.fullTextEngine.clear();

      // 11. Return top K results
      const finalResults = fusedResults.slice(0, maxResults);

      logInfo(`Final results: ${finalResults.length} documents (after RRF fusion)\n`);

      return finalResults;
    } catch (error) {
      logError("TieredRetriever: Retrieval failed", error);

      // Fallback to simple grep results
      const fallbackResults = await this.fallbackSearch(query, maxResults);
      return fallbackResults;
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
      logError("TieredRetriever: Fallback search failed", error);
      return [];
    }
  }

  /**
   * Progressive expansion - increase graph hops if recall is low
   * @param currentResults - Current result set
   * @param query - Original query
   * @param currentHops - Current hop count
   * @returns Expanded results if needed
   */
  async progressiveExpansion(
    currentResults: NoteIdRank[],
    query: string,
    currentHops: number
  ): Promise<NoteIdRank[]> {
    // If we have very few results, try expanding with more hops
    if (currentResults.length < 5 && currentHops < 3) {
      logInfo(
        `TieredRetriever: Low recall (${currentResults.length}), expanding to ${currentHops + 1} hops`
      );

      return this.retrieve(query, {
        graphHops: currentHops + 1,
        maxResults: 30,
      });
    }

    return currentResults;
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
   * Clear all caches and reset state
   */
  clear(): void {
    this.fullTextEngine.clear();
    this.queryExpander.clearCache();
    logInfo("TieredRetriever: Cleared all caches");
  }
}
