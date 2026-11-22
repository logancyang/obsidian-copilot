import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { requestUrl } from "obsidian";

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

export class ServiceUnreachableError extends Error {
  constructor(url: string, cause: unknown) {
    super(`Couldn't reach ${new URL(url).origin}.`, { cause });
    this.name = "ServiceUnreachableError";
  }
}

export const requestUrlFetch: FetchLike = async (url, init) => {
  const href = String(url);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  const contentType = headers["content-type"];
  delete headers["content-type"];
  let response: Awaited<ReturnType<typeof requestUrl>>;
  try {
    response = await requestUrl({
      url: href,
      method: init?.method ?? "GET",
      headers,
      contentType,
      body:
        typeof init?.body === "string" || init?.body instanceof URLSearchParams
          ? init.body.toString()
          : undefined,
      throw: false,
    });
  } catch (error) {
    throw new ServiceUnreachableError(href, error);
  }
  return new Response(NULL_BODY_STATUSES.has(response.status) ? null : response.text, {
    status: response.status,
    headers: response.headers,
  });
};
