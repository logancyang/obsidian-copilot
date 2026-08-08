/**
 * Shared helper for adapters that verify credentials by issuing a
 * GET against an OpenAI-style `/models` endpoint (or its provider-
 * specific equivalent — Anthropic's `/v1/models`, Google's
 * `/v1beta/models`, Azure's `/openai/deployments`). All four share the
 * same wire-level signal: 2xx means the credentials parse and the
 * caller has read access; 401/403 means the key is wrong; 429 means
 * the key is fine but rate-limited; anything else surfaces as
 * `http_error` with the response body included so adapters whose APIs
 * use 400 for auth failures (Gemini) still give the user a readable
 * signal.
 *
 * Uses `safeFetchNoThrow` so the helper can inspect `response.status`
 * for the 401/403 → `invalid_api_key` mapping without try/catching on
 * `requestUrl`'s default throw-on-4xx behavior.
 *
 * Hard 8s timeout via `Promise.race` because `safeFetch` does not
 * honor `AbortSignal` (see `src/utils.ts` comment). The timeout
 * surfaces as `code: "timeout"` so callers can distinguish a slow
 * upstream from a connection refused (`code: "network"`).
 */

import { safeFetchNoThrow } from "@/utils";
import type { VerificationResult } from "@/modelManagement/types/runtime";

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_CHARS = 200;

class TimeoutError extends Error {}

export interface VerifyViaListModelsOptions {
  /** Overrides the 8s default. Tests pass a tiny value to force the
   *  timeout branch. */
  timeoutMs?: number;
}

export async function verifyViaListModels(
  url: string,
  headers: Record<string, string>,
  opts: VerifyViaListModelsOptions = {}
): Promise<VerificationResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let timer: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new TimeoutError(`Timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    const response = await Promise.race([
      safeFetchNoThrow(url, { method: "GET", headers }),
      timeoutPromise,
    ]);
    return await mapResponse(response);
  } catch (err) {
    return {
      ok: false,
      code: err instanceof TimeoutError ? "timeout" : "network",
      message: err instanceof Error ? err.message : String(err),
      checkedAt: Date.now(),
    };
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

async function mapResponse(response: Response): Promise<VerificationResult> {
  const { status } = response;
  const checkedAt = Date.now();
  if (status >= 200 && status < 300) {
    return { ok: true, checkedAt };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: "invalid_api_key",
      message: "Authentication failed — check your API key.",
      checkedAt,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: "rate_limited",
      message: "Rate limited — try again in a moment.",
      checkedAt,
    };
  }
  const snippet = await readBodySnippet(response);
  return {
    ok: false,
    code: "http_error",
    message: snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`,
    checkedAt,
  };
}

async function readBodySnippet(response: Response): Promise<string> {
  try {
    const body = (await response.text()).trim();
    return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}…` : body;
  } catch {
    return "";
  }
}
