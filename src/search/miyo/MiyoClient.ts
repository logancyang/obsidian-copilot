/**
 * Miyo API Client
 *
 * Provides typed access to the Miyo retrieval service endpoints.
 * Miyo is a local hybrid search service that combines semantic and lexical retrieval.
 */

import { logError, logInfo, logWarn } from "@/logger";
import {
  DeleteRequest,
  DeleteResponse,
  FilesQueryParams,
  FilesResponse,
  HealthResponse,
  IngestRequest,
  IngestChunksRequest,
  IngestResponse,
  MiyoClientConfig,
  SearchRequest,
  SearchResponse,
} from "./types";

/** Default timeout for requests (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30000;

/** Default API version path */
const API_VERSION = "v0";

/**
 * Error thrown when Miyo API requests fail.
 */
export class MiyoApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown
  ) {
    super(message);
    this.name = "MiyoApiError";
  }
}

/**
 * Client for interacting with the Miyo retrieval service.
 *
 * @example
 * ```typescript
 * const client = new MiyoClient({
 *   baseUrl: "http://localhost:8000",
 *   sourceId: "my-vault"
 * });
 *
 * // Check health
 * const health = await client.health();
 *
 * // Search for documents
 * const results = await client.search({ query: "machine learning" });
 *
 * // Ingest a file
 * await client.ingest({ file: "path/to/note.md" });
 * ```
 */
export class MiyoClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeout: number;
  private readonly sourceId?: string;

  constructor(config: MiyoClientConfig) {
    // Remove trailing slash from base URL
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.sourceId = config.sourceId;
  }

  /**
   * Build the full URL for an API endpoint.
   */
  private buildUrl(
    path: string,
    queryParams?: Record<string, string | number | undefined>
  ): string {
    const url = new URL(`${this.baseUrl}/${API_VERSION}${path}`);

    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Get the default headers for API requests.
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Make an HTTP request with timeout handling.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options?: {
      body?: unknown;
      queryParams?: Record<string, string | number | undefined>;
    }
  ): Promise<T> {
    const url = this.buildUrl(path, options?.queryParams);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }
        throw new MiyoApiError(
          `Miyo API error: ${response.status} ${response.statusText}`,
          response.status,
          responseBody
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof MiyoApiError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new MiyoApiError(`Request timeout after ${this.timeout}ms`);
        }
        throw new MiyoApiError(`Network error: ${error.message}`);
      }

      throw new MiyoApiError(`Unknown error: ${String(error)}`);
    }
  }

  // ==========================================================================
  // Health Endpoint
  // ==========================================================================

  /**
   * Check health status of the Miyo service and its dependencies.
   *
   * @returns Health status including service and Qdrant connection status
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health");
  }

  /**
   * Check if the Miyo service is available and healthy.
   *
   * @returns true if the service is available and Qdrant is connected
   */
  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.health();
      return health.status === "ok" && health.qdrant === "connected";
    } catch (error) {
      logWarn("MiyoClient.isAvailable: Health check failed:", error);
      return false;
    }
  }

  // ==========================================================================
  // Search Endpoint
  // ==========================================================================

  /**
   * Search indexed documents using hybrid search.
   *
   * Combines dense vector similarity (semantic search) with BM25 lexical matching
   * for optimal retrieval quality. Results are de-duplicated by file path,
   * returning the best-matching chunk from each file.
   *
   * @param request - Search parameters
   * @returns Search results with relevance scores
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    logInfo(`MiyoClient.search: Searching for "${request.query.substring(0, 50)}..."`);
    return this.request<SearchResponse>("POST", "/search", { body: request });
  }

  // ==========================================================================
  // Ingest Endpoint
  // ==========================================================================

  /**
   * Ingest a single file into the search index (synchronous).
   *
   * Processes the file immediately and returns the result.
   * When force=true, skips change detection and re-indexes the file.
   *
   * @param request - Ingest parameters
   * @returns Ingest result with status and chunk count
   */
  async ingest(request: IngestRequest): Promise<IngestResponse> {
    // Add source_id if configured and not already set
    const requestWithSource: IngestRequest = {
      ...request,
      source_id: request.source_id ?? this.sourceId,
    };

    logInfo(`MiyoClient.ingest: Ingesting file "${request.file}"`);
    return this.request<IngestResponse>("POST", "/ingest", { body: requestWithSource });
  }

  /**
   * Ingest multiple files in sequence.
   *
   * @param filePaths - Array of file paths to ingest
   * @param options - Ingest options
   * @returns Array of ingest results
   */
  async ingestBatch(
    filePaths: string[],
    options?: { force?: boolean; onProgress?: (completed: number, total: number) => void }
  ): Promise<IngestResponse[]> {
    const results: IngestResponse[] = [];
    const total = filePaths.length;

    for (let i = 0; i < filePaths.length; i++) {
      try {
        const result = await this.ingest({
          file: filePaths[i],
          force: options?.force,
        });
        results.push(result);
      } catch (error) {
        logError(`MiyoClient.ingestBatch: Failed to ingest "${filePaths[i]}"`, error);
        results.push({
          status: "error",
          action: "failed",
          file_path: filePaths[i],
          error: error instanceof Error ? error.message : String(error),
        });
      }

      options?.onProgress?.(i + 1, total);
    }

    return results;
  }

  /**
   * Ingest pre-chunked content into the search index.
   *
   * This method allows Copilot to control chunking for consistency
   * with the lexical search engine. Chunks should be produced by
   * ChunkManager to ensure identical chunk boundaries and IDs.
   *
   * @param request - Chunk-based ingest parameters
   * @returns Ingest result with status and chunk count
   */
  async ingestChunks(request: IngestChunksRequest): Promise<IngestResponse> {
    // Add source_id if configured and not already set
    const requestWithSource: IngestChunksRequest = {
      ...request,
      source_id: request.source_id ?? this.sourceId,
    };

    logInfo(
      `MiyoClient.ingestChunks: Ingesting ${request.chunks.length} chunks for "${request.file_path}"`
    );
    return this.request<IngestResponse>("POST", "/ingest", { body: requestWithSource });
  }

  /**
   * Ingest chunks for multiple files in sequence.
   *
   * @param requests - Array of chunk-based ingest requests
   * @param options - Ingest options
   * @returns Array of ingest results
   */
  async ingestChunksBatch(
    requests: IngestChunksRequest[],
    options?: { onProgress?: (completed: number, total: number) => void }
  ): Promise<IngestResponse[]> {
    const results: IngestResponse[] = [];
    const total = requests.length;

    for (let i = 0; i < requests.length; i++) {
      try {
        const result = await this.ingestChunks(requests[i]);
        results.push(result);
      } catch (error) {
        logError(
          `MiyoClient.ingestChunksBatch: Failed to ingest "${requests[i].file_path}"`,
          error
        );
        results.push({
          status: "error",
          action: "failed",
          file_path: requests[i].file_path,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      options?.onProgress?.(i + 1, total);
    }

    return results;
  }

  // ==========================================================================
  // Files Endpoint
  // ==========================================================================

  /**
   * List indexed files with filtering and pagination.
   *
   * @param params - Query parameters for filtering and pagination
   * @returns Paginated list of indexed files
   */
  async listFiles(params?: FilesQueryParams): Promise<FilesResponse> {
    // Add source_id filter if configured and not already set
    const queryParams: Record<string, string | number | undefined> = {
      source_id: params?.source_id ?? this.sourceId,
      search: params?.search ?? undefined,
      offset: params?.offset,
      limit: params?.limit,
    };

    return this.request<FilesResponse>("GET", "/files", { queryParams });
  }

  /**
   * Get all indexed file paths (handles pagination internally).
   *
   * @returns Array of all indexed file paths
   */
  async getAllIndexedFiles(): Promise<string[]> {
    const allFiles: string[] = [];
    let offset = 0;
    const limit = 200; // Max allowed by API
    let hasMore = true;

    while (hasMore) {
      const response = await this.listFiles({ offset, limit });
      allFiles.push(...response.files.map((f) => f.file_path));
      hasMore = response.has_more;
      offset += limit;
    }

    return allFiles;
  }

  /**
   * Check if a specific file is indexed.
   *
   * @param filePath - Path to check
   * @returns true if the file is indexed
   */
  async isFileIndexed(filePath: string): Promise<boolean> {
    const response = await this.listFiles({ search: filePath, limit: 1 });
    return response.files.some((f) => f.file_path === filePath);
  }

  // ==========================================================================
  // Delete Endpoint
  // ==========================================================================

  /**
   * Delete chunks from the search index.
   *
   * Can delete by:
   * - file_path: Remove all chunks for an exact file path
   * - file_paths: Remove all chunks for multiple file paths
   * - filter: Remove chunks matching metadata filter conditions
   *
   * @param request - Delete parameters
   * @returns Delete result with count of deleted chunks
   */
  async delete(request: DeleteRequest): Promise<DeleteResponse> {
    logInfo(`MiyoClient.delete: Deleting with request:`, request);
    return this.request<DeleteResponse>("POST", "/delete", { body: request });
  }

  /**
   * Delete a single file from the index.
   *
   * @param filePath - Path of the file to delete
   * @returns Delete result
   */
  async deleteFile(filePath: string): Promise<DeleteResponse> {
    return this.delete({ file_path: filePath });
  }

  /**
   * Delete multiple files from the index.
   *
   * @param filePaths - Paths of files to delete
   * @returns Delete result
   */
  async deleteFiles(filePaths: string[]): Promise<DeleteResponse> {
    return this.delete({ file_paths: filePaths });
  }

  /**
   * Delete all indexed files for the configured source.
   * This is useful for clearing the entire vault index.
   *
   * @returns Delete result
   */
  async clearIndex(): Promise<DeleteResponse> {
    if (!this.sourceId) {
      logWarn("MiyoClient.clearIndex: No source_id configured, cannot clear index safely");
      throw new MiyoApiError("Cannot clear index without source_id configured");
    }

    // Get all files and delete them
    const allFiles = await this.getAllIndexedFiles();
    if (allFiles.length === 0) {
      return { status: "ok", deleted_chunks: 0 };
    }

    return this.deleteFiles(allFiles);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get the configured base URL.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get the configured source ID.
   */
  getSourceId(): string | undefined {
    return this.sourceId;
  }
}
