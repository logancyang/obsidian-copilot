/**
 * Lists the model ids Google's Generative Language API exposes via
 * `/v1beta/models`.
 *
 * Auth is via `?key=...` query param (the SDK supports header-based
 * auth too but the query-param form is the documented public API).
 * Wire shape is `{ models: [{ name: "models/gemini-2.0-flash",
 * displayName, … }], nextPageToken? }`. We strip the `models/` prefix
 * so the returned ids match the wire form callers configure against
 * (`gemini-2.0-flash`, not `models/gemini-2.0-flash`).
 *
 * Pagination is ignored: the first page covers the current generation;
 * the catalog and manual-add input pick up anything missing.
 */

import {
  fetchWithListModelsTimeout,
  parseModelListResponse,
  type ListModelsResult,
} from "./listModelsHttp";

const MODEL_PREFIX = "models/";

export interface ListGoogleModelsOptions {
  apiKey?: string | null;
  timeoutMs?: number;
}

export async function listGoogleModels(
  baseUrl: string,
  opts: ListGoogleModelsOptions = {}
): Promise<ListModelsResult> {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter a base URL before fetching models." };
  }
  // Tolerate users pasting a versioned base URL (`…/v1beta` or `…/v1`).
  // We append `/v1beta` ourselves, so duplicating it would 404.
  const base = trimmed.replace(/\/$/, "").replace(/\/v1(beta)?$/, "");

  const query = opts.apiKey ? `?key=${encodeURIComponent(opts.apiKey)}` : "";
  const url = `${base}/v1beta/models${query}`;

  try {
    const response = await fetchWithListModelsTimeout(
      url,
      { method: "GET", headers: {} },
      opts.timeoutMs
    );
    const result = await parseModelListResponse(response, {
      listKey: "models",
      idKey: "name",
      normalizeId: (id) => (id.startsWith(MODEL_PREFIX) ? id.slice(MODEL_PREFIX.length) : id),
    });
    return result.ok ? result : { ok: false, message: result.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
