import { logError, logInfo } from "@/logger";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { App } from "obsidian";
import { FullTextEngine } from "./engines/FullTextEngine";
import { GraphExpander } from "./expanders/GraphExpander";
import { NoteIdRank, SearchOptions } from "./interfaces";
import { MemoryIndexManager } from "./MemoryIndexManager";
import { QueryExpander } from "./QueryExpander";
import { GrepScanner } from "./scanners/GrepScanner";
import { weightedRRF } from "./utils/RRF";

// LLM timeout for query expansion and HyDE generation
const LLM_GENERATION_TIMEOUT_MS = 4000;

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
      timeout: LLM_GENERATION_TIMEOUT_MS,
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
    const semanticWeight = Math.min(Math.max(0, options.semanticWeight || 1.5), 10);
    const candidateLimit = Math.min(Math.max(10, options.candidateLimit || 500), 1000);
    const graphHops = Math.min(Math.max(1, options.graphHops || 1), 3);
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

          const hits = await index.search(semanticQueries, topK, candidates);
          semanticResults = hits.map((h) => ({ id: h.id, score: h.score, engine: "semantic" }));
        } catch (error) {
          logInfo("SearchCore: Semantic retrieval failed", error as any);
        }
      }

      // 8. Rank grep hits by evidence quality before fusion (path/content × phrase/term)
      const rankedGrep = await this.rankGrepHits(allSearchStrings, grepHits.slice(0, 100));
      const grepPrior: NoteIdRank[] = rankedGrep.slice(0, 50).map((id, idx) => ({
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
          grepPrior: 0.2,
        },
        k: rrfK,
      });

      // 10. Clean up full-text index to free memory
      this.fullTextEngine.clear();

      // 11. Return top K results
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

      const hydeDoc = response.content?.toString() || null;
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

  /**
   * Rank grep hits by evidence strength using path/content and phrase/term categories
   */
  private async rankGrepHits(queries: string[], hits: string[]): Promise<string[]> {
    const phraseQueries = queries.filter((q) => q.trim().includes(" "));
    const termQueries = queries.filter((q) => !q.trim().includes(" "));

    const scored: Array<{ id: string; score: number }> = [];

    for (const id of hits) {
      let score = 0;
      try {
        const file = this.app.vault.getAbstractFileByPath(id);
        const pathLower = id.toLowerCase();
        const contentLower = file
          ? (await this.app.vault.cachedRead(file as any)).toLowerCase()
          : "";

        // Prefer phrase matches
        let pathPhrase = 0;
        let contentPhrase = 0;
        for (const pq of phraseQueries) {
          const p = pq.toLowerCase();
          if (pathLower.includes(p)) pathPhrase++;
          if (contentLower.includes(p)) contentPhrase++;
        }

        // Term matches
        let pathTerm = 0;
        let contentTerm = 0;
        const distinctMatched = new Set<string>();
        for (const tq of termQueries) {
          const t = tq.toLowerCase();
          if (pathLower.includes(t)) {
            pathTerm++;
            distinctMatched.add(t);
          } else if (contentLower.includes(t)) {
            contentTerm++;
            distinctMatched.add(t);
          }
        }

        // Compute raw evidence score
        const raw =
          4 * pathPhrase +
          3 * contentPhrase +
          2 * pathTerm +
          1 * contentTerm +
          0.5 * distinctMatched.size;
        // Use tanh for natural 0-1 normalization with soft saturation
        score = Math.tanh(raw / 4);
      } catch {
        score = 0;
      }
      scored.push({ id, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.id);
  }
}
