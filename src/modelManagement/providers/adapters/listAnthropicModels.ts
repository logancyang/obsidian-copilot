/**
 * Lists the model ids Anthropic's `/v1/models` endpoint exposes.
 *
 * Wire shape is `{ data: [{ id, display_name, type, created_at }], …,
 * has_more, first_id, last_id }`. We ignore pagination here — the first
 * page already covers every current Claude model, and the wizard only
 * needs a recent snapshot to feed the picker (catalog enriches the rest).
 *
 * Auth is `x-api-key` + `anthropic-version` headers (the SDK uses the
 * same pair). 401/403 surface as a readable auth message.
 */

import { fetchWithListModelsTimeout, readBodySnippet } from "./listModelsHttp";
import type { ListModelsResult } from "./listOpenAICompatibleModels";

const ANTHROPIC_VERSION = "2023-06-01";

export interface ListAnthropicModelsOptions {
  apiKey?: string | null;
  timeoutMs?: number;
}

export async function listAnthropicModels(
  baseUrl: string,
  opts: ListAnthropicModelsOptions = {}
): Promise<ListModelsResult> {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter a base URL before fetching models." };
  }
  // Tolerate users pasting a versioned base URL (`…/v1`). We append `/v1`
  // ourselves, so duplicating it would 404. Strip the trailing version segment.
  const base = trimmed.replace(/\/$/, "").replace(/\/v1$/, "");

  const headers: Record<string, string> = {
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;

  try {
    const response = await fetchWithListModelsTimeout(
      `${base}/v1/models`,
      { method: "GET", headers },
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

  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    return { ok: false, message: "Endpoint did not return a model list." };
  }

  const seen = new Set<string>();
  const modelIds: string[] = [];
  for (const entry of data) {
    const id = (entry as { id?: unknown })?.id;
    if (typeof id !== "string") continue;
    const trimmedId = id.trim();
    if (!trimmedId || seen.has(trimmedId)) continue;
    seen.add(trimmedId);
    modelIds.push(trimmedId);
  }
  return { ok: true, modelIds };
}
