import { ServiceUnreachableError } from "@/connectors/oauth/requestUrlFetch";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

// requestUrl hands over a reply only after the service closes it, and some services keep a reply's event stream open; it also follows redirects to other origins with the login token.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/857
export const nodeFetch: FetchLike = (url, init) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const http = requireNodeModule<typeof import("node:http")>(
      target.protocol === "http:" ? "http" : "https"
    );
    const request = http.request(
      target,
      { method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers)) },
      (response) => {
        const status = response.statusCode ?? 0;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            response.on("data", (chunk: Uint8Array) => controller.enqueue(new Uint8Array(chunk)));
            response.on("end", () => controller.close());
            response.on("error", (error) => controller.error(error));
          },
          cancel: () => {
            request.destroy();
          },
        });
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers.set(name, String(value));
        }
        resolve(new Response(NULL_BODY_STATUSES.has(status) ? null : body, { status, headers }));
      }
    );
    // The MCP SDK closes a connector's client by aborting its requests, event streams a service holds open included.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
    init?.signal?.addEventListener("abort", () => request.destroy(), { once: true });
    request.on("error", (error) => reject(new ServiceUnreachableError(target.href, error)));
    request.end(typeof init?.body === "string" ? init.body : undefined);
  });
