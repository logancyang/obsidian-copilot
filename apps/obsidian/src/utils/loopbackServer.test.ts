import { Readable } from "node:stream";
import {
  readRequestText,
  RequestBodyTooLargeError,
  startLoopbackServer,
  writeJson,
  type LoopbackRequestHandler,
  type LoopbackServer,
} from "./loopbackServer";

jest.mock("@/logger", () => ({ logError: jest.fn() }));

type ServerResponse = import("node:http").ServerResponse;

function get(url: string): Promise<{ status: number; body: string }> {
  const http = jest.requireActual<typeof import("node:http")>("node:http");
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

describe("loopbackServer", () => {
  describe("startLoopbackServer()", () => {
    const servers: LoopbackServer[] = [];

    function start(handle: LoopbackRequestHandler): LoopbackServer {
      const server = startLoopbackServer("test server", handle);
      servers.push(server);
      return server;
    }

    afterEach(() => {
      for (const server of servers) server.close();
      servers.length = 0;
    });

    it("serves requests on 127.0.0.1 through the given handler", async () => {
      const server = start(async (request, response) => {
        writeJson(response, 200, { path: request.url });
      });

      const origin = await server.origin;

      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await expect(get(`${origin}/hello`)).resolves.toEqual({
        status: 200,
        body: JSON.stringify({ path: "/hello" }),
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 rejects its origin when closed before it finishes listening", async () => {
      const server = start(jest.fn());

      server.close();

      await expect(server.origin).rejects.toThrow("The test server is closed.");
    });

    it("stops accepting requests once closed", async () => {
      const server = start(async (_request, response) => writeJson(response, 200, {}));
      const origin = await server.origin;

      server.close();

      await expect(get(origin)).rejects.toThrow();
    });
  });

  describe("readRequestText()", () => {
    it("decodes a UTF-8 body whose characters are split across chunks", async () => {
      const bytes = new TextEncoder().encode("日本語 ✅");

      await expect(
        readRequestText(Readable.from([bytes.slice(0, 4), bytes.slice(4)]), 1024)
      ).resolves.toBe("日本語 ✅");
    });

    it("rejects a body over the byte limit even when it has fewer characters than the limit", async () => {
      const bytes = new TextEncoder().encode("日".repeat(4));

      await expect(readRequestText(Readable.from([bytes]), 10)).rejects.toBeInstanceOf(
        RequestBodyTooLargeError
      );
    });
  });

  describe("writeJson()", () => {
    it("writes the status, a UTF-8 JSON content type and the serialized body", () => {
      const response = { writeHead: jest.fn(), end: jest.fn() };

      writeJson(response as unknown as ServerResponse, 201, { ok: true });

      expect(response.writeHead).toHaveBeenCalledWith(201, {
        "Content-Type": "application/json; charset=utf-8",
      });
      expect(response.end).toHaveBeenCalledWith('{"ok":true}');
    });
  });
});
