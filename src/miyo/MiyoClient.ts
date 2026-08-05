import { logError, logInfo, logWarn } from "@/logger";
import type { MiyoHealthResponse } from "@/miyo/miyoHealth";
import { MiyoServiceDiscovery } from "@/miyo/MiyoServiceDiscovery";
import { type CopilotSettings, getSettings } from "@/settings/model";
import { err2String, withTimeout } from "@/utils";
import { requestUrl } from "obsidian";

export type {
  MiyoHealthChatSync,
  MiyoHealthChatSyncPlatform,
  MiyoHealthRelay,
  MiyoHealthResponse,
} from "@/miyo/miyoHealth";

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
 * Request body for `POST /v0/folder`.
 *
 * `path` is the vault root as an ABSOLUTE path on the machine running Miyo — the
 * server resolves and indexes it locally, so it only makes sense for a local
 * Miyo. The include/exclude fields scope indexing (excludes always win). We omit
 * `allow_remote_read` for a one-click local connect: it defaults to true on the
 * server and only governs remote-AI (relay) visibility, never local calls.
 */
export interface MiyoAddFolderRequest {
  path: string;
  include_extensions?: string[];
  include_folders?: string[];
  exclude_folders?: string[];
  include_patterns?: string[];
  exclude_patterns?: string[];
  allow_writes?: boolean;
  allow_remote_read?: boolean;
}

/**
 * Whether a vault folder is registered with Miyo, as a discriminated result
 * rather than a thrown error — so the connect flow can branch on it directly:
 *
 * - `registered`   — Miyo knows this folder (HTTP 200).
 * - `unregistered` — Miyo is reachable but the folder isn't added (HTTP 404).
 * - `error`        — couldn't determine (unreachable base URL, 5xx, other 4xx,
 *                    network failure). Callers must NOT treat this as
 *                    "unregistered": the folder may well be registered.
 */
export type MiyoFolderRegistration = "registered" | "unregistered" | "error";

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
  /**
   * Hard timeout for the health probe. A liveness check should return in well
   * under a second even against a remote Miyo; bounding it keeps a connection
   * that opens but never responds from wedging callers that cache the probe
   * promise (see {@link fetchHealth}).
   */
  private static readonly HEALTH_TIMEOUT_MS = 8000;

  private discovery: MiyoServiceDiscovery;

  private readonly authSnapshot?: Pick<CopilotSettings, "plusLicenseKey">;

  /**
   * Create a new Miyo client instance.
   *
   * @param authSnapshot - Credentials captured when the caller's work began.
   *   Callers whose requests can outlive the settings they started under —
   *   a multi-request mutation that straddles a vault switch — pass their own
   *   snapshot so every request carries the credential of the vault that asked
   *   for it. Omitted, each request reads the live settings, which is what
   *   short-lived callers want.
   */
  constructor(authSnapshot?: Pick<CopilotSettings, "plusLicenseKey">) {
    this.authSnapshot = authSnapshot;
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
   * Fetch the full Miyo health payload.
   *
   * Returns null on any failure (unreachable, non-JSON, thrown) so callers can
   * distinguish "reached Miyo, read its sub-statuses" from "couldn't reach it".
   * The status store relies on this: a null result means backend-unavailable
   * with the other capabilities left "unknown" rather than falsely "off".
   *
   * @param overrideUrl - Optional explicit base URL.
   * @returns Parsed health payload, or null when Miyo can't be reached.
   */
  public async fetchHealth(overrideUrl?: string): Promise<MiyoHealthResponse | null> {
    try {
      // Bound the whole probe (discovery + request) with a hard timeout. Obsidian's
      // requestUrl ignores the abort signal, so a Miyo that accepts the connection
      // but never responds would otherwise leave this promise pending forever — and
      // the status store caches it as its single-flight refresh, so every later
      // refresh (and the doc-processor routing that awaits it) would hang with no
      // self-heal. The race still settles; a timeout maps to null, which already
      // means "couldn't reach Miyo".
      return await withTimeout(
        async () => {
          const baseUrl = await this.resolveBaseUrl(overrideUrl);
          return this.requestJson<MiyoHealthResponse>(baseUrl, "/v0/health", { method: "GET" });
        },
        MiyoClient.HEALTH_TIMEOUT_MS,
        "Miyo health probe"
      );
    } catch (error) {
      logWarn(`Miyo health fetch failed: ${err2String(error)}`);
      return null;
    }
  }

  /**
   * Check whether the Miyo backend is reachable.
   *
   * @param overrideUrl - Optional explicit base URL.
   * @returns True when the health endpoint responds with status "ok".
   */
  public async isBackendAvailable(overrideUrl?: string): Promise<boolean> {
    const health = await this.fetchHealth(overrideUrl);
    if (!health) {
      return false;
    }
    if (health.status !== "ok") {
      logWarn(`Miyo health check failed: status="${health.status ?? "unknown"}"`);
      return false;
    }
    return true;
  }

  /**
   * Register a folder with Miyo (`POST /v0/folder`).
   *
   * Like {@link checkFolderRegistration}, this reads the raw status instead of
   * letting {@link requestJson} throw on non-2xx, so 409 can be recognized as a
   * success rather than an error:
   *
   * - 201 → newly registered; returns the created folder record.
   * - 409 → already registered; returns `null` (idempotent connect — a success
   *   with no new record to hand back, and we don't fabricate one).
   * - 400 → validation error; throws with the server's detail so the caller can
   *   fall back to the manual add flow.
   * - anything else → throws with the status/detail.
   * - transport/resolve failure (no HTTP response) → logs and rethrows.
   *
   * Every failure path logs before throwing, so callers (which treat any throw as
   * "auto-add failed, guide the user manually") don't have to.
   *
   * @param request - Folder registration body; `path` must be absolute.
   * @param overrideUrl - Explicit base URL (from settings) or empty for discovery.
   * @param beforeRequest - Invoked once the URL and credentials are resolved and
   *   immediately before the request goes out; throw from it to call the
   *   registration off. Exists because resolution and decryption are awaits, so
   *   a caller's earlier check can go stale before anything is sent.
   * @returns The created folder record on 201, or `null` when already registered.
   */
  public async addFolder(
    request: MiyoAddFolderRequest,
    overrideUrl?: string,
    beforeRequest?: () => void
  ): Promise<MiyoFolderEntry | null> {
    let response: Awaited<ReturnType<typeof requestUrl>>;
    try {
      const baseUrl = await this.resolveBaseUrl(overrideUrl);
      const url = new URL("/v0/folder", baseUrl);
      const headers = await this.buildHeaders();
      const body = JSON.stringify(request);
      // Last point at which this registration can still be called off: once
      // `requestUrl` has it, Obsidian offers no way to abort.
      beforeRequest?.();
      logInfo("Miyo request:", {
        method: "POST",
        url: url.toString(),
        hasBody: true,
        hasAuthorizationHeader: Boolean(headers.Authorization),
        ...(getSettings().debug ? { postBody: request } : {}),
      });

      response = await requestUrl({
        url: url.toString(),
        method: "POST",
        headers,
        contentType: "application/json",
        body,
        throw: false,
      });
    } catch (error) {
      // No HTTP response (unresolved base URL, network failure): log and rethrow.
      logWarn(`Miyo add-folder request failed: ${err2String(error)}`);
      throw error;
    }

    // Reason: 409 means the vault is already known to Miyo — the exact state the
    // connect flow wants, so it's a success, not a failure.
    if (response.status === 409) {
      logInfo("Miyo folder already registered; treating as success");
      return null;
    }
    if (response.status === 201) {
      return this.parseResponseJson<MiyoFolderEntry>(response.json, response.text);
    }

    const errorPayload = this.parseResponseJson<{ detail?: string }>(response.json, response.text);
    const detail = errorPayload?.detail || response.text || "";
    logWarn(`Miyo add-folder failed (${response.status}): ${detail}`);
    throw new Error(
      detail
        ? `Miyo add-folder failed with status ${response.status}: ${detail}`
        : `Miyo add-folder failed with status ${response.status}`
    );
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
   * Remove a folder registration (`DELETE /v0/folder`), which also purges the
   * folder's indexed documents (verified empirically: a post-delete global
   * search returns no leftovers).
   *
   * 404 is a success: the caller's goal — no registration under that name —
   * already holds (e.g. a prior resync deleted it but never got to re-add).
   * The identifier is the record's canonical `path`, which is the folder NAME,
   * not the absolute path (also verified against a live registration).
   *
   * @param folderName - Registered folder name (see getMiyoFolderName).
   * @param overrideUrl - Explicit base URL (from settings) or empty for discovery.
   * @param beforeRequest - Invoked once the URL and credentials are resolved and
   *   immediately before the request goes out; throw from it to call the deletion
   *   off. Exists because resolution and decryption are awaits, so a caller's
   *   earlier check can go stale before anything is sent.
   */
  public async deleteFolder(
    folderName: string,
    overrideUrl?: string,
    beforeRequest?: () => void
  ): Promise<void> {
    const baseUrl = await this.resolveBaseUrl(overrideUrl);
    const headers = await this.buildHeaders();
    const url = new URL("/v0/folder", baseUrl);
    // Last point at which this deletion can still be called off: once
    // `requestUrl` has it, Obsidian offers no way to abort.
    beforeRequest?.();
    logInfo("Miyo request:", {
      method: "DELETE",
      url: url.toString(),
      hasBody: true,
      hasAuthorizationHeader: Boolean(headers.Authorization),
    });
    const response = await requestUrl({
      url: url.toString(),
      method: "DELETE",
      headers,
      contentType: "application/json",
      body: JSON.stringify({ path: folderName }),
      throw: false,
    });
    if (response.status === 404) {
      logInfo("Miyo folder already unregistered; delete is a no-op");
      return;
    }
    if (response.status >= 400) {
      const detail =
        this.parseResponseJson<{ detail?: string }>(response.json, response.text)?.detail ||
        response.text ||
        "";
      throw new Error(
        detail
          ? `Miyo delete-folder failed with status ${response.status}: ${detail}`
          : `Miyo delete-folder failed with status ${response.status}`
      );
    }
  }

  /**
   * Determine whether a vault folder is registered with Miyo.
   *
   * Unlike {@link getFolder} (which throws on any non-2xx), this reads the raw
   * status so the connect flow can branch cleanly: 200 → registered, 404 →
   * unregistered, anything else → error. It resolves the base URL itself and
   * only inspects `response.status`, never the body — so a healthy-but-malformed
   * payload can't be misread as "unregistered".
   *
   * @param folderName - Vault folder name to check (see getMiyoFolderName).
   * @param overrideUrl - Explicit base URL (from settings) or empty for discovery.
   * @returns Registration state; `error` when it can't be determined.
   */
  public async checkFolderRegistration(
    folderName: string,
    overrideUrl?: string
  ): Promise<MiyoFolderRegistration> {
    try {
      // resolveBaseUrl can reject (discovery yields no address), so it stays
      // inside the try — every failure path must resolve to "error", never throw.
      const baseUrl = await this.resolveBaseUrl(overrideUrl);
      if (!baseUrl) {
        return "error";
      }
      const url = new URL("/v0/folder", baseUrl);
      url.searchParams.set("path", folderName);
      const response = await requestUrl({
        url: url.toString(),
        method: "GET",
        headers: await this.buildHeaders(),
        throw: false,
      });
      if (response.status === 200) {
        return "registered";
      }
      if (response.status === 404) {
        return "unregistered";
      }
      logWarn(`Miyo folder registration check failed: status=${response.status}`);
      return "error";
    } catch (error) {
      logWarn(`Miyo folder registration check failed: ${err2String(error)}`);
      return "error";
    }
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
    const settings = this.authSnapshot ?? getSettings();
    const headers: Record<string, string> = {};

    const licenseKey = settings.plusLicenseKey;
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
