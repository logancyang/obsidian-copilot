import { logError } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";

type IncomingMessage = import("node:http").IncomingMessage;
type ServerResponse = import("node:http").ServerResponse;

export type LoopbackRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

export interface LoopbackServer {
  readonly origin: Promise<string>;
  close(): void;
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

export function startLoopbackServer(name: string, handle: LoopbackRequestHandler): LoopbackServer {
  const http = requireNodeModule<typeof import("node:http")>("http");
  const server = http.createServer((request, response) => {
    void handle(request, response);
  });
  let rejectStart: ((error: Error) => void) | null = null;
  const origin = new Promise<string>((resolve, reject) => {
    rejectStart = reject;
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      rejectStart = null;
      server.on("error", (error) => logError(`[Loopback] ${name} failed`, error));
      server.unref();
      const { port } = server.address() as import("node:net").AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  return Object.freeze({
    origin,
    close(): void {
      // Closing before `listening` skips the listen callback, so settle the pending start explicitly.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/165
      rejectStart?.(new Error(`The ${name} is closed.`));
      rejectStart = null;
      server.close();
    },
  });
}

export async function readRequestText(
  request: AsyncIterable<Uint8Array>,
  maxBytes: number
): Promise<string> {
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new RequestBodyTooLargeError();
    body += decoder.decode(chunk, { stream: true });
  }
  return body + decoder.decode();
}

export function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
