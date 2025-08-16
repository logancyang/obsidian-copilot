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
    this.folderBoostCalculator = new FolderBoostCalculator(app);
    this.graphBoostCalculator = new GraphBoostCalculator(app, {
      enabled: true,
      maxCandidates: 10, // Absolute ceiling
      semanticSimilarityThreshold: 0.75, // Only boost results with 75%+ similarity
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
      // Log search start with minimal verbosity
      logInfo(`SearchCore: Searching for "${query}"`);

      // 1. Expand query into variants and terms
      const expanded = await this.queryExpander.expand(query);
      const queries = expanded.queries;
      // Combine expanded salient terms with any provided salient terms
      const salientTerms = options.salientTerms
        ? [...new Set([...expanded.salientTerms, ...options.salientTerms])]
        : expanded.salientTerms;

      // Only log details if expansion produced significant variants
      if (queries.length > 1 || salientTerms.length > 3) {
        logInfo(`Query expansion: ${queries.length} variants, ${salientTerms.length} terms`);
      }

      // 2. GREP for initial candidates (use both queries and terms)
      const allSearchStrings = [...queries, ...salientTerms];
      const grepHits = await this.grepScanner.batchCachedReadGrep(allSearchStrings, 200);

      // 3. Limit candidates (no graph expansion - we use graph for boost only)
      const candidates = grepHits.slice(0, candidateLimit);

      // Log candidate info concisely
      logInfo(`SearchCore: ${candidates.length} candidates (from ${grepHits.length} grep hits)`);

      // Prepare queries for recall phase (all queries + terms)
      const recallQueries = [...queries, ...salientTerms];

      // 5, 6 & 7. Run lexical and semantic searches in parallel
      const [fullTextResults, semanticResults] = await Promise.all([
        this.executeLexicalSearch(
          candidates,
          recallQueries,
          salientTerms,
          maxResults,
          expanded.originalQuery
        ),
        enableSemantic
          ? this.executeSemanticSearch(candidates, query, candidateLimit)
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

      // 10. Apply graph boost (analyzes connections within top results)
      fusedResults = this.graphBoostCalculator.applyBoost(fusedResults);

      // CRITICAL: Re-sort after boosts to maintain correct order
      // Boosts modify scores but don't re-sort, which can lead to incorrect normalization
      fusedResults.sort((a, b) => b.score - a.score);

      // 10. Apply score normalization to prevent auto-1.0
      fusedResults = this.scoreNormalizer.normalize(fusedResults);

      // 11. Clean up full-text index to free memory
      this.fullTextEngine.clear();

      // 12. Return top K results
      const finalResults = fusedResults.slice(0, maxResults);

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
    originalQuery?: string
  ): Promise<NoteIdRank[]> {
    try {
      // Build ephemeral full-text index
      const buildStartTime = Date.now();
      const indexed = await this.fullTextEngine.buildFromCandidates(candidates);
      const buildTime = Date.now() - buildStartTime;

      // Search the index
      const searchStartTime = Date.now();
      const results = this.fullTextEngine.search(
        recallQueries,
        maxResults * FULLTEXT_RESULT_MULTIPLIER,
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

  /**
   * Execute semantic search using embeddings
   * @param candidates - Candidate documents to search within
   * @param originalQuery - Original user query (used for embeddings and HyDE)
   * @param candidateLimit - Maximum number of candidates
   * @returns Ranked list of documents from semantic search
   */
  private async executeSemanticSearch(
    candidates: string[],
    originalQuery: string,
    candidateLimit: number
  ): Promise<NoteIdRank[]> {
    try {
      const index = MemoryIndexManager.getInstance(this.app);
      const topK = Math.min(candidateLimit, DEFAULT_SEMANTIC_TOP_K_LIMIT);

      // Generate HyDE document for semantic diversity
      const hydeDoc = await this.generateHyDE(originalQuery);

      // Build search queries: HyDE (if available) + original query only
      // We only use the original query for semantic search, not expanded queries
      const semanticQueries = hydeDoc ? [hydeDoc, originalQuery] : [originalQuery];

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
