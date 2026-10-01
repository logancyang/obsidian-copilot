import { LLM_TIMEOUT_MS } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { App } from "obsidian";
import { ChunkManager, getSharedChunkManager } from "./chunks";
import { FullTextEngine } from "./engines/FullTextEngine";
import { NoteIdRank, SearchOptions } from "./interfaces";
import { ExpandedQuery, QueryExpander } from "./QueryExpander";
import { GrepScanner } from "./scanners/GrepScanner";
import { FolderBoostCalculator } from "./scoring/FolderBoostCalculator";
import { GraphBoostCalculator } from "./scoring/GraphBoostCalculator";
import { adaptiveCutoff } from "./scoring/AdaptiveCutoff";
import { ScoreNormalizer } from "./utils/ScoreNormalizer";

const FULLTEXT_RESULT_MULTIPLIER = 3;
export const RETURN_ALL_LIMIT = 100;

export interface RetrieveResult {
  results: NoteIdRank[];
  queryExpansion: ExpandedQuery;
}

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
    this.chunkManager = getSharedChunkManager(app);
    this.fullTextEngine = new FullTextEngine(app, this.chunkManager);
    this.queryExpander = new QueryExpander({
      getChatModel: this.getChatModel,
      maxVariants: 3,
      timeout: LLM_TIMEOUT_MS,
    });
    this.folderBoostCalculator = new FolderBoostCalculator(app);
    this.graphBoostCalculator = new GraphBoostCalculator(app, {
      enabled: true,
      maxCandidates: 20,
      boostStrength: 0.1,
      maxBoostMultiplier: 1.15,
    });
    this.scoreNormalizer = new ScoreNormalizer({
      method: "minmax",
      clipMin: 0.02,
      clipMax: 0.98,
    });
  }

  async retrieve(query: string, options: SearchOptions = {}): Promise<RetrieveResult> {
    const emptyExpansion: ExpandedQuery = {
      queries: [],
      salientTerms: [],
      originalQuery: query || "",
      expandedQueries: [],
    };

    if (!query || typeof query !== "string") {
      logWarn("SearchCore: Invalid query provided");
      return { results: [], queryExpansion: emptyExpansion };
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      logWarn("SearchCore: Empty query provided");
      return { results: [], queryExpansion: emptyExpansion };
    }

    if (trimmedQuery.length > 1000) {
      logWarn("SearchCore: Query too long, truncating");
      query = trimmedQuery.substring(0, 1000);
    } else {
      query = trimmedQuery;
    }

    const returnAll = Boolean(options.returnAll);
    const maxResults = returnAll
      ? RETURN_ALL_LIMIT
      : Math.min(Math.max(1, options.maxResults || 30), 100);
    const candidateLimit = returnAll
      ? RETURN_ALL_LIMIT
      : Math.min(Math.max(10, options.candidateLimit || 200), 1000);
    const enableLexicalBoosts = Boolean(options.enableLexicalBoosts ?? true);

    try {
      logInfo(`SearchCore: Searching for "${query}"`);

      let expanded: ExpandedQuery;
      if (options.preExpandedQuery) {
        logInfo("SearchCore: Using pre-expanded query data (skipping QueryExpander)");
        expanded = {
          queries: options.preExpandedQuery.queries || [query],
          salientTerms: options.preExpandedQuery.salientTerms || [],
          originalQuery: options.preExpandedQuery.originalQuery || query,
          expandedQueries: options.preExpandedQuery.expandedQueries || [],
        };
      } else {
        expanded = await this.queryExpander.expand(query);
      }
      const queries = expanded.queries;
      const salientTerms = options.salientTerms
        ? [...new Set([...expanded.salientTerms, ...options.salientTerms])]
        : expanded.salientTerms;

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
        recallQueries.push(normalized);
      };

      queries.forEach(addRecallTerm);
      salientTerms.forEach(addRecallTerm);

      if (queries.length > 1 || salientTerms.length > 0) {
        logInfo(
          `Query expansion: variants=${JSON.stringify(queries)}, salient=${JSON.stringify(
            salientTerms
          )}`
        );
      }

      const grepLimit = returnAll ? RETURN_ALL_LIMIT : 200;
      const grepHits = await this.grepScanner.batchCachedReadGrep(recallQueries, grepLimit);

      const candidates = grepHits.slice(0, candidateLimit);

      logInfo(`SearchCore: ${candidates.length} candidates (from ${grepHits.length} grep hits)`);

      const lexicalResults = await this.executeLexicalSearch(
        candidates,
        recallQueries,
        salientTerms,
        maxResults,
        expanded.originalQuery,
        returnAll
      );

      let finalResults = lexicalResults;
      if (enableLexicalBoosts) {
        finalResults = this.folderBoostCalculator.applyBoosts(finalResults);
        finalResults = this.graphBoostCalculator.applyBoost(finalResults);
      }

      finalResults = this.scoreNormalizer.normalize(finalResults);

      this.fullTextEngine.clear();

      if (finalResults.length > maxResults) {
        finalResults = selectDiverseTopK(finalResults, maxResults);
      }

      if (finalResults.length > 0) {
        const topResult = this.app.vault.getAbstractFileByPath(finalResults[0].id);
        logInfo(
          `SearchCore: ${finalResults.length} results found (top: ${topResult?.name || finalResults[0].id})`
        );
      } else {
        logInfo("SearchCore: No results found");
      }

      return { results: finalResults, queryExpansion: expanded };
    } catch (error) {
      logError("SearchCore: Retrieval failed", error);

      try {
        const fallbackResults = await this.fallbackSearch(query, maxResults);
        return { results: fallbackResults, queryExpansion: emptyExpansion };
      } catch (fallbackError) {
        logError("SearchCore: Fallback search also failed", fallbackError);
        return { results: [], queryExpansion: emptyExpansion };
      }
    }
  }

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

  private async executeLexicalSearch(
    candidates: string[],
    recallQueries: string[],
    salientTerms: string[],
    maxResults: number,
    originalQuery?: string,
    returnAll: boolean = false
  ): Promise<NoteIdRank[]> {
    try {
      const buildStartTime = Date.now();
      const indexed = await this.fullTextEngine.buildFromCandidates(candidates);
      const buildTime = Date.now() - buildStartTime;

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

function selectDiverseTopK(results: NoteIdRank[], limit: number): NoteIdRank[] {
  if (results.length <= limit) {
    return results;
  }

  return adaptiveCutoff(results, {
    floor: 0,
    ceiling: limit,
    relativeThreshold: 0,
    absoluteMinScore: 0,
    ensureDiversity: true,
  }).results;
}
