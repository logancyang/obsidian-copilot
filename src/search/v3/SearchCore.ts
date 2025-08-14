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
const LLM_GENERATION_TIMEOUT_MS = 4000;

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
    this.graphBoostCalculator = new GraphBoostCalculator(app);
    this.scoreNormalizer = new ScoreNormalizer({
      method: "zscore-tanh",
      tanhScale: 2.5,
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

      // 5. Build ephemeral full-text index
      const indexed = await this.fullTextEngine.buildFromCandidates(candidates);

      logInfo(`Full-text index: Built with ${indexed} documents`);

      // 6. Search full-text index with both query variants AND salient terms
      // This hybrid approach maximizes both precision (from phrases) and recall (from terms)
      const allFullTextQueries = [...queries, ...salientTerms];
      // Pass salient terms as low-weight terms
      const fullTextResults = this.fullTextEngine.search(
        allFullTextQueries,
        maxResults * 2,
        salientTerms
      );

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

      // 7. Optional semantic retrieval (vector-only, in-memory JSONL-backed index)
      let semanticResults: NoteIdRank[] = [];
      if (enableSemantic) {
        try {
          const index = MemoryIndexManager.getInstance(this.app);
          const topK = Math.min(candidateLimit, 200);

          // Generate HyDE document for semantic diversity
          const hydeDoc = await this.generateHyDE(query);

          // Build search queries: original variants + HyDE if available
          const semanticQueries = [...allFullTextQueries];
          if (hydeDoc) {
            // Add HyDE document as the first query for higher weight
            semanticQueries.unshift(hydeDoc);
          }

          // Pass the same candidates array to limit semantic search to the same subset
          const hits = await index.search(semanticQueries, topK, candidates);
          semanticResults = hits.map((h) => ({ id: h.id, score: h.score, engine: "semantic" }));

          logInfo(
            `Semantic search: Found ${semanticResults.length} results (restricted to ${candidates.length} candidates)`
          );
        } catch (error) {
          logInfo("SearchCore: Semantic retrieval failed", error as any);
        }
      }

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

      // 9. Apply folder and graph boosts (after RRF, before final selection)
      // Both boosts are applied in sequence as ranking adjustments
      fusedResults = this.folderBoostCalculator.applyBoosts(fusedResults);

      this.graphBoostCalculator.setConfig({
        enabled: true,
        candidateConnectionWeight: 0.3,
      });
      fusedResults = this.graphBoostCalculator.applyBoosts(fusedResults);
      logInfo("Folder and graph boosts applied to search results");

      // 10. Apply score normalization (z-score + tanh) to prevent auto-1.0
      fusedResults = this.scoreNormalizer.normalize(fusedResults);
      logInfo("Score normalization applied (z-score + tanh)");

      // 11. Clean up full-text index to free memory
      this.fullTextEngine.clear();

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
