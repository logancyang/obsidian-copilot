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

import { fetchWithListModelsTimeout, readBodySnippet } from "./listModelsHttp";
import type { ListModelsResult } from "./listOpenAICompatibleModels";

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
    return await mapResponse(response);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function mapResponse(response: Response): Promise<ListModelsResult> {
  const { status } = response;
  if (status === 401 || status === 403) {
    return { ok: false, message: "Authentication failed — check your API key." };
  }
  if (status < 200 || status >= 300) {
    const snippet = await readBodySnippet(response);
    return { ok: false, message: snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: "Endpoint returned an unreadable response." };
  }

  const models = (payload as { models?: unknown })?.models;
  if (!Array.isArray(models)) {
    return { ok: false, message: "Endpoint did not return a model list." };
  }

  const seen = new Set<string>();
  const modelIds: string[] = [];
  for (const entry of models) {
    const name = (entry as { name?: unknown })?.name;
    if (typeof name !== "string") continue;
    const trimmed = name.trim();
    if (!trimmed) continue;
    const id = trimmed.startsWith(MODEL_PREFIX) ? trimmed.slice(MODEL_PREFIX.length) : trimmed;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    modelIds.push(id);
  }
  return { ok: true, modelIds };
}
