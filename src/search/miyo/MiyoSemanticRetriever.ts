import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App, TFile } from "obsidian";
import { logInfo, logWarn } from "@/logger";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { MiyoClient, MiyoEmbeddingPayload, MiyoSearchResult } from "@/miyo/MiyoClient";
import { getMiyoCollectionName } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import VectorStoreManager from "@/search/vectorStoreManager";
import { RETURN_ALL_LIMIT } from "@/search/v3/SearchCore";
import { extractNoteFiles } from "@/utils";

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
  private embeddingsManager: EmbeddingsManager;
  private readonly returnAll: boolean;
  private readonly maxK: number;
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
    this.embeddingsManager = EmbeddingsManager.getInstance();
    this.returnAll = Boolean(options.returnAll);
    this.maxK = Math.max(1, options.maxK);
    this.minSimilarityScore = options.minSimilarityScore ?? 0.1;
  }

  /**
   * Retrieve relevant documents by querying Miyo and merging explicit note chunks.
   *
   * @param query - User query string.
   * @param _config - Optional LangChain callback configuration.
   * @returns Array of relevant Documents.
   */
  public async getRelevantDocuments(
    query: string,
    _config?: BaseCallbackConfig
  ): Promise<Document[]> {
    const explicitChunks = await this.getExplicitChunks(extractNoteFiles(query, this.app.vault));
    const searchChunks = await this.searchMiyo(query);
    const mergedChunks = this.mergeResults(explicitChunks, searchChunks);

    if (getSettings().debug) {
      this.logDebugInfo(query, explicitChunks, searchChunks, mergedChunks);
    }

    return mergedChunks;
  }

  /**
   * Fetch Miyo results for the given query.
   *
   * @param query - User query.
   * @returns Array of Miyo search documents.
   */
  private async searchMiyo(query: string): Promise<Document[]> {
    try {
      const baseUrl = await this.client.resolveBaseUrl(getSettings().selfHostUrl);
      const limit = this.returnAll ? RETURN_ALL_LIMIT : this.maxK;
      const embedding = await this.buildQueryEmbedding(query);
      if (getSettings().debug) {
        logInfo("MiyoSemanticRetriever: search params:", {
          baseUrl,
          limit,
          maxK: this.maxK,
          minSimilarityScore: this.minSimilarityScore,
          returnAll: this.returnAll,
          embeddingModel: embedding?.model,
        });
      }
      const response = await this.client.search(
        baseUrl,
        getMiyoCollectionName(this.app),
        query,
        limit,
        embedding
      );

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
   * Build a query embedding and resolve the embedding model name.
   *
   * @param query - Query text to embed.
   * @returns Embedding vector and model name when available.
   */
  private async buildQueryEmbedding(query: string): Promise<MiyoEmbeddingPayload | undefined> {
    try {
      const embeddingInstance = await this.embeddingsManager.getEmbeddingsAPI();
      const vector = await embeddingInstance.embedQuery(query);
      const model = EmbeddingsManager.getModelName(embeddingInstance);
      return { model, vector };
    } catch (error) {
      logWarn(`MiyoSemanticRetriever: failed to embed query: ${error}`);
      return undefined;
    }
  }

  /**
   * Convert Miyo search results to LangChain Documents.
   *
   * @param result - Miyo search result item.
   * @returns LangChain Document instance.
   */
  private toDocument(result: MiyoSearchResult): Document {
    const metadata = result.metadata ?? {};
    const chunkId =
      metadata.chunkId ||
      (result.chunk_index !== undefined ? `${result.path}#${result.chunk_index}` : undefined);

    return new Document({
      pageContent: result.chunk_text ?? "",
      metadata: {
        ...metadata,
        score: result.score,
        path: result.path,
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
   * Build explicit note chunks for notes referenced in the query.
   *
   * @param noteFiles - Note files referenced in the query.
   * @returns Array of explicit note chunks.
   */
  private async getExplicitChunks(noteFiles: TFile[]): Promise<Document[]> {
    const explicitChunks: Document[] = [];
    for (const noteFile of noteFiles) {
      const docs = await VectorStoreManager.getInstance().getDocumentsByPath(noteFile.path);
      docs.forEach((doc) => {
        explicitChunks.push(
          new Document({
            pageContent: doc.content,
            metadata: {
              ...doc.metadata,
              score: 1,
              path: doc.path,
              mtime: doc.mtime,
              ctime: doc.ctime,
              title: doc.title,
              id: doc.id,
              embeddingModel: doc.embeddingModel,
              tags: doc.tags,
              extension: doc.extension,
              created_at: doc.created_at,
              nchars: doc.nchars,
              chunkId: doc.metadata?.chunkId,
            },
          })
        );
      });
    }
    return explicitChunks;
  }

  /**
   * Merge explicit chunks with semantic results, deduplicating by chunk identity.
   *
   * @param explicitChunks - Explicit note chunks.
   * @param semanticChunks - Miyo search results.
   * @returns Combined list of Documents.
   */
  private mergeResults(explicitChunks: Document[], semanticChunks: Document[]): Document[] {
    const combined = new Map<string, Document>();
    const insert = (doc: Document) => {
      const key = this.getDocumentKey(doc);
      if (!combined.has(key)) {
        combined.set(key, doc);
      }
    };

    explicitChunks.forEach(insert);
    semanticChunks.forEach(insert);

    if (getSettings().debug) {
      logInfo(
        `MiyoSemanticRetriever: merged ${semanticChunks.length} results with ${explicitChunks.length} explicit chunks`
      );
    }

    return Array.from(combined.values());
  }

  /**
   * Log debug information to mirror Orama hybrid retriever output.
   *
   * @param query - User query string.
   * @param explicitChunks - Explicit note chunks.
   * @param semanticChunks - Semantic search chunks.
   * @param mergedChunks - Combined results.
   */
  private logDebugInfo(
    query: string,
    explicitChunks: Document[],
    semanticChunks: Document[],
    mergedChunks: Document[]
  ): void {
    logInfo("*** MIYO SEMANTIC RETRIEVER DEBUG INFO: ***");
    logInfo("Query: ", query);
    logInfo("Explicit Chunks: ", explicitChunks);
    logInfo("Miyo Chunks: ", semanticChunks);
    logInfo("Combined Chunks: ", mergedChunks);

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
    return (
      metadata.chunkId ||
      metadata.path ||
      metadata.id ||
      metadata.title ||
      `${doc.pageContent.slice(0, 64)}::${doc.pageContent.length}`
    );
  }
}
