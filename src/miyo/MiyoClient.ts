import { logError, logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { err2String } from "@/utils";
import { requestUrl } from "obsidian";
import { MiyoServiceDiscovery } from "@/miyo/MiyoServiceDiscovery";

/**
 * Request payload for upserting documents into Miyo.
 */
export interface MiyoUpsertDocument {
  id: string;
  path: string;
  title: string;
  content: string;
  created_at: number;
  ctime: number;
  mtime: number;
  tags: string[];
  extension: string;
  nchars: number;
  metadata: Record<string, unknown>;
}

/**
 * Response for index file listing.
 */
export interface MiyoIndexedFilesResponse {
  files: Array<{ path: string; mtime: number }>;
  total: number;
}

/**
 * Response for index statistics.
 */
export interface MiyoIndexStatsResponse {
  total_chunks: number;
  total_files: number;
  latest_mtime: number;
  embedding_model?: string;
  embedding_dim?: number;
}

/**
 * Response for documents-by-path.
 */
export interface MiyoDocumentsResponse {
  documents: Array<{
    id: string;
    path: string;
    title?: string;
    chunk_index?: number;
    chunk_text?: string;
    metadata?: Record<string, unknown>;
    embedding_model?: string;
    ctime?: number;
    mtime?: number;
    tags?: string[];
    extension?: string;
    created_at?: number;
    nchars?: number;
  }>;
}

/**
 * Response item from Miyo search.
 */
export interface MiyoSearchResult {
  id: string;
  score: number;
  path: string;
  title?: string;
  chunk_index?: number;
  chunk_text: string;
  metadata?: Record<string, unknown>;
  embedding_model?: string;
  ctime?: number;
  mtime?: number;
  tags?: string[];
  extension?: string;
  created_at?: number;
  nchars?: number;
}

/**
 * Response for Miyo search endpoint.
 */
export interface MiyoSearchResponse {
  results: MiyoSearchResult[];
}

/**
 * Minimal result item for related-note queries.
 */
export interface MiyoRelatedSearchResult {
  path: string;
  score: number;
}

/**
 * Response for Miyo related-note search endpoint.
 */
export interface MiyoRelatedSearchResponse {
  results: MiyoRelatedSearchResult[];
}

/**
 * Search filters for Miyo queries.
 */
export interface MiyoSearchFilter {
  field: string;
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
  equals?: string | number | boolean;
  containsAny?: string[];
}

/**
 * Client for calling the Miyo HTTP API.
 */
export class MiyoClient {
  private discovery: MiyoServiceDiscovery;

  /**
   * Create a new Miyo client instance.
   */
  constructor() {
    this.discovery = MiyoServiceDiscovery.getInstance();
  }

  /**
   * Resolve the base URL for Miyo, using overrides when provided.
   *
   * @param overrideUrl - Optional explicit base URL.
   * @returns Resolved base URL without trailing slash.
   */
  public async resolveBaseUrl(overrideUrl?: string): Promise<string> {
    const baseUrl = await this.discovery.resolveBaseUrl({ overrideUrl });
    if (!baseUrl) {
      throw new Error("Miyo base URL not available");
    }
    return baseUrl;
  }

  /**
   * Check whether the Miyo backend is reachable.
   *
   * @param overrideUrl - Optional explicit base URL.
   * @returns True when the health endpoint responds with status "ok".
   */
  public async isBackendAvailable(overrideUrl?: string): Promise<boolean> {
    try {
      const baseUrl = await this.resolveBaseUrl(overrideUrl);
      const health = await this.requestJson<{ status?: string }>(baseUrl, "/v0/health", {
        method: "GET",
      });
      return health?.status === "ok";
    } catch (error) {
      if (getSettings().debug) {
        logWarn(`Miyo backend availability check failed: ${err2String(error)}`);
      }
      return false;
    }
  }

  /**
   * Upsert a batch of documents.
   *
   * @param baseUrl - Miyo base URL.
   * @param sourceId - Vault-specific source id.
   * @param documents - Documents to upsert.
   * @returns Number of documents upserted.
   */
  public async upsertDocuments(
    baseUrl: string,
    sourceId: string,
    documents: MiyoUpsertDocument[]
  ): Promise<number> {
    const payload = { source_id: sourceId, documents };
    const response = await this.requestJson<{ upserted: number }>(baseUrl, "/v0/index/upsert", {
      method: "POST",
      body: payload,
    });
    return response?.upserted ?? 0;
  }

  /**
   * Delete documents by file path.
   *
   * @param baseUrl - Miyo base URL.
   * @param sourceId - Vault-specific source id.
   * @param path - File path to delete.
   * @returns Count of documents deleted.
   */
  public async deleteByPath(baseUrl: string, sourceId: string, path: string): Promise<number> {
    const payload = { source_id: sourceId, path };
    const response = await this.requestJson<{ deleted?: number }>(baseUrl, "/v0/index/by_path", {
      method: "DELETE",
      body: payload,
    });
    return response?.deleted ?? 0;
  }

  /**
   * Clear all indexed documents for a source.
   *
   * @param baseUrl - Miyo base URL.
   * @param sourceId - Vault-specific source id.
   */
  public async clearIndex(baseUrl: string, sourceId: string): Promise<void> {
    const payload = { source_id: sourceId };
    await this.requestJson(baseUrl, "/v0/index/clear", { method: "POST", body: payload });
  }

  /**
   * List indexed files with pagination.
   *
   * @param baseUrl - Miyo base URL.
   * @param sourceId - Vault-specific source id.
   * @param offset - Offset for pagination.
   * @param limit - Page size.
   * @returns Indexed files response.
   */
  public async listFiles(
    baseUrl: string,
    sourceId: string,
    offset: number,
    limit: number
  ): Promise<MiyoIndexedFilesResponse> {
    return this.requestJson<MiyoIndexedFilesResponse>(baseUrl, "/v0/index/files", {
      method: "GET",
      query: { source_id: sourceId, offset, limit },
    });
  }

  /**
   * Fetch index statistics for a source.
   *
   * @param baseUrl - Miyo base URL.
   * @param sourceId - Vault-specific source id.
   * @returns Index stats response.
   */
  public async getStats(baseUrl: string, sourceId: string): Promise<MiyoIndexStatsResponse> {
    return this.requestJson<MiyoIndexStatsResponse>(baseUrl, "/v0/index/stats", {
      method: "GET",
      query: { source_id: sourceId },
    });
  }

  /**
   * Fetch all documents for a given path.
   *
   * @param baseUrl - Miyo base URL.
   * @param sourceId - Vault-specific source id.
   * @param path - File path to look up.
   * @returns Documents response.
   */
  public async getDocumentsByPath(
    baseUrl: string,
    sourceId: string,
    path: string
  ): Promise<MiyoDocumentsResponse> {
    return this.requestJson<MiyoDocumentsResponse>(baseUrl, "/v0/index/documents", {
      method: "GET",
      query: { source_id: sourceId, path },
    });
  }

  /**
   * Execute a hybrid search query.
   *
   * @param baseUrl - Miyo base URL.
   * @param sourceId - Vault-specific source id.
   * @param query - User query.
   * @param limit - Maximum number of results.
   * @param filters - Optional search filters.
   * @returns Search response.
   */
  public async search(
    baseUrl: string,
    sourceId: string,
    query: string,
    limit: number,
    filters?: MiyoSearchFilter[]
  ): Promise<MiyoSearchResponse> {
    const payload = {
      query,
      source_id: sourceId,
      limit,
      ...(filters && filters.length > 0 ? { filters } : {}),
    };
    if (getSettings().debug) {
      logInfo("Miyo search request:", { baseUrl, payload });
    }
    return this.requestJson<MiyoSearchResponse>(baseUrl, "/v0/search", {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Execute related-notes search for a source note path.
   *
   * @param baseUrl - Miyo base URL.
   * @param filePath - Source note path to find related notes for.
   * @param options - Optional source id, result limit, and filters.
   * @returns Search response in the same shape as /v0/search.
   */
  public async searchRelated(
    baseUrl: string,
    filePath: string,
    options?: {
      sourceId?: string;
      limit?: number;
      filters?: MiyoSearchFilter[];
    }
  ): Promise<MiyoRelatedSearchResponse> {
    const payload = {
      file_path: filePath,
      ...(options?.sourceId ? { source_id: options.sourceId } : {}),
      ...(typeof options?.limit === "number" ? { limit: options.limit } : {}),
      ...(options?.filters && options.filters.length > 0 ? { filters: options.filters } : {}),
    };
    if (getSettings().debug) {
      logInfo("Miyo related search request:", { baseUrl, payload });
    }
    return this.requestJson<MiyoRelatedSearchResponse>(baseUrl, "/v0/search/related", {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Build request headers, including optional auth.
   *
   * @param apiKeyOverride - Optional API key override.
   * @returns Headers object for requestUrl.
   */
  private buildHeaders(apiKeyOverride?: string): Record<string, string> {
    const apiKey = apiKeyOverride ?? getSettings().selfHostApiKey;
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
      headers["X-API-Key"] = apiKey;
    }
    return headers;
  }

  /**
   * Execute a JSON request to the Miyo API.
   *
   * @param baseUrl - Base URL for Miyo.
   * @param path - Endpoint path.
   * @param options - Request options.
   * @returns Parsed JSON response.
   */
  private async requestJson<T>(
    baseUrl: string,
    path: string,
    options: {
      method: "GET" | "POST" | "DELETE";
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<T> {
    const url = new URL(path, baseUrl);
    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const body = options.body ? JSON.stringify(options.body) : undefined;
    const response = await requestUrl({
      url: url.toString(),
      method: options.method,
      headers: this.buildHeaders(),
      contentType: body ? "application/json" : undefined,
      body,
      throw: false,
    });

    if (response.status >= 400) {
      const errorText = response.text ? response.text : "";
      logWarn(`Miyo request failed (${response.status}): ${errorText}`);
      throw new Error(`Miyo request failed with status ${response.status}`);
    }

    const parsed = this.parseResponseJson<T>(response.json, response.text);
    if (getSettings().debug) {
      logInfo(`Miyo request ${options.method} ${url.toString()} succeeded`);
    }
    return parsed as T;
  }

  /**
   * Parse a response payload that may already be JSON or a JSON string.
   *
   * @param json - Parsed JSON or JSON string.
   * @param text - Raw response text.
   * @returns Parsed JSON value or empty object.
   */
  private parseResponseJson<T>(json: unknown, text?: string): T {
    if (typeof json === "string") {
      try {
        return JSON.parse(json) as T;
      } catch (error) {
        logError(`Failed to parse Miyo JSON response: ${err2String(error)}`);
        return {} as T;
      }
    }
    if (json !== undefined && json !== null) {
      return json as T;
    }
    if (text) {
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        logError(`Failed to parse Miyo text response: ${err2String(error)}`);
        return {} as T;
      }
    }
    return {} as T;
  }
}
