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
