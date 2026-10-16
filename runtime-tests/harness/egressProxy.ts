import * as http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A loopback HTTP proxy that refuses every request and records where it was
 * going. The runtime is pointed at it through `HTTP_PROXY`/`HTTPS_PROXY`
 * (loopback excluded), so an attempt to reach the network — a catalog fetch, a
 * package install, hosted inference — is blocked and shows up as a named
 * destination instead of leaving the machine.
 */
export class EgressProxy {
  #server: http.Server | null = null;
  #port = 0;
  readonly #attempts: string[] = [];

  /** Proxy URL for `HTTP_PROXY` / `HTTPS_PROXY`. */
  get url(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  /** Refused requests in arrival order: `host:port` for HTTPS, the URL for HTTP. */
  get attempts(): readonly string[] {
    return this.#attempts;
  }

  async start(): Promise<void> {
    const server = http.createServer((req, res) => {
      this.#attempts.push(req.url ?? "");
      res.writeHead(403, { connection: "close" }).end();
    });
    server.on("connect", (req: http.IncomingMessage, socket) => {
      this.#attempts.push(req.url ?? "");
      socket.on("error", () => {});
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    this.#server = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.#port = (server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
