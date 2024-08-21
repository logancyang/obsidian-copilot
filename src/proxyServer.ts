import { ChatModelDisplayNames } from "@/constants";
import { CopilotSettings } from "@/settings/SettingsPage";
import cors from "@koa/cors";
import Koa from "koa";
import proxy from "koa-proxies";

// There should only be 1 running proxy server at a time so keep it in upper scope
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let server: any;

export class ProxyServer {
  private settings: CopilotSettings;
  private debug: boolean;
  private port: number;
  private runningUrl: string;

  constructor(settings: CopilotSettings, port: number) {
    this.settings = settings;
    this.port = port;
    this.debug = settings.debug;
  }

  getProxyURL(currentModel: string): string {
    if (currentModel === ChatModelDisplayNames.CLAUDE) {
      return "https://api.anthropic.com/";
    } else if (this.settings.useOpenAILocalProxy && this.settings.openAIProxyBaseUrl) {
      return this.settings.openAIProxyBaseUrl;
    }

    return "";
  }

  // Starts a proxy server on localhost that forwards requests to the provided base URL
  // If rewritePaths is true, the proxy will rewrite all paths of the requests to match the base URL
  async startProxyServer(proxyBaseUrl: string, rewritePaths = true) {
    await this.stopProxyServer();

    if (this.debug) {
      console.log(`Attempting to start proxy server to ${proxyBaseUrl}...`);
    }

    const app = new Koa();
    app.use(cors());

    // Proxy all requests to the new base URL
    app.use(
      proxy("/", {
        target: proxyBaseUrl,
        changeOrigin: true,
        logs: false,
        rewrite: rewritePaths ? (path) => path : undefined,
      })
    );

    // Create the server and attach error handling for "EADDRINUSE"
    if (server?.listening) {
      return;
    }
    server = app.listen(this.port);
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`Proxy server port ${this.port} is already in use.`);
      } else {
        console.error(`Failed to start proxy server: ${err.message}`);
      }
    });

    server.on("listening", () => {
      this.runningUrl = proxyBaseUrl;
      if (this.debug) {
        console.log(
          `Proxy server running on http://localhost:${this.port}. Proxy to ${proxyBaseUrl}`
        );
      }
    });
  }

  async stopProxyServer() {
    let waitForClose: Promise<boolean> | boolean = false;
    if (server) {
      if (this.debug) {
        console.log(`Attempting to stop proxy server proxying to ${this.runningUrl}...`);
      }
      waitForClose = new Promise((resolve) => {
        server.on("close", () => {
          this.runningUrl = "";
          if (this.debug) {
            console.log("Proxy server stopped.");
          }
          resolve(true);
        });
        server.close();
      });
    }
    return waitForClose;
  }
}
