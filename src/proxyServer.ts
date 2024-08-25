import { ChatModelDisplayNames } from "@/constants";
import { CopilotSettings } from "@/settings/SettingsPage";
import cors from "@koa/cors";
import Koa from "koa";
import proxy from "koa-proxies";

export class ProxyServer {
  private settings: CopilotSettings;
  private debug: boolean;
  private chatPort: number;
  private embeddingPort: number;
  private chatProviderUrl = "";
  private embeddingProviderUrl = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chatServer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private embeddingServer: any;

  private static instance: ProxyServer;

  private constructor(settings: CopilotSettings, chatPort: number, embeddingPort: number) {
    this.settings = settings;
    this.chatPort = chatPort;
    this.embeddingPort = embeddingPort;
    this.debug = settings.debug;
  }

  static getInstance(
    settings: CopilotSettings,
    chatPort: number,
    embeddingPort: number
  ): ProxyServer {
    if (!ProxyServer.instance) {
      ProxyServer.instance = new ProxyServer(settings, chatPort, embeddingPort);
    }
    return ProxyServer.instance;
  }

  getProxyURL(currentModel: string): string {
    if (currentModel === ChatModelDisplayNames.CLAUDE) {
      return "https://api.anthropic.com/";
    } else if (this.settings.useOpenAILocalProxy && this.settings.openAIProxyBaseUrl) {
      return this.settings.openAIProxyBaseUrl;
    }

    return "";
  }

  async startChatProxyServer(proxyBaseUrl: string, rewritePaths = true) {
    await this.stopProxyServer(this.chatServer, this.chatPort, this.chatProviderUrl);
    this.chatServer = await this.startProxyServer(proxyBaseUrl, this.chatPort, rewritePaths);
    this.chatProviderUrl = proxyBaseUrl;
  }

  async startEmbeddingProxyServer(proxyBaseUrl: string, rewritePaths = true) {
    await this.stopProxyServer(this.embeddingServer, this.embeddingPort, this.embeddingProviderUrl);
    this.embeddingServer = await this.startProxyServer(
      proxyBaseUrl,
      this.embeddingPort,
      rewritePaths
    );
    this.embeddingProviderUrl = proxyBaseUrl;
  }

  private async startProxyServer(proxyBaseUrl: string, port: number, rewritePaths = true) {
    if (this.debug) {
      console.log(`Attempting to start proxy server to ${proxyBaseUrl}...`);
    }

    const app = new Koa();
    app.use(cors());

    app.use(
      proxy("/", {
        target: proxyBaseUrl,
        changeOrigin: true,
        logs: false,
        rewrite: rewritePaths ? (path) => path : undefined,
      })
    );

    return new Promise((resolve, reject) => {
      const server = app.listen(port);
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.error(`Proxy server port ${port} is already in use.`);
        } else {
          console.error(`Failed to start proxy server: ${err.message}`);
        }
        reject(err);
      });

      server.on("listening", () => {
        if (this.debug) {
          console.log(`Proxy server running on http://localhost:${port}. Proxy to ${proxyBaseUrl}`);
        }
        resolve(server);
      });
    });
  }

  async stopProxyServer(server: any, port: number, runningUrl: string) {
    if (server) {
      if (this.debug) {
        console.log(`Attempting to stop proxy server proxying to ${runningUrl}...`);
      }
      return new Promise<void>((resolve) => {
        server.close(() => {
          if (this.debug) {
            console.log(`Proxy server on port ${port} stopped.`);
          }
          resolve();
        });
      });
    }
  }

  async stopChatProxyServer() {
    await this.stopProxyServer(this.chatServer, this.chatPort, this.chatProviderUrl);
    this.chatServer = null;
    this.chatProviderUrl = "";
  }

  async stopEmbeddingProxyServer() {
    await this.stopProxyServer(this.embeddingServer, this.embeddingPort, this.embeddingProviderUrl);
    this.embeddingServer = null;
    this.embeddingProviderUrl = "";
  }
}
