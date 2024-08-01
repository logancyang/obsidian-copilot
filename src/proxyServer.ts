import cors from "@koa/cors";
import Koa from "koa";
import proxy from "koa-proxies";
import net from "net";
import { CopilotSettings } from "@/settings/SettingsPage";
import { ChatModelDisplayNames } from "@/constants";

export class ProxyServer {
  private settings: CopilotSettings;
  private debug: boolean;
  private port: number;
  private server?: net.Server;

  constructor(settings: CopilotSettings, port: number) {
    this.settings = settings;
    this.port = port;
    this.debug = settings.debug;
  }

  getProxyURL(currentModel: string): string {
    if (currentModel === ChatModelDisplayNames.CLAUDE) {
      return "https://api.anthropic.com/"
    } else if (this.settings.useOpenAILocalProxy && this.settings.openAIProxyBaseUrl) {
      return `http://localhost:${this.port}`;
    }
    
    return '';
  }

  // Starts a proxy server on localhost that forwards requests to the provided base URL
  // If rewritePaths is true, the proxy will rewrite all paths of the requests to match the base URL
  async startProxyServer(proxyBaseUrl: string, rewritePaths = true) {
    if (this.debug) {
      console.log("Attempting to start proxy server...");
    }

    const app = new Koa();
    app.use(cors());

    // Proxy all requests to the new base URL
    app.use(
      proxy("/", {
        target: proxyBaseUrl,
        changeOrigin: true, 
        logs: this.debug,
        rewrite: rewritePaths ? (path) => path : undefined, 
      }),
    );

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
      if (this.debug) {
        console.log(`Proxy server running on http://localhost:${this.port}`);
      }
    });
  }

  async stopProxyServer() {
    if (this.debug) {
      console.log("Attempting to stop proxy server...");
    }
    if (this.server) {
      this.server.on("close", () => {
        if (this.debug) {
          console.log("Proxy server stopped.");
        }
      })
      this.server.close();
    }
  }
}
