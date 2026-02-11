import { logInfo, logWarn } from "@/logger";
import { extractNoteFiles } from "@/utils";
import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App } from "obsidian";

/**
 * Options for configuring the SelfHostRetriever.
 * Compatible with existing retriever options for easy swapping.
 */
export interface SelfHostRetrieverOptions {
  /** Minimum similarity score threshold for results (0-1) */
  minSimilarityScore?: number;
  /** Maximum number of results to return */
  maxK: number;
  /** Additional terms to boost in search */
  salientTerms?: string[];
  /** Optional time range filter */
  timeRange?: { startTime: number; endTime: number };
  /** Weight for text/keyword matching vs semantic (0-1) */
  textWeight?: number;
  /** Return all matching results up to a limit */
  returnAll?: boolean;
  /** Threshold for using reranker */
  useRerankerThreshold?: number;
  /** Tag terms to filter by (server-side tag filtering) */
  tagTerms?: string[];
}

/**
 * Result from the vector search backend.
 */
export interface VectorSearchResult {
  /** Unique identifier for the document/chunk */
  id: string;
  /** Similarity/relevance score (0-1, higher is better) */
  score: number;
  /** The text content */
  content: string;
  /** Document metadata */
  metadata: {
    path: string;
    title?: string;
    tags?: string[];
    mtime?: number;
    ctime?: number;
    chunkIndex?: number;
    [key: string]: unknown;
  };
}

/**
 * Abstract interface for the vector search backend.
 * Implement this interface to connect to Miyo or other vector databases.
 */
export interface VectorSearchBackend {
  /**
   * Search for similar documents/chunks.
   * @param query - The search query (will be embedded by the backend)
   * @param options - Search options
   * @returns Array of search results sorted by relevance
   */
  search(
    query: string,
    options: {
      limit: number;
      minScore?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<VectorSearchResult[]>;

  /**
   * Search using a pre-computed embedding vector.
   * @param embedding - The query embedding vector
   * @param options - Search options
   * @returns Array of search results sorted by relevance
   */
  searchByVector(
    embedding: number[],
    options: {
      limit: number;
      minScore?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<VectorSearchResult[]>;

  /**
   * Check if the backend is available and connected.
   * @returns True if the backend is ready for queries
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the embedding dimension expected by this backend.
   * @returns The dimension of embedding vectors
   */
  getEmbeddingDimension(): number;
}

/**
 * Self-hosted vector search retriever that delegates to an abstract backend.
 * This retriever completely replaces Search v3, Orama, and MergedSemanticRetriever
 * when enabled, providing a unified interface to external vector databases.
 *
 * The backend (e.g., Miyo) is injected via the constructor, keeping the
 * retriever implementation database-agnostic.
 */
export class SelfHostRetriever extends BaseRetriever {
  public lc_namespace = ["self_host_retriever"];

  private backend: VectorSearchBackend;
  private app: App;
  private options: SelfHostRetrieverOptions;

  /**
   * Creates a new SelfHostRetriever.
   * @param app - Obsidian app instance
   * @param backend - The vector search backend implementation
   * @param options - Retriever configuration options
   */
  constructor(app: App, backend: VectorSearchBackend, options: SelfHostRetrieverOptions) {
    super();
    this.app = app;
    this.backend = backend;
    this.options = {
      ...options,
      // Apply defaults for optional fields only
      minSimilarityScore: options.minSimilarityScore ?? 0.01,
      salientTerms: options.salientTerms ?? [],
      returnAll: options.returnAll ?? false,
    };
  }

  /**
   * Main entry point for document retrieval, compatible with LangChain interface.
   * @param query - The search query
   * @param config - Optional callback configuration
   * @returns Array of Document objects with content and metadata
   */
  public async getRelevantDocuments(
    query: string,
    config?: BaseCallbackConfig
  ): Promise<Document[]> {
    try {
      // Check backend availability
      const isAvailable = await this.backend.isAvailable();
      if (!isAvailable) {
        logWarn("SelfHostRetriever: Backend is not available");
        return [];
      }

      // Extract note files mentioned in query (e.g., [[Note Name]])
      const noteFiles = extractNoteFiles(query, this.app.vault);
      const noteTitles = noteFiles.map((file) => file.basename);

      // Combine salient terms with note titles
      const enhancedSalientTerms = [
        ...new Set([...(this.options.salientTerms || []), ...noteTitles]),
      ];

      // Build filter based on options
      const filter = this.buildFilter();

      // Determine result limit
      const limit = this.options.returnAll ? 100 : this.options.maxK;

      // Perform vector search
      const searchResults = await this.backend.search(query, {
        limit,
        minScore: this.options.minSimilarityScore,
        filter,
      });

      logInfo(
        `SelfHostRetriever: Found ${searchResults.length} results for query "${query.substring(0, 50)}..."`
      );

      // Convert to LangChain Document format
      const documents = this.convertToDocuments(searchResults);

      // Apply salient term boosting if terms are provided
      if (enhancedSalientTerms.length > 0) {
        return this.boostBySalientTerms(documents, enhancedSalientTerms);
      }

      return documents;
    } catch (error) {
      logWarn(`SelfHostRetriever: Search failed: ${error}`);
      return [];
    }
  }

  /**
   * Builds a filter object based on retriever options.
   * @returns Filter object for the backend query
   */
  private buildFilter(): Record<string, unknown> | undefined {
    const filter: Record<string, unknown> = {};

    // Time range filter
    if (this.options.timeRange) {
      filter.mtime = {
        gte: this.options.timeRange.startTime,
        lte: this.options.timeRange.endTime,
      };
    }

    // Tag filter
    if (this.options.tagTerms && this.options.tagTerms.length > 0) {
      filter.tags = { containsAny: this.options.tagTerms };
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  /**
   * Converts backend search results to LangChain Document format.
   * @param results - Search results from the backend
   * @returns Array of Document objects
   */
  private convertToDocuments(results: VectorSearchResult[]): Document[] {
    return results.map(
      (result) =>
        new Document({
          pageContent: result.content,
          metadata: {
            ...result.metadata,
            score: result.score,
            rerank_score: result.score,
            id: result.id,
            source: "self_host",
          },
        })
    );
  }

  /**
   * Boosts documents that contain salient terms.
   * @param documents - Documents to potentially boost
   * @param salientTerms - Terms to boost for
   * @returns Re-sorted documents with boosted scores
   */
  private boostBySalientTerms(documents: Document[], salientTerms: string[]): Document[] {
    const SALIENT_BOOST = 1.1;

    const boostedDocs = documents.map((doc) => {
      const content = doc.pageContent.toLowerCase();
      const title = (doc.metadata?.title || "").toLowerCase();

      // Check if any salient term appears in content or title
      const hasMatch = salientTerms.some(
        (term) => content.includes(term.toLowerCase()) || title.includes(term.toLowerCase())
      );

      if (hasMatch) {
        const boostedScore = (doc.metadata?.score || 0) * SALIENT_BOOST;
        return new Document({
          pageContent: doc.pageContent,
          metadata: {
            ...doc.metadata,
            score: boostedScore,
            rerank_score: boostedScore,
            salientBoost: true,
          },
        });
      }

      return doc;
    });

    // Re-sort by boosted scores
    return boostedDocs.sort((a, b) => (b.metadata?.score || 0) - (a.metadata?.score || 0));
  }

  /**
   * Gets the underlying backend instance.
   * Useful for direct backend operations like indexing.
   * @returns The vector search backend
   */
  public getBackend(): VectorSearchBackend {
    return this.backend;
  }
}
