/**
 * Miyo Backend Implementation
 *
 * Implements the VectorSearchBackend interface to integrate Miyo
 * with the existing SelfHostRetriever and RetrieverFactory.
 */

import { logInfo, logWarn } from "@/logger";
import { VectorSearchBackend, VectorSearchResult } from "../selfHostRetriever";
import { MiyoClient, MiyoApiError } from "./MiyoClient";
import { MiyoClientConfig, MetadataFilter, SearchResultItem } from "./types";

/**
 * Miyo backend for self-hosted vector search.
 *
 * This backend connects to a local or remote Miyo service to perform
 * hybrid search (semantic + BM25 lexical) over indexed documents.
 *
 * @example
 * ```typescript
 * const backend = new MiyoBackend({
 *   baseUrl: "http://localhost:8000",
 *   sourceId: "my-vault"
 * });
 *
 * // Register with RetrieverFactory
 * RetrieverFactory.registerSelfHostedBackend(backend);
 * ```
 */
export class MiyoBackend implements VectorSearchBackend {
  private readonly client: MiyoClient;
  private cachedAvailability: boolean | null = null;
  private availabilityCheckTime: number = 0;
  private static readonly AVAILABILITY_CACHE_MS = 30000; // Cache for 30 seconds

  constructor(config: MiyoClientConfig) {
    this.client = new MiyoClient(config);
  }

  /**
   * Search for documents using the query text.
   * Miyo performs hybrid search (semantic + BM25) internally.
   *
   * @param query - The search query
   * @param options - Search options
   * @returns Array of search results
   */
  async search(
    query: string,
    options: {
      limit: number;
      minScore?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<VectorSearchResult[]> {
    try {
      // Convert generic filter to Miyo MetadataFilter format
      const filters = this.buildFilters(options.filter);

      const response = await this.client.search({
        query,
        limit: options.limit,
        filters: filters.length > 0 ? filters : undefined,
      });

      logInfo(
        `MiyoBackend.search: Found ${response.count} results in ${response.execution_time_ms ?? "N/A"}ms`
      );

      // Convert Miyo results to VectorSearchResult format
      return response.results
        .filter((result) => {
          // Apply min score filter if specified
          if (options.minScore !== undefined && result.score < options.minScore) {
            return false;
          }
          return true;
        })
        .map((result) => this.convertToVectorSearchResult(result));
    } catch (error) {
      if (error instanceof MiyoApiError) {
        logWarn(`MiyoBackend.search: API error - ${error.message}`);
      } else {
        logWarn(`MiyoBackend.search: Error - ${error}`);
      }
      return [];
    }
  }

  /**
   * Search using a pre-computed embedding vector.
   *
   * Note: Miyo's search endpoint doesn't directly support vector search.
   * This method is not supported and will return an empty array.
   * Use the text-based search() method instead.
   *
   * @param _embedding - The query embedding vector (unused)
   * @param _options - Search options (unused)
   * @returns Empty array (not supported)
   */
  async searchByVector(
    _embedding: number[],
    _options: {
      limit: number;
      minScore?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<VectorSearchResult[]> {
    logWarn("MiyoBackend.searchByVector: Vector search is not supported. Use text search instead.");
    return [];
  }

  /**
   * Check if the Miyo service is available.
   * Results are cached for 30 seconds to avoid excessive health checks.
   *
   * @returns true if the service is available
   */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();

    // Return cached result if still valid
    if (
      this.cachedAvailability !== null &&
      now - this.availabilityCheckTime < MiyoBackend.AVAILABILITY_CACHE_MS
    ) {
      return this.cachedAvailability;
    }

    // Perform health check
    try {
      this.cachedAvailability = await this.client.isAvailable();
      this.availabilityCheckTime = now;
      return this.cachedAvailability;
    } catch (error) {
      logWarn("MiyoBackend.isAvailable: Health check failed:", error);
      this.cachedAvailability = false;
      this.availabilityCheckTime = now;
      return false;
    }
  }

  /**
   * Get the embedding dimension.
   *
   * Note: Miyo handles embeddings internally, so this returns a placeholder value.
   * The actual dimension is determined by the embedding model configured in Miyo.
   *
   * @returns 0 (dimension managed by Miyo)
   */
  getEmbeddingDimension(): number {
    // Miyo handles embeddings internally
    return 0;
  }

  /**
   * Get the underlying Miyo client for direct access.
   *
   * Useful for operations not covered by the VectorSearchBackend interface,
   * such as ingesting files or managing the index.
   *
   * @returns The MiyoClient instance
   */
  getClient(): MiyoClient {
    return this.client;
  }

  /**
   * Invalidate the availability cache.
   * Call this when settings change or after a connection error.
   */
  invalidateAvailabilityCache(): void {
    this.cachedAvailability = null;
    this.availabilityCheckTime = 0;
  }

  /**
   * Build Miyo MetadataFilter array from generic filter object.
   */
  private buildFilters(filter?: Record<string, unknown>): MetadataFilter[] {
    if (!filter) {
      return [];
    }

    const filters: MetadataFilter[] = [];

    // Handle time range filter (mtime)
    if (filter.mtime && typeof filter.mtime === "object") {
      const mtimeFilter = filter.mtime as Record<string, number>;
      filters.push({
        field: "mtime",
        gte: mtimeFilter.gte,
        lte: mtimeFilter.lte,
        gt: mtimeFilter.gt,
        lt: mtimeFilter.lt,
      });
    }

    // Handle ctime filter
    if (filter.ctime && typeof filter.ctime === "object") {
      const ctimeFilter = filter.ctime as Record<string, number>;
      filters.push({
        field: "ctime",
        gte: ctimeFilter.gte,
        lte: ctimeFilter.lte,
        gt: ctimeFilter.gt,
        lt: ctimeFilter.lt,
      });
    }

    // Handle tag filter (if supported by Miyo in the future)
    // Currently tags are not directly supported in Miyo's filter API

    return filters;
  }

  /**
   * Convert Miyo SearchResultItem to VectorSearchResult.
   */
  private convertToVectorSearchResult(item: SearchResultItem): VectorSearchResult {
    return {
      id: `${item.file_path}:${item.chunk_index ?? 0}`,
      score: item.score,
      content: item.chunk_text || item.snippet,
      metadata: {
        path: item.file_path,
        title: item.title ?? item.file_name ?? undefined,
        mtime: item.mtime ?? undefined,
        ctime: item.ctime ?? undefined,
        chunkIndex: item.chunk_index ?? undefined,
        totalChunks: item.total_chunks ?? undefined,
        // Additional metadata
        fileName: item.file_name ?? undefined,
        snippet: item.snippet,
      },
    };
  }
}
