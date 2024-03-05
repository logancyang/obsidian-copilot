import cors from '@koa/cors';
import Koa from 'koa';
import proxy from 'koa-proxies';
import net from 'net';

export class ProxyServer {
  private port: number;
  private server?: net.Server;

  constructor(port: number) {
    this.port = port;
  }

  async startProxyServer(proxyBaseUrl: string) {
    console.log('loading plugin');
    // check if the port is already in use
    const inUse = await this.checkPortInUse(this.port);

    if (!inUse) {
      // Create a new Koa application
      const app = new Koa();

      app.use(cors());

      // Create and apply the proxy middleware
      app.use(proxy('/', {
        // your target API, e.g. https://api.anthropic.com/
        target: proxyBaseUrl,
        changeOrigin: true,
      }));

      // Start the server on the specified port
      this.server = app.listen(this.port);
      console.log(`Proxy server running on http://localhost:${this.port}`);
    } else {
      console.error(`Port ${this.port} is in use`);
    }
  }

  async stopProxyServer() {
    if (this.server) {
      this.server.close();
    }
  }

  checkPortInUse(port: number) {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
        .once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            resolve(true);  // Port is in use
          } else {
            reject(err);
          }
        })
        .once('listening', () => {
          server.once('close', () => {
            resolve(false);  // Port is not in use
          })
          .close();
        })
        .listen(port);
    });
  }
}