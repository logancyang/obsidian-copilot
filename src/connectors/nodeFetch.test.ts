/**
 * @jest-environment node
 */
import { nodeFetch } from "@/connectors/nodeFetch";
import { ServiceUnreachableError } from "@/connectors/oauth/requestUrlFetch";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string): unknown => jest.requireActual(`node:${id}`),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/857";

interface Received {
  method?: string;
  url?: string;
  headers: IncomingMessage["headers"];
  body: string;
}

async function serve(
  handle: (request: IncomingMessage, response: ServerResponse, received: Received) => void
): Promise<{
  origin: string;
  received: Received[];
  closed: Promise<void>;
  stop: () => Promise<void>;
}> {
  const received: Received[] = [];
  const sockets = new Set<Socket>();
  let markClosed = () => {};
  const closed = new Promise<void>((resolve) => (markClosed = resolve));
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const entry = { method: request.method, url: request.url, headers: request.headers, body };
      received.push(entry);
      response.on("close", markClosed);
      handle(request, response, entry);
    });
  });
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const stop = () => {
    sockets.forEach((socket) => socket.destroy());
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { origin: `http://127.0.0.1:${port}`, received, closed, stop };
}

describe("nodeFetch", () => {
  describe("nodeFetch()", () => {
    let stop: (() => Promise<void>) | undefined;
    afterEach(async () => {
      await stop?.();
      stop = undefined;
    });

    it("sends the method, headers and body, and returns the service's status, headers and body", async () => {
      const service = await serve((_request, response) => {
        response.writeHead(201, { "content-type": "application/json", "mcp-session-id": "s-1" });
        response.end('{"ok":true}');
      });
      stop = service.stop;

      const response = await nodeFetch(`${service.origin}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer t-1", "content-type": "application/json" },
        body: '{"jsonrpc":"2.0"}',
      });

      expect(service.received[0]).toMatchObject({
        method: "POST",
        url: "/mcp",
        headers: { authorization: "Bearer t-1", "content-type": "application/json" },
        body: '{"jsonrpc":"2.0"}',
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("mcp-session-id")).toBe("s-1");
      await expect(response.json()).resolves.toEqual({ ok: true });
    });

    it(`${ISSUE} hands over each part of a reply the service keeps open, and closes the connection when the reader stops`, async () => {
      const service = await serve((_request, response) => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: first\n\n");
      });
      stop = service.stop;

      const response = await nodeFetch(`${service.origin}/mcp`, { method: "POST", body: "{}" });
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const { value } = await reader.read();
      await reader.cancel();

      expect(new TextDecoder().decode(value)).toBe("data: first\n\n");
      await expect(service.closed).resolves.toBeUndefined();
    });

    it(`${ISSUE} returns a redirect as it is instead of following it with the login token`, async () => {
      const service = await serve((request, response) => {
        response.writeHead(307, { location: "/elsewhere" });
        response.end();
      });
      stop = service.stop;

      const response = await nodeFetch(`${service.origin}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer t-1" },
        body: "{}",
      });

      expect(response.status).toBe(307);
      expect(service.received.map(({ url }) => url)).toEqual(["/mcp"]);
    });

    it("rejects with ServiceUnreachableError when nothing answers", async () => {
      const service = await serve(() => {});
      await service.stop();

      await expect(nodeFetch(`${service.origin}/mcp`)).rejects.toBeInstanceOf(
        ServiceUnreachableError
      );
    });
  });
});
