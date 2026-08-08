/**
 * Shared scaffolding for `list*Models` adapters.
 *
 * Each adapter (Anthropic, Google, OpenAI-compatible) does the same
 * three-step probe: `safeFetchNoThrow` against a versioned URL with a
 * hard `Promise.race` timeout (because `safeFetch` ignores AbortSignal),
 * then truncate the response body for a readable error message. This
 * module owns the timeout dance and the body-snippet helper so the
 * adapters can focus on their wire-format differences.
 */

import { safeFetchNoThrow } from "@/utils";

export const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_CHARS = 200;

export class ListModelsTimeoutError extends Error {
  override readonly name = "ListModelsTimeoutError";
}

/**
 * `safeFetchNoThrow` ignores `AbortSignal`, so we race a `setTimeout`
 * against it. Resolves with the `Response`; rejects with
 * `ListModelsTimeoutError` if the deadline trips first.
 */
export async function fetchWithListModelsTimeout(
  url: string,
  init: { method?: string; headers?: Record<string, string> },
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  let timer: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new ListModelsTimeoutError(`Timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([safeFetchNoThrow(url, init), timeoutPromise]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

/** Read up to ~200 chars of the response body for an inline error
 *  message. Returns "" on any failure (network closed, non-text body). */
export async function readBodySnippet(response: Response): Promise<string> {
  try {
    const body = (await response.text()).trim();
    return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}…` : body;
  } catch {
    return "";
  }
}
