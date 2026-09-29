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

export class MiyoRequestError extends Error {
  public constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly errorCode?: string
  ) {
    super(
      detail
        ? `Miyo request failed with status ${status}: ${detail}`
        : `Miyo request failed with status ${status}`
    );
    this.name = "MiyoRequestError";
  }
}

export interface MiyoIndexedFileEntry {
  path: string;
  title?: string | null;
  mtime: number;
  updated_at?: string;
  total_chunks?: number;
}

export interface MiyoIndexedFilesResponse {
  files: MiyoIndexedFileEntry[];
  total: number;
}

export interface MiyoFolderEntry {
  path: string;
  exclude_folders?: string[];
  include_patterns?: string[];
  exclude_patterns?: string[];
  recursive?: boolean;
  [key: string]: unknown;
}

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

export type MiyoFolderRegistration = "registered" | "unregistered" | "error";

export interface MiyoScanResponse {
  status?: string;
  path?: string;
}

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

export interface MiyoSearchResult {
  id: string;
  score: number;
  path: string;
  title?: string | null;
  chunk_index?: number;
  chunk_text?: string | null;
  snippet?: string | null;
  metadata?: Record<string, unknown>;
  embedding_model?: string | null;
  ctime?: number;
  mtime?: number;
  tags?: string[];
  extension?: string;
  created_at?: string | number | null;
  nchars?: number;
}

export interface MiyoSearchResponse {
  results: MiyoSearchResult[];
}

export interface RelatedContextRequest {
  folder_name: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  draft?: string;
  excerpts?: string[];
  file_paths?: string[];
  limit?: number;
  filters?: MiyoSearchFilter[];
}

export interface RelatedContextResponse {
  status: "ok" | "no_usable_context";
  results: Array<{ path: string; score: number }>;
  count: number;
  skipped_files: Array<{ path: string; reason: "not_indexed" | "unsupported" | "outside_scope" }>;
  context_truncated: boolean;
  execution_time_ms: number;
}

export interface MiyoRelatedSearchResult {
  path: string;
  score: number;
}

export interface MiyoRelatedSearchResponse {
  results: MiyoRelatedSearchResult[];
}

export type MiyoFileStatus =
  | "indexed"
  | "pending"
  | "error"
  | "excluded"
  | "not_scanned"
  | "missing";

export type MiyoFileStatusReason =
  | "exclude_folder"
  | "exclude_pattern"
  | "include_folder"
  | "include_pattern"
  | "extension"
  | "hidden";

export interface MiyoFileStatusResponse {
  status: MiyoFileStatus;
  total_chunks?: number;
  last_indexed_at?: number | null;
  error_message?: string | null;
  reason?: MiyoFileStatusReason;
  rule?: string;
}

export interface MiyoParseDocResponse {
  text: string;
  format: string;
  source_path: string;
  title?: string;
  page_count?: number;
}

export interface MiyoSearchFilter {
  field: string;
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
  equals?: string | number | boolean;
  containsAny?: string[];
}

export class MiyoClient {
  private static readonly HEALTH_TIMEOUT_MS = 8000;

  private discovery: MiyoServiceDiscovery;

  private readonly authSnapshot?: Pick<CopilotSettings, "plusLicenseKey">;

  constructor(authSnapshot?: Pick<CopilotSettings, "plusLicenseKey">) {
    this.authSnapshot = authSnapshot;
    this.discovery = MiyoServiceDiscovery.getInstance();
  }

  public async resolveBaseUrl(overrideUrl?: string): Promise<string> {
    const baseUrl = await this.discovery.resolveBaseUrl({ overrideUrl });
    if (!baseUrl) {
      throw new Error("Miyo base URL not available");
    }
    return baseUrl;
  }

  public async fetchHealth(overrideUrl?: string): Promise<MiyoHealthResponse | null> {
    try {
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
   * A 409 is success only after Miyo confirms the requested absolute path is registered;
   * overlapping folders and duplicate names throw. https://github.com/Brevilabs/obsidian-copilot-private/issues/402
   *
   * @param request - Folder registration body; `path` must be absolute.
   * @param overrideUrl - Explicit base URL (from settings) or empty for discovery.
   * @param beforeRequest - Invoked once the URL and credentials are resolved and immediately
   *   before the request goes out; throw from it to call the registration off.
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
      const url = this.buildUrl(baseUrl, "/v0/folder");
      const headers = await this.buildHeaders();
      const body = JSON.stringify(request);
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
      // Overlap and duplicate-name conflicts do not register this vault.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/402
      if (response.status === 409) {
        try {
          url.searchParams.set("path", request.path);
          // requestUrl cannot be aborted; a stalled lookup must still release setup
          // and report the original conflict instead of leaving the modal busy.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/402
          const registration = await withTimeout(
            async () =>
              requestUrl({
                url: url.toString(),
                method: "GET",
                headers,
                throw: false,
              }),
            8000,
            "Miyo folder conflict verification"
          );
          if (registration.status === 200) return null;
        } catch {
          // A failed lookup must preserve the original registration conflict.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/402
        }
      }
    } catch (error) {
      logWarn(`Miyo add-folder request failed: ${err2String(error)}`);
      throw error;
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

  public async checkFolderRegistration(
    folderName: string,
    overrideUrl?: string
  ): Promise<MiyoFolderRegistration> {
    try {
      const baseUrl = await this.resolveBaseUrl(overrideUrl);
      if (!baseUrl) {
        return "error";
      }
      const url = this.buildUrl(baseUrl, "/v0/folder");
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

  public async search(
    baseUrl: string,
    folderName: string | undefined,
    query: string,
    limit: number,
    filters?: MiyoSearchFilter[],
    paths?: string[]
  ): Promise<MiyoSearchResponse> {
    const payload = {
      query,
      ...(folderName ? { folder_name: folderName } : {}),
      limit,
      ...(filters && filters.length > 0 ? { filters } : {}),
      // An empty list is omitted so a call with no path filter sends the same body as before.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/527
      ...(paths && paths.length > 0 ? { paths } : {}),
    };
    if (getSettings().debug) {
      logInfo("Miyo search request:", { baseUrl, payload });
    }
    return this.requestJson<MiyoSearchResponse>(baseUrl, "/v0/search", {
      method: "POST",
      body: payload,
    });
  }

  public async searchRelated(
    baseUrl: string,
    filePath: string,
    options?: {
      folderName?: string;
      limit?: number;
      filters?: MiyoSearchFilter[];
    }
  ): Promise<MiyoRelatedSearchResponse> {
    // Old Miyo installations must keep serving note recommendations during client upgrades.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
    if (options?.folderName) {
      try {
        const response = await this.recommend(baseUrl, {
          folder_name: options.folderName,
          file_paths: [filePath],
          limit: options.limit ?? 10,
          filters: options.filters,
        });
        if (response.status === "no_usable_context") {
          throw new MiyoRequestError(404, "No indexed context for source file");
        }
        return response;
      } catch (error) {
        if (
          !(error instanceof MiyoRequestError) ||
          error.status !== 501 ||
          error.errorCode !== "not_implemented"
        )
          throw error;
      }
    }
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

  public async recommend(
    baseUrl: string,
    request: RelatedContextRequest
  ): Promise<RelatedContextResponse> {
    try {
      return await this.requestJson<RelatedContextResponse>(baseUrl, "/v0/recommend", {
        method: "POST",
        body: request,
        sensitive: true,
      });
    } catch (error) {
      // Gateways may translate an old Miyo's missing route into 404. Confirm Miyo
      // is reachable before offering compatibility fallback instead of connection recovery.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
      if (
        error instanceof MiyoRequestError &&
        error.status === 404 &&
        (await this.fetchHealth(baseUrl))?.status === "ok"
      ) {
        throw new MiyoRequestError(501, "Recommendations are unsupported", "not_implemented");
      }
      throw error;
    }
  }

  public async fileStatus(baseUrl: string, filePath: string): Promise<MiyoFileStatusResponse> {
    return this.requestJson<MiyoFileStatusResponse>(baseUrl, "/v0/folder/file-status", {
      method: "GET",
      query: { file_path: filePath },
    });
  }

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

  private async buildHeaders(): Promise<Record<string, string>> {
    const settings = this.authSnapshot ?? getSettings();
    const headers: Record<string, string> = {};

    const licenseKey = settings.plusLicenseKey;
    if (licenseKey) {
      headers.Authorization = `Bearer ${licenseKey}`;
    }

    return headers;
  }

  private buildUrl(baseUrl: string, path: string): URL {
    // Reverse proxies can mount Miyo below a path; root-relative resolution
    // would send requests to another service on the same host.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/466
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
    url.search = "";
    url.hash = "";
    return url;
  }

  private async requestJson<T>(
    baseUrl: string,
    path: string,
    options: {
      method: "GET" | "POST";
      body?: unknown;
      sensitive?: boolean;
      query?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<T> {
    const url = this.buildUrl(baseUrl, path);
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
      ...(getSettings().debug && options.method === "POST" && !options.sensitive
        ? { postBody: options.body }
        : {}),
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
      const errorPayload = this.parseResponseJson<{
        detail?: string;
        error?: string;
        code?: string;
      }>(response.json, response.text, options.sensitive);
      // Never retain server echoes of private conversation content.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
      const errorText = options.sensitive
        ? "Chat-context retrieval failed"
        : errorPayload?.detail || response.text || errorPayload?.error || "";
      logWarn(`Miyo request failed (${response.status}): ${errorText}`);
      // Relevant Notes must distinguish an unindexed source from a service
      // outage without parsing human-readable error messages.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      throw new MiyoRequestError(
        response.status,
        errorText,
        errorPayload?.code ?? errorPayload?.error
      );
    }

    const parsed = this.parseResponseJson<T>(response.json, response.text, options.sensitive);
    if (getSettings().debug) {
      logInfo(`Miyo request ${options.method} ${url.toString()} succeeded`);
    }
    return parsed;
  }

  private parseResponseJson<T>(json: unknown, text?: string, sensitive = false): T {
    if (typeof json === "string") {
      try {
        return JSON.parse(json) as T;
      } catch (error) {
        logError(
          sensitive
            ? "Invalid Miyo chat response"
            : `Failed to parse Miyo JSON response: ${err2String(error)}`
        );
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
        logError(
          sensitive
            ? "Invalid Miyo chat response"
            : `Failed to parse Miyo text response: ${err2String(error)}`
        );
        return {} as T;
      }
    }
    return {} as T;
  }
}
