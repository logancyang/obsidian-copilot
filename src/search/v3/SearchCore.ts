import { logError, logInfo } from "@/logger";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { App } from "obsidian";
import { FullTextEngine } from "./engines/FullTextEngine";
import { GraphExpander } from "./expanders/GraphExpander";
import { NoteIdRank, SearchOptions } from "./interfaces";
import { QueryExpander } from "./QueryExpander";
import { GrepScanner } from "./scanners/GrepScanner";
import { weightedRRF } from "./utils/RRF";

/**
 * Core search engine that orchestrates the multi-stage retrieval pipeline
 */
export class SearchCore {
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
      maxVariants: 3,
      timeout: 4000, // 4 seconds timeout for LLM query rewrite
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
      logInfo(`\n=== SearchCore: Starting search for "${query}" ===`);

      // 1. Expand query into variants and terms
      const expanded = await this.queryExpander.expand(query);
      const queries = expanded.queries;
      // Combine expanded salient terms with any provided salient terms
      const salientTerms = options.salientTerms
        ? [...new Set([...expanded.salientTerms, ...options.salientTerms])]
        : expanded.salientTerms;

      logInfo(`Query expansion: ${queries.length} variants + ${salientTerms.length} terms`);
      logInfo(`  Variants: [${queries.map((q) => `"${q}"`).join(", ")}]`);
      logInfo(`  Terms: [${salientTerms.map((t) => `"${t}"`).join(", ")}]`);

      // 2. GREP for initial candidates (use both queries and terms)
      const allSearchStrings = [...queries, ...salientTerms];
      const grepHits = await this.grepScanner.batchCachedReadGrep(allSearchStrings, 200);

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

      // 6. Search full-text index with both query variants AND salient terms
      // This hybrid approach maximizes both precision (from phrases) and recall (from terms)
      const allFullTextQueries = [...queries, ...salientTerms];
      const fullTextResults = this.fullTextEngine.search(allFullTextQueries, maxResults * 2);

      logInfo(
        `Full-text search: Found ${fullTextResults.length} results (using ${allFullTextQueries.length} search inputs)`
      );

      // Only log in debug mode
      // if (fullTextResults.length > 0) {
      //   logInfo("Full-text top 10 results before RRF:");
      //   fullTextResults.slice(0, 10).forEach((r, i) => {
      //     logInfo(`  ${i+1}. ${r.id} (score: ${r.score.toFixed(4)})`);
      //   });
      // }

      // 7. Optional semantic re-ranking
      const semanticResults: NoteIdRank[] = [];
      if (enableSemantic && this.getChatModel) {
        // TODO: Implement semantic search when SemanticReranker is ready
        logInfo("SearchCore: Semantic search not yet implemented");
      }

      // 8. Convert grep hits to NoteIdRank for fusion
      const grepPrior: NoteIdRank[] = grepHits.slice(0, 50).map((id, idx) => ({
        id,
        score: 1 / (idx + 1),
        engine: "grep",
      }));

      // 9. Weighted RRF
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

      // Log results in an inspectable format
      if (finalResults.length > 0) {
        const resultsForLogging = finalResults.map((result, idx) => {
          const file = this.app.vault.getAbstractFileByPath(result.id);
          return {
            title: file?.name || result.id,
            path: result.id,
            score: result.score.toFixed(4),
            engine: result.engine,
          };
        });
        logInfo(`Final results: ${finalResults.length} documents (after RRF)`);
        console.table(resultsForLogging);
      } else {
        logInfo("No results found");
      }

      return finalResults;
    } catch (error) {
      logError("SearchCore: Retrieval failed", error);

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
   * Clear all caches and reset state
   */
  clear(): void {
    this.fullTextEngine.clear();
    this.queryExpander.clearCache();
    logInfo("SearchCore: Cleared all caches");
  }
}
