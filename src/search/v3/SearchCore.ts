import { logError, logInfo, logWarn } from "@/logger";
import { TimeoutError } from "@/error";
import { withTimeout } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { App } from "obsidian";
import { ChunkManager } from "./chunks";
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
    const maxResults = Math.min(Math.max(1, options.maxResults || 30), 100);
    const enableSemantic = Boolean(options.enableSemantic);
    const semanticWeight = Math.min(Math.max(0, options.semanticWeight ?? 0.6), 1); // Default 60% semantic
    const candidateLimit = Math.min(Math.max(10, options.candidateLimit || 500), 1000);
    const rrfK = Math.min(Math.max(1, options.rrfK || 60), 100);
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

      // Only log details if expansion produced significant variants
      if (queries.length > 1 || salientTerms.length > 3 || expanded.expandedTerms.length > 0) {
        logInfo(
          `Query expansion: ${queries.length} variants, ${salientTerms.length} scoring terms (from original), ${expanded.expandedTerms.length} recall terms (LLM-generated)`
        );
      }

      // 2. GREP for initial candidates (use all terms for maximum recall)
      const recallQueries = [...queries, ...expanded.expandedTerms, ...salientTerms];
      const grepHits = await this.grepScanner.batchCachedReadGrep(recallQueries, 200);

      // 3. Limit candidates (no graph expansion - we use graph for boost only)
      const candidates = grepHits.slice(0, candidateLimit);

      // Log candidate info concisely
      logInfo(`SearchCore: ${candidates.length} candidates (from ${grepHits.length} grep hits)`);

      // 5, 6 & 7. Run lexical and semantic searches (skip unused pipelines for performance)
      const skipLexical = enableSemantic && semanticWeight >= 1.0; // 100% semantic
      const skipSemantic = !enableSemantic || semanticWeight <= 0.0; // 0% semantic or disabled

      if (skipLexical) {
        logInfo("SearchCore: Skipping lexical search (100% semantic weight)");
      }
      if (skipSemantic && enableSemantic) {
        logInfo("SearchCore: Skipping semantic search (0% semantic weight)");
      }

      const [lexicalResults, semanticResults] = await Promise.all([
        skipLexical
          ? Promise.resolve([])
          : this.executeLexicalSearch(
              candidates,
              recallQueries,
              salientTerms,
              maxResults,
              expanded.originalQuery
            ),
        skipSemantic ? Promise.resolve([]) : this.executeSemanticSearch(query, candidateLimit),
      ]);

      // 8. Apply boosts to lexical results BEFORE RRF fusion (if enabled)
      // This ensures boosts are applied as lexical reranking
      let fullTextResults = lexicalResults;
      if (enableLexicalBoosts && !skipLexical) {
        fullTextResults = this.folderBoostCalculator.applyBoosts(fullTextResults);
        fullTextResults = this.graphBoostCalculator.applyBoost(fullTextResults);
      }

      // 9. Fusion: Skip RRF when using single pipeline (100% weight)
      let fusedResults: NoteIdRank[];
      if (skipLexical) {
        // 100% semantic: use semantic results directly
        fusedResults = semanticResults.slice(0, maxResults);
        logInfo("SearchCore: Using pure semantic results (no fusion needed)");
      } else if (skipSemantic) {
        // 100% lexical: use lexical results directly
        fusedResults = fullTextResults.slice(0, maxResults);
        logInfo("SearchCore: Using pure lexical results (no fusion needed)");
      } else {
        // Weighted RRF with normalized weights (boosts already applied to lexical)
        // semanticWeight now represents the percentage (0-1) for semantic
        // lexical gets the remainder to ensure weights sum to 1.0
        // Both lexical and semantic now return chunk IDs so no normalization needed
        fusedResults = weightedRRF({
          lexical: fullTextResults,
          semantic: semanticResults,
          weights: {
            lexical: 1.0 - semanticWeight,
            semantic: semanticWeight,
          },
          k: rrfK,
        });
      }

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
   * Execute semantic search using embeddings (searches entire index independently)
   * @param originalQuery - Original user query (used for embeddings and HyDE)
   * @param candidateLimit - Maximum number of results to return
   * @returns Ranked list of documents from semantic search
   */
  private async executeSemanticSearch(
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

      // Search entire semantic index without candidate restrictions - semantic should be independent
      const semanticHits = await index.search(semanticQueries, topK);
      const results = semanticHits.map(this.mapSemanticHit);

      logInfo(
        `Semantic search: Found ${results.length} results (unrestricted - searched entire index)`
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

      const response = await withTimeout(
        (signal) => chatModel.invoke(prompt, { signal }),
        LLM_GENERATION_TIMEOUT_MS,
        "HyDE generation"
      );

      const hydeDoc = this.extractContent(response);
      if (hydeDoc) {
        logInfo(`HyDE generated: ${hydeDoc.slice(0, 100)}...`);
      }
      return hydeDoc;
    } catch (error: any) {
      if (error instanceof TimeoutError) {
        logInfo(`HyDE generation timed out (${LLM_GENERATION_TIMEOUT_MS / 1000}s limit)`);
      } else {
        logInfo(`HyDE generation skipped: ${error?.message || "Unknown error"}`);
      }
      return null;
    }
  }

  /**
   * Extract string content from LLM response
   */
  private extractContent(response: any): string | null {
    if (typeof response.content === "string") {
      return response.content;
    } else if (response.content && typeof response.content === "object") {
      // Handle AIMessage or complex content structure
      return String(response.content);
    }
    return null;
  }
}
