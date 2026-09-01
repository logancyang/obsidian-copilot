/**
 * Lists the model ids an OpenAI-compatible endpoint exposes via its
 * standard `GET /models` route. Used by the BYOK "Add a custom
 * provider" flow to auto-populate the model checklist for Ollama,
 * LM Studio, and arbitrary OpenAI-compatible proxies — the same
 * endpoint `verifyViaListModels` pings, but here we parse the body.
 *
 * The wire shape is OpenAI's `{ data: [{ id }] }`. We tolerate partial
 * payloads (skip entries without a string `id`) and dedupe, since some
 * local runners list the same model under multiple aliases.
 *
 * Missing `/v1`: LM Studio and Ollama serve every OpenAI route under
 * `/v1`, but their UIs display only the bare host — so a pasted base URL
 * routinely misses `/v1` and the request 404s. We don't silently rewrite
 * the URL (the endpoint also has to be right for inference, and other
 * hosts version differently — OpenRouter `/api/v1`, Groq `/openai/v1`).
 * Instead, on a 404 against a URL that lacks `/v1`, we append a hint to
 * the error message so the user can fix the field themselves.
 *
 * Uses `safeFetchNoThrow` so a 4xx/5xx surfaces as a readable message
 * instead of a throw, plus the same hard 8s `Promise.race` timeout as
 * `verifyViaListModels` (safeFetch ignores `AbortSignal`).
 */

import {
  fetchWithListModelsTimeout,
  parseModelListResponse,
  type ListModelsResponseResult,
  type ListModelsResult,
} from "./listModelsHttp";

export type { ListModelsResult } from "./listModelsHttp";

export interface ListOpenAICompatibleModelsOptions {
  apiKey?: string | null;
  /** OpenAI organization id; only meaningful for OpenAI proper. */
  openAIOrgId?: string;
  /** Overrides the 8s default. Tests pass a tiny value to force the
   *  timeout branch. */
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
  if (result.ok) return { ok: true, modelIds: result.modelIds };

  // A 404 on a URL without `/v1` is the bare local-runner case (LM Studio,
  // Ollama serve `/models` only under `/v1`), so nudge the user toward it.
  // We skip already-versioned paths (including OpenRouter `/api/v1`, Groq
  // `/openai/v1`); other failures (auth, timeout, 5xx) aren't a routing issue.
  const looksLikeMissingV1 = result.status === 404 && !/\/v1(\/|$)/.test(base);
  const message = looksLikeMissingV1
    ? `${result.message} If your endpoint serves the OpenAI API under /v1, add it to the base URL.`
    : result.message;
  return { ok: false, message };
}

/** Probes `${base}/models` once, mapping the response to an `AttemptResult`. */
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
    return await parseModelListResponse(response, { listKey: "data", idKey: "id" });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
