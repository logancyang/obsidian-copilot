import {
  fetchWithListModelsTimeout,
  parseModelListResponse,
  type ListModelsResponseResult,
  type ListModelsResult,
} from "./listModelsHttp";

export type { ListModelsResult } from "./listModelsHttp";

export interface ListOpenAICompatibleModelsOptions {
  apiKey?: string | null;
  openAIOrgId?: string;
  timeoutMs?: number;
}

export async function listOpenAICompatibleModels(
  baseUrl: string,
  opts: ListOpenAICompatibleModelsOptions = {}
): Promise<ListModelsResult> {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter a base URL before fetching models." };
  }
  const base = trimmed.replace(/\/$/, "");

  const headers: Record<string, string> = {};
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
  if (opts.openAIOrgId) headers["OpenAI-Organization"] = opts.openAIOrgId;

  const result = await attempt(base, headers, opts.timeoutMs);
  if (result.ok) return result;

  const looksLikeMissingV1 = result.status === 404 && !/\/v1(\/|$)/.test(base);
  const message = looksLikeMissingV1
    ? `${result.message} If your endpoint serves the OpenAI API under /v1, add it to the base URL.`
    : result.message;
  return { ok: false, message };
}

async function attempt(
  base: string,
  headers: Record<string, string>,
  timeoutMs?: number
): Promise<ListModelsResponseResult> {
  try {
    const response = await fetchWithListModelsTimeout(
      `${base}/models`,
      { method: "GET", headers },
      timeoutMs
    );
    // Self-hosted endpoints report the context they serve, which OpenCode otherwise defaults to 200k.
    // https://github.com/logancyang/obsidian-copilot/issues/3840
    return await parseModelListResponse(response, {
      listKey: "data",
      idKey: "id",
      contextKeys: ["max_model_len", "context_length", "context_window", "max_context_length"],
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
