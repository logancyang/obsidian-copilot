import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App } from "obsidian";
import { logInfo, logWarn } from "@/logger";
import {
  MiyoClient,
  MiyoRequestError,
  MiyoSearchFilter,
  MiyoSearchResult,
} from "@/miyo/MiyoClient";
import {
  getMiyoCustomUrl,
  getMiyoFolderName,
  getVaultRelativeMiyoPath,
  isCurrentVaultMiyoPath,
} from "@/miyo/miyoUtils";
import { createCopilotPatternFilter } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";

const DEFAULT_FINAL_K = 20;

const MIYO_SEARCH_CANDIDATE_LIMIT = 1000;

type MiyoSemanticRetrieverOptions = {
  minSimilarityScore?: number;
  maxK: number;
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll?: boolean;
  useRerankerThreshold?: number;
};

export class MiyoSemanticRetriever extends BaseRetriever {
  public lc_namespace = ["miyo_semantic_retriever"];

  private client: MiyoClient;
  private readonly returnAll: boolean;
  private readonly finalK: number;
  private readonly minSimilarityScore: number;

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

  private filterByCopilotPatterns(chunks: Document[]): Document[] {
    const isAllowed = createCopilotPatternFilter(this.app);
    const allowed: Document[] = [];
    const excludedPaths: string[] = [];
    for (const chunk of chunks) {
      const path = chunk.metadata.path as string;
      if (chunk.metadata.fromCurrentVault === false) {
        allowed.push(chunk);
        continue;
      }
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

  private async searchMiyo(query: string): Promise<Document[]> {
    const searchAll = getSettings().miyoSearchAll;
    const folderName = searchAll ? undefined : getMiyoFolderName(this.app);
    try {
      const baseUrl = await this.client.resolveBaseUrl(getMiyoCustomUrl(getSettings()));
      // Always fetch Miyo's full exposed candidate pool. Copilot no longer
      // defines Miyo's exclusion scope beyond initial registration, so it
      // cannot know whether a ranked prefix is content its local QA filter is
      // about to drop — chat notes under a Copilot root alone can fill a
      // narrower window. Miyo exposes no pagination and clamps this endpoint at
      // 1,000, so a wider request is the only way to keep eligible matches
      // reachable.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/284
      const filters = this.buildSearchFilters();
      if (getSettings().debug) {
        logInfo("MiyoSemanticRetriever: search params:", {
          baseUrl,
          limit: MIYO_SEARCH_CANDIDATE_LIMIT,
          finalK: this.finalK,
          minSimilarityScore: this.minSimilarityScore,
          returnAll: this.returnAll,
          filters,
        });
      }
      const response = await this.client.search(
        baseUrl,
        folderName,
        query,
        MIYO_SEARCH_CANDIDATE_LIMIT,
        filters
      );

      const rawResults = response.results || [];
      const filteredResults = rawResults.filter((result) => this.isScoreAboveThreshold(result));

      if (getSettings().debug) {
        logInfo(
          `MiyoSemanticRetriever: received ${rawResults.length} results, ${filteredResults.length} after threshold`
        );
      }

      return filteredResults.map((result) => this.toDocument(result, searchAll));
    } catch (error) {
      logWarn(`MiyoSemanticRetriever: search failed: ${error}`);
      // An empty result means a healthy search found no matches. A failed Miyo
      // request must remain distinguishable so Quick Chat can show the tool
      // failure instead of answering as though it searched the vault.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/356
      // Only a folder-scoped request proves anything about this vault. An
      // unrestricted search omits the folder, so its 404 describes the route,
      // not the registration, and must not send the user to register again.
      if (folderName !== undefined && error instanceof MiyoRequestError && error.status === 404) {
        throw new Error(
          "This vault is not registered with Miyo. Register it in Miyo, then retry vault search.",
          { cause: error }
        );
      }
      throw new Error("Miyo is unavailable. Open Miyo, then retry vault search.", {
        cause: error,
      });
    }
  }

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

  private toDocument(result: MiyoSearchResult, searchAll: boolean): Document {
    const relativePath = getVaultRelativeMiyoPath(this.app, result.path);
    const fromCurrentVault = !searchAll || isCurrentVaultMiyoPath(this.app, result.path);
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
        fromCurrentVault,
      },
    });
  }

  private isScoreAboveThreshold(result: MiyoSearchResult): boolean {
    const score = result.score;
    if (typeof score !== "number" || Number.isNaN(score)) {
      return true;
    }
    return score >= this.minSimilarityScore;
  }

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

  private getDocumentKey(doc: Document): string {
    const metadata = doc.metadata ?? {};
    return (metadata.chunkId ||
      metadata.path ||
      metadata.id ||
      metadata.title ||
      `${doc.pageContent.slice(0, 64)}::${doc.pageContent.length}`) as string;
  }
}
