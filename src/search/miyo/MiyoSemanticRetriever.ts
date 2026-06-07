import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App } from "obsidian";
import { logInfo, logWarn } from "@/logger";
import { MiyoClient, MiyoSearchFilter, MiyoSearchResult } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl, getMiyoFolderName, getVaultRelativeMiyoPath } from "@/miyo/miyoUtils";
import { createCopilotPatternFilter, hasActiveCopilotPatterns } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";
import { RETURN_ALL_LIMIT } from "@/search/v3/SearchCore";

/** Number of chunks to return when the caller does not request a specific limit. */
const DEFAULT_FINAL_K = 20;

type MiyoSemanticRetrieverOptions = {
  minSimilarityScore?: number;
  maxK: number;
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll?: boolean;
  useRerankerThreshold?: number;
};

/**
 * Semantic retriever that delegates hybrid search to Miyo.
 */
export class MiyoSemanticRetriever extends BaseRetriever {
  public lc_namespace = ["miyo_semantic_retriever"];

  private client: MiyoClient;
  private readonly returnAll: boolean;
  /** Maximum number of chunks returned after inclusion/exclusion filtering. */
  private readonly finalK: number;
  private readonly minSimilarityScore: number;

  /**
   * Create a new Miyo semantic retriever.
   *
   * @param app - Obsidian application instance.
   * @param options - Retriever options.
   */
  constructor(
    private app: App,
    private options: MiyoSemanticRetrieverOptions
  ) {
    super();
    this.client = new MiyoClient();
    this.returnAll = Boolean(options.returnAll);
    this.finalK = options.maxK > 0 ? options.maxK : DEFAULT_FINAL_K;
    this.minSimilarityScore = options.minSimilarityScore ?? 0.1;
  }

  /**
   * Retrieve relevant documents by querying Miyo semantic search only.
   * Path/title/tag reads are handled upstream by FilterRetriever orchestration.
   *
   * @param query - User query string.
   * @param _config - Optional LangChain callback configuration.
   * @returns Array of relevant Documents.
   */
  public async getRelevantDocuments(
    query: string,
    _config?: BaseCallbackConfig
  ): Promise<Document[]> {
    const searchChunks = await this.searchMiyo(query);
    const dedupedChunks = this.deduplicateResults(searchChunks);
    const allowedChunks = this.filterByCopilotPatterns(dedupedChunks);
    const limitedChunks = allowedChunks.slice(0, this.finalK);

    if (getSettings().debug) {
      this.logDebugInfo(query, searchChunks, limitedChunks);
    }

    return limitedChunks;
  }

  /**
   * Filter chunks by Copilot's QA inclusion/exclusion rules so Miyo results
   * honor the same scope as locally-indexed search.
   *
   * @param chunks - Deduplicated chunks from Miyo.
   * @returns Chunks whose source path passes the inclusion/exclusion rules.
   */
  private filterByCopilotPatterns(chunks: Document[]): Document[] {
    const isAllowed = createCopilotPatternFilter(this.app);
    const allowed: Document[] = [];
    const excludedPaths: string[] = [];
    for (const chunk of chunks) {
      const path = chunk.metadata.path as string;
      if (isAllowed(path)) {
        allowed.push(chunk);
      } else {
        excludedPaths.push(path);
      }
    }

    if (getSettings().debug) {
      const uniqueExcluded = Array.from(new Set(excludedPaths));
      logInfo(
        `MiyoSemanticRetriever: inclusion/exclusion rules kept ${allowed.length}/${chunks.length} chunks` +
          (uniqueExcluded.length > 0 ? `; excluded ${uniqueExcluded.join(", ")}` : "")
      );
    }

    return allowed;
  }

  /**
   * Fetch Miyo results for the given query.
   *
   * @param query - User query.
   * @returns Array of Miyo search documents.
   */
  private async searchMiyo(query: string): Promise<Document[]> {
    try {
      const baseUrl = await this.client.resolveBaseUrl(getMiyoCustomUrl(getSettings()));
      // Over-fetch candidates only when inclusion/exclusion filtering can drop
      // results (or the caller wants everything), so filtering still leaves
      // enough chunks to fill finalK and the set is capped afterwards. Without
      // an active filter, bound the request to finalK so default searches don't
      // transfer up to RETURN_ALL_LIMIT chunks for no filtering benefit.
      const limit = this.returnAll || hasActiveCopilotPatterns() ? RETURN_ALL_LIMIT : this.finalK;
      const filters = this.buildSearchFilters();
      if (getSettings().debug) {
        logInfo("MiyoSemanticRetriever: search params:", {
          baseUrl,
          limit,
          finalK: this.finalK,
          minSimilarityScore: this.minSimilarityScore,
          returnAll: this.returnAll,
          filters,
        });
      }
      const folderName = getSettings().miyoSearchAll ? undefined : getMiyoFolderName(this.app);
      const response = await this.client.search(baseUrl, folderName, query, limit, filters);

      const rawResults = response.results || [];
      const filteredResults = rawResults.filter((result) => this.isScoreAboveThreshold(result));

      if (getSettings().debug) {
        logInfo(
          `MiyoSemanticRetriever: received ${rawResults.length} results, ${filteredResults.length} after threshold`
        );
      }

      return filteredResults.map((result) => this.toDocument(result));
    } catch (error) {
      logWarn(`MiyoSemanticRetriever: search failed: ${error}`);
      return [];
    }
  }

  /**
   * Build optional Miyo search filters for time range queries.
   *
   * @returns Array of filters when time range is specified, otherwise undefined.
   */
  private buildSearchFilters(): MiyoSearchFilter[] | undefined {
    if (!this.options.timeRange) {
      return undefined;
    }

    const { startTime, endTime } = this.options.timeRange;
    return [
      {
        field: "mtime",
        gte: startTime,
        lte: endTime,
      },
    ];
  }

  /**
   * Convert Miyo search results to LangChain Documents.
   *
   * @param result - Miyo search result item.
   * @returns LangChain Document instance.
   */
  private toDocument(result: MiyoSearchResult): Document {
    const relativePath = getVaultRelativeMiyoPath(this.app, result.path);
    const metadata = result.metadata ?? {};
    const chunkId =
      metadata.chunkId ||
      (result.chunk_index !== undefined ? `${relativePath}#${result.chunk_index}` : undefined);

    const score = typeof result.score === "number" ? result.score.toFixed(2) : "?";
    return new Document({
      pageContent: result.chunk_text ?? "",
      metadata: {
        ...metadata,
        score: result.score,
        explanation: `miyo ${score}`,
        path: relativePath,
        mtime: result.mtime,
        ctime: result.ctime,
        title: result.title ?? "",
        id: result.id,
        embeddingModel: result.embedding_model,
        tags: result.tags ?? [],
        extension: result.extension,
        created_at: result.created_at,
        nchars: result.nchars,
        chunkId,
      },
    });
  }

  /**
   * Determine whether a search result meets the score threshold.
   *
   * @param result - Miyo search result item.
   * @returns True if the score passes the threshold.
   */
  private isScoreAboveThreshold(result: MiyoSearchResult): boolean {
    const score = result.score;
    if (typeof score !== "number" || Number.isNaN(score)) {
      return true;
    }
    return score >= this.minSimilarityScore;
  }

  /**
   * Deduplicate semantic results by stable document identity.
   *
   * @param semanticChunks - Miyo search results.
   * @returns Deduplicated semantic Documents.
   */
  private deduplicateResults(semanticChunks: Document[]): Document[] {
    const combined = new Map<string, Document>();
    const insert = (doc: Document) => {
      const key = this.getDocumentKey(doc);
      if (!combined.has(key)) {
        combined.set(key, doc);
      }
    };

    semanticChunks.forEach(insert);

    if (getSettings().debug && combined.size !== semanticChunks.length) {
      logInfo(
        `MiyoSemanticRetriever: deduplicated semantic results from ${semanticChunks.length} to ${combined.size}`
      );
    }

    return Array.from(combined.values());
  }

  /**
   * Log debug information to mirror Orama hybrid retriever output.
   *
   * @param query - User query string.
   * @param semanticChunks - Semantic search chunks.
   * @param dedupedChunks - Deduplicated results.
   */
  private logDebugInfo(query: string, semanticChunks: Document[], dedupedChunks: Document[]): void {
    logInfo("*** MIYO SEMANTIC RETRIEVER DEBUG INFO: ***");
    logInfo("Query: ", query);
    logInfo("Semantic Chunks: ", semanticChunks);
    logInfo("Deduplicated Chunks: ", dedupedChunks);

    const maxSemanticScore = semanticChunks.reduce((max, chunk) => {
      const score = chunk.metadata?.score;
      const isValidScore = typeof score === "number" && !Number.isNaN(score);
      return isValidScore ? Math.max(max, score) : max;
    }, 0);

    logInfo("Max Miyo Score: ", maxSemanticScore);
  }

  /**
   * Compute a stable key for a document to support deduplication.
   *
   * @param doc - Document to key.
   * @returns Stable key string.
   */
  private getDocumentKey(doc: Document): string {
    const metadata = doc.metadata ?? {};
    return (metadata.chunkId ||
      metadata.path ||
      metadata.id ||
      metadata.title ||
      `${doc.pageContent.slice(0, 64)}::${doc.pageContent.length}`) as string;
  }
}
