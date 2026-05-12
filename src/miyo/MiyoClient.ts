import { getDecryptedKey } from "@/encryptionService";
import { logError, logInfo, logWarn } from "@/logger";
import { MiyoServiceDiscovery } from "@/miyo/MiyoServiceDiscovery";
import { getSettings } from "@/settings/model";
import { err2String } from "@/utils";
import { requestUrl } from "obsidian";

/**
 * Indexed file entry returned by Miyo.
 */
export interface MiyoIndexedFileEntry {
  path: string;
  title?: string | null;
  mtime: number;
  updated_at?: string;
  total_chunks?: number;
}

/**
 * Response for indexed file listing.
 */
export interface MiyoIndexedFilesResponse {
  files: MiyoIndexedFileEntry[];
  total: number;
}

/**
 * Folder entry returned by Miyo.
 */
export interface MiyoFolderEntry {
  path: string;
  include_patterns?: string[];
  exclude_patterns?: string[];
  recursive?: boolean;
  [key: string]: unknown;
}

/**
 * Response for scan requests.
 */
export interface MiyoScanResponse {
  status?: string;
  path?: string;
}

/**
 * Response for documents-by-path.
 */
export interface MiyoDocumentsResponse {
  documents: Array<{
    id: string;
    path: string;
    title?: string | null;
    chunk_index?: number;
    chunk_text?: string | null;
    metadata?: Record<string, unknown>;
    embedding_model?: string | null;
    ctime?: number;
    mtime?: number;
    tags?: string[];
    extension?: string;
    created_at?: string | number | null;
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
  title?: string | null;
  chunk_index?: number;
  chunk_text?: string | null;
  metadata?: Record<string, unknown>;
  embedding_model?: string | null;
  ctime?: number;
  mtime?: number;
  tags?: string[];
  extension?: string;
  created_at?: string | number | null;
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
 * Response for Miyo document parsing endpoint.
 */
export interface MiyoParseDocResponse {
  text: string;
  format: string;
  source_path: string;
  title?: string;
  page_count?: number;
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
      if (health?.status !== "ok") {
        logWarn(`Miyo health check failed: status="${health?.status ?? "unknown"}"`);
        return false;
      }
      return true;
    } catch (error) {
      logWarn(`Miyo backend availability check failed: ${err2String(error)}`);
      return false;
    }
  }

  /**
   * Fetch the Miyo folder entry for a registered folder name.
   *
   * @param baseUrl - Miyo base URL.
   * @param folderName - Vault name registered in Miyo.
   * @returns Folder entry.
   */
  public async getFolder(baseUrl: string, folderName: string): Promise<MiyoFolderEntry> {
    return this.requestJson<MiyoFolderEntry>(baseUrl, "/v0/folder", {
      method: "GET",
      query: { path: folderName },
    });
  }

  /**
   * Trigger a Miyo folder scan.
   *
   * @param baseUrl - Miyo base URL.
   * @param folderName - Vault name registered in Miyo.
   * @param force - Whether to force a full re-scan.
   * @returns Scan response.
   */
  public async scanFolder(
    baseUrl: string,
    folderName: string,
    force = false
  ): Promise<MiyoScanResponse> {
    return this.requestJson<MiyoScanResponse>(baseUrl, "/v0/scan", {
      method: "POST",
      body: {
        path: folderName,
        force,
      },
    });
  }

  /**
   * List indexed files for a folder with pagination and filters.
   *
   * @param baseUrl - Miyo base URL.
   * @param options - Folder file list options.
   * @returns Indexed files response.
   */
  public async listFolderFiles(
    baseUrl: string,
    options: {
      folderName: string;
      title?: string;
      filePath?: string;
      mtimeAfter?: number;
      mtimeBefore?: number;
      offset?: number;
      limit?: number;
      orderBy?: "mtime" | "updated_at";
    }
  ): Promise<MiyoIndexedFilesResponse> {
    return this.requestJson<MiyoIndexedFilesResponse>(baseUrl, "/v0/folder/files", {
      method: "GET",
      query: {
        folder_name: options.folderName,
        title: options.title,
        file_path: options.filePath,
        mtime_after: options.mtimeAfter,
        mtime_before: options.mtimeBefore,
        offset: options.offset,
        limit: options.limit,
        order_by: options.orderBy,
      },
    });
  }

  /**
   * Fetch all indexed chunks for a file path.
   *
   * @param baseUrl - Miyo base URL.
   * @param folderName - Vault name to scope the document lookup.
   * @param path - Absolute file path to look up.
   * @returns Documents response.
   */
  public async getDocumentsByPath(
    baseUrl: string,
    folderName: string,
    path: string
  ): Promise<MiyoDocumentsResponse> {
    return this.requestJson<MiyoDocumentsResponse>(baseUrl, "/v0/folder/documents", {
      method: "GET",
      query: {
        path,
        folder_name: folderName,
      },
    });
  }

  /**
   * Execute a hybrid search query scoped to a folder.
   *
   * @param baseUrl - Miyo base URL.
   * @param folderName - Vault name sent to Miyo.
   * @param query - User query.
   * @param limit - Maximum number of results.
   * @param filters - Optional search filters.
   * @returns Search response.
   */
  public async search(
    baseUrl: string,
    folderName: string | undefined,
    query: string,
    limit: number,
    filters?: MiyoSearchFilter[]
  ): Promise<MiyoSearchResponse> {
    const payload = {
      query,
      ...(folderName ? { folder_name: folderName } : {}),
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
   * @param filePath - Absolute source note path to find related notes for.
   * @param options - Optional folder name, result limit, and filters.
   * @returns Search response in the same shape as /v0/search.
   */
  public async searchRelated(
    baseUrl: string,
    filePath: string,
    options?: {
      folderName?: string;
      limit?: number;
      filters?: MiyoSearchFilter[];
    }
  ): Promise<MiyoRelatedSearchResponse> {
    const payload = {
      file_path: filePath,
      ...(options?.folderName ? { folder_name: options.folderName } : {}),
      ...(typeof options?.limit === "number" ? { limit: options.limit } : {}),
      ...(options?.filters && options.filters.length > 0 ? { filters: options.filters } : {}),
    };
    return this.requestJson<MiyoRelatedSearchResponse>(baseUrl, "/v0/search/related", {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Parse a local document via Miyo.
   *
   * @param baseUrl - Miyo base URL.
   * @param folderName - Vault name sent to Miyo.
   * @param path - Vault-relative file path.
   * @returns Parsed document response.
   */
  public async parseDoc(
    baseUrl: string,
    folderName: string,
    path: string
  ): Promise<MiyoParseDocResponse> {
    return this.requestJson<MiyoParseDocResponse>(baseUrl, "/v0/parse-doc", {
      method: "POST",
      body: { folder_name: folderName, path },
    });
  }

  /**
   * Build request headers, including auth when configured.
   * `Authorization` uses the Copilot Plus license key.
   *
   * @returns Headers object for requestUrl.
   */
  private async buildHeaders(): Promise<Record<string, string>> {
    const settings = getSettings();
    const headers: Record<string, string> = {};

    const licenseKey = settings.plusLicenseKey
      ? await getDecryptedKey(settings.plusLicenseKey)
      : "";
    if (licenseKey) {
      headers.Authorization = `Bearer ${licenseKey}`;
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
    const headers = await this.buildHeaders();
    logInfo("Miyo request:", {
      method: options.method,
      url: url.toString(),
      hasBody: Boolean(body),
      hasAuthorizationHeader: Boolean(headers.Authorization),
      ...(getSettings().debug && options.method === "POST" ? { postBody: options.body } : {}),
    });

    const response = await requestUrl({
      url: url.toString(),
      method: options.method,
      headers,
      contentType: body ? "application/json" : undefined,
      body,
      throw: false,
    });

    if (response.status >= 400) {
      const errorPayload = this.parseResponseJson<{ detail?: string }>(
        response.json,
        response.text
      );
      const errorText = errorPayload?.detail || response.text || "";
      logWarn(`Miyo request failed (${response.status}): ${errorText}`);
      throw new Error(
        errorText
          ? `Miyo request failed with status ${response.status}: ${errorText}`
          : `Miyo request failed with status ${response.status}`
      );
    }

    const parsed = this.parseResponseJson<T>(response.json, response.text);
    if (getSettings().debug) {
      logInfo(`Miyo request ${options.method} ${url.toString()} succeeded`);
    }
    return parsed;
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
