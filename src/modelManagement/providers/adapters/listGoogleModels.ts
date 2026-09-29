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
