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

import {
  fetchWithListModelsTimeout,
  parseModelListResponse,
  type ListModelsResult,
} from "./listModelsHttp";

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
    const result = await parseModelListResponse(response, { listKey: "data", idKey: "id" });
    return result.ok ? result : { ok: false, message: result.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
