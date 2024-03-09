import cors from "@koa/cors";
import Koa from "koa";
import proxy from "koa-proxies";
import net from "net";

export class ProxyServer {
  private port: number;
  private server?: net.Server;

  constructor(port: number) {
    this.port = port;
  }

  async startProxyServer(proxyBaseUrl: string) {
    console.log("Attempting to start proxy server...");

    const app = new Koa();
    app.use(cors());
    app.use(proxy("/", { target: proxyBaseUrl, changeOrigin: true }));

    // Create the server and attach error handling for "EADDRINUSE"
    this.server = app.listen(this.port);
    this.server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`Proxy server port ${this.port} is already in use.`);
      } else {
        console.error(`Failed to start proxy server: ${err.message}`);
      }
    });

    this.server.on("listening", () => {
      console.log(`Proxy server running on http://localhost:${this.port}`);
    });
  }

  async stopProxyServer() {
    if (this.server) {
      this.server.close();
    }
  }
}
