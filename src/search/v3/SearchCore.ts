import { logError, logInfo } from "@/logger";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { App } from "obsidian";
import { FullTextEngine } from "./engines/FullTextEngine";
import { NoteIdRank, SearchOptions } from "./interfaces";
import { MemoryIndexManager } from "./MemoryIndexManager";
import { QueryExpander } from "./QueryExpander";
import { GrepScanner } from "./scanners/GrepScanner";
import { FolderBoostCalculator } from "./scoring/FolderBoostCalculator";
import { GraphBoostCalculator } from "./scoring/GraphBoostCalculator";
import { weightedRRF } from "./utils/RRF";
import { ScoreNormalizer } from "./utils/ScoreNormalizer";

// LLM timeout for query expansion and HyDE generation
const LLM_GENERATION_TIMEOUT_MS = 5000;

// Search constants
const DEFAULT_SEMANTIC_TOP_K_LIMIT = 200;
const FULLTEXT_RESULT_MULTIPLIER = 2;

/**
 * Core search engine that orchestrates the multi-stage retrieval pipeline
 */
export class SearchCore {
  private grepScanner: GrepScanner;
  private fullTextEngine: FullTextEngine;
  private queryExpander: QueryExpander;
  private folderBoostCalculator: FolderBoostCalculator;
  private graphBoostCalculator: GraphBoostCalculator;
  private scoreNormalizer: ScoreNormalizer;

  constructor(
    private app: App,
    private getChatModel?: () => Promise<BaseChatModel | null>
  ) {
    this.grepScanner = new GrepScanner(app);
    this.fullTextEngine = new FullTextEngine(app);
    this.queryExpander = new QueryExpander({
      getChatModel: this.getChatModel,
      maxVariants: 3,
      timeout: LLM_GENERATION_TIMEOUT_MS,
    });
    this.folderBoostCalculator = new FolderBoostCalculator();
    this.graphBoostCalculator = new GraphBoostCalculator(app, {
      enabled: true,
      maxCandidates: 50,
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
   * Main retrieval pipeline
   * @param query - User's search query
   * @param options - Search options
   * @returns Ranked list of note IDs
   */
  async retrieve(query: string, options: SearchOptions = {}): Promise<NoteIdRank[]> {
    // Validate and sanitize options
    const maxResults = Math.min(Math.max(1, options.maxResults || 30), 100);
    const enableSemantic = options.enableSemantic || false;
    const semanticWeight = Math.min(Math.max(0, options.semanticWeight ?? 0.6), 1); // Default 60% semantic
    const candidateLimit = Math.min(Math.max(10, options.candidateLimit || 500), 1000);
    const rrfK = Math.min(Math.max(1, options.rrfK || 60), 100);

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

      // 3. Limit candidates (no graph expansion - we use graph for boost only)
      const candidates = grepHits.slice(0, candidateLimit);

      logInfo(`Using ${candidates.length} candidates for BOTH full-text and semantic search`);

      // Prepare queries for both engines
      const allFullTextQueries = [...queries, ...salientTerms];

      // 5, 6 & 7. Run lexical and semantic searches in parallel
      const [fullTextResults, semanticResults] = await Promise.all([
        this.executeLexicalSearch(candidates, allFullTextQueries, salientTerms, maxResults),
        enableSemantic
          ? this.executeSemanticSearch(candidates, allFullTextQueries, query, candidateLimit)
          : Promise.resolve([]),
      ]);

      // 8. Weighted RRF with normalized weights
      // semanticWeight now represents the percentage (0-1) for semantic
      // lexical gets the remainder to ensure weights sum to 1.0
      let fusedResults = weightedRRF({
        lexical: fullTextResults,
        semantic: semanticResults,
        weights: {
          lexical: 1.0 - semanticWeight,
          semantic: semanticWeight,
        },
        k: rrfK,
      });

      // 9. Apply folder boost (after RRF, before graph boost)
      fusedResults = this.folderBoostCalculator.applyBoosts(fusedResults);
      logInfo("Folder boost applied to search results");

      // 10. Apply graph boost (analyzes connections within top results)
      fusedResults = this.graphBoostCalculator.applyBoost(fusedResults);
      logInfo("Graph boost applied to search results");

      // CRITICAL: Re-sort after boosts to maintain correct order
      // Boosts modify scores but don't re-sort, which can lead to incorrect normalization
      fusedResults.sort((a, b) => b.score - a.score);
      logInfo("Results re-sorted after boosts");

      // 10. Apply score normalization to prevent auto-1.0
      // Log scores before normalization for debugging
      if (fusedResults.length > 0) {
        const preNormScores = fusedResults.slice(0, 5).map((r) => ({
          id: r.id.split("/").pop(),
          score: r.score.toFixed(4),
        }));
        logInfo("Pre-normalization scores (top 5):", preNormScores);
      }

      fusedResults = this.scoreNormalizer.normalize(fusedResults);

      // Log scores after normalization
      if (fusedResults.length > 0) {
        const postNormScores = fusedResults.slice(0, 5).map((r) => ({
          id: r.id.split("/").pop(),
          score: r.score.toFixed(4),
        }));
        logInfo("Post-normalization scores (top 5):", postNormScores);
      }

      logInfo("Score normalization applied (min-max)");

      // 11. Clean up full-text index to free memory
      logInfo("SearchCore: About to clear full-text engine");
      const clearStartTime = Date.now();
      this.fullTextEngine.clear();
      const clearTime = Date.now() - clearStartTime;
      logInfo(`SearchCore: Full-text engine cleared in ${clearTime}ms`);

      // 12. Return top K results
      const finalResults = fusedResults.slice(0, maxResults);

      // Log results in an inspectable format
      if (finalResults.length > 0) {
        const resultsForLogging = finalResults.map((result) => {
          const file = this.app.vault.getAbstractFileByPath(result.id);
          return {
            title: file?.name || result.id,
            path: result.id,
            score: parseFloat(result.score.toFixed(4)),
            engine: result.engine,
          };
        });
        logInfo(`Final results: ${finalResults.length} documents (after RRF)`);
        // Log as an array object for better inspection in console
        logInfo("Search results:", resultsForLogging);
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

  /**
   * Execute lexical search with full-text index
   * @param candidates - Candidate documents to index
   * @param queries - Search queries
   * @param salientTerms - Salient terms for boosting
   * @param maxResults - Maximum number of results
   * @returns Ranked list of documents from lexical search
   */
  private async executeLexicalSearch(
    candidates: string[],
    queries: string[],
    salientTerms: string[],
    maxResults: number
  ): Promise<NoteIdRank[]> {
    try {
      // Build ephemeral full-text index
      logInfo(`executeLexicalSearch: Starting with ${candidates.length} candidates`);
      const buildStartTime = Date.now();
      const indexed = await this.fullTextEngine.buildFromCandidates(candidates);
      const buildTime = Date.now() - buildStartTime;
      logInfo(`Full-text index: Built with ${indexed} documents in ${buildTime}ms`);

      // Search the index
      const searchStartTime = Date.now();
      const results = this.fullTextEngine.search(
        queries,
        maxResults * FULLTEXT_RESULT_MULTIPLIER,
        salientTerms
      );
      const searchTime = Date.now() - searchStartTime;
      logInfo(
        `Full-text search: Found ${results.length} results in ${searchTime}ms (using ${queries.length} search inputs)`
      );
      return results;
    } catch (error) {
      logError("Full-text search failed", error);
      return [];
    }
  }

  /**
   * Execute semantic search using embeddings
   * @param candidates - Candidate documents to search within
   * @param allFullTextQueries - Base queries for semantic search
   * @param originalQuery - Original user query for HyDE generation
   * @param candidateLimit - Maximum number of candidates
   * @returns Ranked list of documents from semantic search
   */
  private async executeSemanticSearch(
    candidates: string[],
    allFullTextQueries: string[],
    originalQuery: string,
    candidateLimit: number
  ): Promise<NoteIdRank[]> {
    try {
      const index = MemoryIndexManager.getInstance(this.app);
      const topK = Math.min(candidateLimit, DEFAULT_SEMANTIC_TOP_K_LIMIT);

      // Generate HyDE document for semantic diversity
      const hydeDoc = await this.generateHyDE(originalQuery);

      // Build search queries: HyDE (if available) + original variants
      const semanticQueries = hydeDoc ? [hydeDoc, ...allFullTextQueries] : allFullTextQueries;

      // Pass the same candidates array to limit semantic search to the same subset
      const semanticHits = await index.search(semanticQueries, topK, candidates);
      const results = semanticHits.map(this.mapSemanticHit);

      logInfo(
        `Semantic search: Found ${results.length} results (restricted to ${candidates.length} candidates)`
      );
      return results;
    } catch (error) {
      logInfo("SearchCore: Semantic retrieval failed", error as any);
      return [];
    }
  }

  /**
   * Map semantic search hit to NoteIdRank format
   * @param hit - Semantic search hit
   * @returns NoteIdRank with explanation
   */
  private mapSemanticHit = (hit: any): NoteIdRank => ({
    id: hit.id,
    score: hit.score,
    engine: "semantic" as const,
    explanation: {
      semanticScore: hit.score,
      baseScore: hit.score,
      finalScore: hit.score,
    },
  });

  /**
   * Generate a hypothetical document using HyDE (Hypothetical Document Embeddings)
   * Creates a synthetic answer to help find semantically similar documents
   */
  private async generateHyDE(query: string): Promise<string | null> {
    try {
      // Get chat model if available
      if (!this.getChatModel) {
        return null;
      }

      const chatModel = await this.getChatModel();
      if (!chatModel) {
        return null;
      }

      // Simple prompt for pure hypothetical generation
      const prompt = `Write a brief, informative passage (2-3 sentences) that directly answers this question. Use specific details and terminology that would appear in a comprehensive answer.

Question: ${query}

Answer:`;

      // Generate with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LLM_GENERATION_TIMEOUT_MS);

      const response = await chatModel.invoke(prompt, { signal: controller.signal });
      clearTimeout(timeoutId);

      // Extract string content from the response
      let hydeDoc: string | null = null;
      if (typeof response.content === "string") {
        hydeDoc = response.content;
      } else if (response.content && typeof response.content === "object") {
        // Handle AIMessage or complex content structure
        hydeDoc = String(response.content);
      }

      if (hydeDoc) {
        logInfo(`HyDE generated: ${hydeDoc.slice(0, 100)}...`);
      }
      return hydeDoc;
    } catch (error: any) {
      if (error?.name === "AbortError") {
        logInfo(`HyDE generation timed out (${LLM_GENERATION_TIMEOUT_MS / 1000}s limit)`);
      } else {
        logInfo(`HyDE generation skipped: ${error?.message || "Unknown error"}`);
      }
      return null;
    }
  }
}
