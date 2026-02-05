import { logInfo, logWarn } from "@/logger";
import { VectorSearchBackend, VectorSearchResult } from "@/search/selfHostRetriever";
import { discoverMiyoService } from "@/search/miyo/MiyoServiceDiscovery";
import { getSettings } from "@/settings/model";
import { safeFetch } from "@/utils";

/**
 * Configuration for Miyo backend.
 */
export interface MiyoBackendConfig {
  url?: string;
  apiKey?: string;
}

interface MiyoMetadataFilter {
  field: string;
  gt?: number;
  lt?: number;
  gte?: number;
  lte?: number;
}

interface MiyoSearchRequest {
  query: string;
  limit?: number;
  filters?: MiyoMetadataFilter[];
}

interface MiyoSearchResultItem {
  file_path: string;
  snippet: string;
  score: number;
  title?: string | null;
  mtime?: number | null;
  ctime?: number | null;
  file_name?: string | null;
  chunk_index?: number | null;
  total_chunks?: number | null;
  chunk_text?: string | null;
}

interface MiyoSearchResponse {
  results: MiyoSearchResultItem[];
  query: string;
  count: number;
  execution_time_ms?: number | null;
}

/**
 * VectorSearchBackend implementation for Miyo.
 */
export class MiyoBackend implements VectorSearchBackend {
  private url?: string;
  private apiKey?: string;

  /**
   * Create a new Miyo backend.
   */
  constructor(config: MiyoBackendConfig) {
    this.url = config.url;
    this.apiKey = config.apiKey;
  }

  /**
   * Search using Miyo's /v0/search endpoint.
   */
  public async search(
    query: string,
    options: {
      limit: number;
      minScore?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<VectorSearchResult[]> {
    const baseUrl = await this.resolveBaseUrl();
    if (!baseUrl) {
      logWarn("MiyoBackend: No base URL available for search");
      return [];
    }

    const requestBody: MiyoSearchRequest = {
      query,
      limit: options.limit,
      filters: this.mapFilters(options.filter),
    };
    logInfo("MiyoBackend: search request", {
      url: `${baseUrl}/v0/search`,
      body: requestBody,
    });

    try {
      const response = await safeFetch(`${baseUrl}/v0/search`, {
        method: "POST",
        headers: this.buildAuthHeaders(),
        body: JSON.stringify(requestBody),
      });
      const raw = await response.json();
      const parsed: MiyoSearchResponse =
        typeof raw === "string" ? (JSON.parse(raw) as MiyoSearchResponse) : raw;

      const results = Array.isArray(parsed?.results) ? parsed.results : [];
      logInfo("MiyoBackend: search response", {
        status: response.status,
        count: parsed?.count ?? results.length,
        execution_time_ms: parsed?.execution_time_ms ?? null,
        resultsPreview: this.summarizeResults(results),
      });
      if (getSettings().debug) {
        logInfo("MiyoBackend: search response (full)", parsed);
      }
      const mapped = results.map((item) => this.mapResult(item));
      const minScore = options.minScore;
      if (typeof minScore === "number") {
        return mapped.filter((item) => item.score >= minScore);
      }
      return mapped;
    } catch (error) {
      logWarn("MiyoBackend: search failed", error);
      return [];
    }
  }

  /**
   * Vector search is not supported by Miyo's search API.
   */
  public async searchByVector(
    _embedding: number[],
    _options: {
      limit: number;
      minScore?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<VectorSearchResult[]> {
    logWarn("MiyoBackend: searchByVector not supported");
    return [];
  }

  /**
   * Check availability via service discovery and health endpoint.
   */
  public async isAvailable(): Promise<boolean> {
    const baseUrl = await this.resolveBaseUrl();
    if (!baseUrl) {
      return false;
    }

    try {
      const response = await safeFetch(`${baseUrl}/v0/health`, {
        method: "GET",
        headers: this.buildAuthHeaders(),
      });
      if (response.ok) {
        logInfo("MiyoBackend: health check succeeded");
      }
      return response.ok;
    } catch (error) {
      logWarn("MiyoBackend: health check failed", error);
      return false;
    }
  }

  /**
   * Miyo handles embeddings internally.
   */
  public getEmbeddingDimension(): number {
    return 0;
  }

  /**
   * Resolve base URL from config or local discovery.
   */
  private async resolveBaseUrl(): Promise<string | null> {
    if (this.url && this.url.trim().length > 0) {
      return this.url.trim().replace(/\/+$/, "");
    }
    const discovery = await discoverMiyoService();
    return discovery?.baseUrl ?? null;
  }

  /**
   * Build authentication headers if an API key is provided.
   */
  private buildAuthHeaders(): Record<string, string> {
    if (!this.apiKey) {
      return {};
    }
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "X-API-Key": this.apiKey,
    };
  }

  /**
   * Map generic filter object to Miyo metadata filters.
   */
  private mapFilters(filter?: Record<string, unknown>): MiyoMetadataFilter[] | undefined {
    if (!filter) {
      return undefined;
    }

    const filters: MiyoMetadataFilter[] = [];
    const mtime = filter.mtime as Record<string, unknown> | undefined;
    const ctime = filter.ctime as Record<string, unknown> | undefined;

    const mtimeFilter = this.buildTimeFilter("mtime", mtime);
    if (mtimeFilter) {
      filters.push(mtimeFilter);
    }

    const ctimeFilter = this.buildTimeFilter("ctime", ctime);
    if (ctimeFilter) {
      filters.push(ctimeFilter);
    }

    return filters.length > 0 ? filters : undefined;
  }

  /**
   * Build a Miyo time filter from a generic time object.
   */
  private buildTimeFilter(
    field: "mtime" | "ctime",
    input?: Record<string, unknown>
  ): MiyoMetadataFilter | null {
    if (!input) {
      return null;
    }

    const filter: MiyoMetadataFilter = { field };
    if (typeof input.gt === "number") filter.gt = input.gt;
    if (typeof input.gte === "number") filter.gte = input.gte;
    if (typeof input.lt === "number") filter.lt = input.lt;
    if (typeof input.lte === "number") filter.lte = input.lte;

    const hasBounds =
      typeof filter.gt === "number" ||
      typeof filter.gte === "number" ||
      typeof filter.lt === "number" ||
      typeof filter.lte === "number";

    return hasBounds ? filter : null;
  }

  /**
   * Convert a Miyo result into a VectorSearchResult.
   */
  private mapResult(item: MiyoSearchResultItem): VectorSearchResult {
    const chunkIndex = typeof item.chunk_index === "number" ? item.chunk_index : 0;
    const totalChunks = typeof item.total_chunks === "number" ? item.total_chunks : undefined;

    return {
      id: `${item.file_path}:${chunkIndex}`,
      score: item.score ?? 0,
      content: item.chunk_text ?? item.snippet ?? "",
      metadata: {
        path: item.file_path,
        title: item.title ?? undefined,
        mtime: item.mtime ?? undefined,
        ctime: item.ctime ?? undefined,
        fileName: item.file_name ?? undefined,
        chunkIndex,
        totalChunks,
      },
    };
  }

  /**
   * Summarize results for logging without dumping large payloads.
   */
  private summarizeResults(results: MiyoSearchResultItem[]): Array<Record<string, unknown>> {
    const previewLimit = 5;
    return results.slice(0, previewLimit).map((item) => ({
      file_path: item.file_path,
      score: item.score,
      chunk_index: item.chunk_index ?? null,
      snippet_length: item.snippet?.length ?? 0,
      chunk_text_length: item.chunk_text?.length ?? 0,
    }));
  }
}
