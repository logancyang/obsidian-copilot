import { logWarn } from "@/logger";
import type { PairedDevice } from "@/remote/host/PairedDeviceStore";
import {
  encodeClose,
  encodePong,
  encodeText,
  FrameDecoder,
  FrameProtocolError,
} from "@/remote/host/webSocketFrames";
import {
  AUTH_FRAME_MAX_BYTES,
  CLOSE_CODE,
  type ChannelServerFrame,
  type DenyReason,
  parseClientFrame,
  type RemoteChannel,
} from "@/remote/wire";
import { requireNodeModule } from "@/utils/desktopRuntime";

type Duplex = import("node:stream").Duplex;
type HttpRequest = import("node:http").IncomingMessage;
type HttpServer = import("node:http").Server;

export const AUTH_TIMEOUT_MS = 5000;
export const MAX_PENDING_CONNECTIONS = 8;
const MAX_CONNECTIONS = 64;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const CLOSE_GRACE_MS = 1500;
const HANDSHAKE_KEY = /^[A-Za-z0-9+/]{22}==$/;
const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface RemoteConnection extends RemoteChannel {
  readonly deviceId: string;
  readonly deviceName: string;
}

export interface DeviceAuthority {
  authenticate(token: string): PairedDevice | null;
  create(deviceName: string): { device: PairedDevice; token: string };
  markSeen(deviceId: string): void;
}

export interface RemoteServerOptions {
  devices: DeviceAuthority;
  consumePairingSecret: (secret: string) => boolean;
  desktopName: string;
  authTimeoutMs?: number;
  maxPendingConnections?: number;
}

// A peer's close frame may carry no status (1005) or a reserved one; echoing it would be a protocol
// error on the wire. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
function isSendableCloseCode(code: number): boolean {
  return (
    (code >= 1000 && code <= 1003) ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999)
  );
}

class SocketPeer {
  readonly decoder = new FrameDecoder(AUTH_FRAME_MAX_BYTES);
  onText: (text: string) => void = () => {};
  onClosed: (code: number) => void = () => {};
  private closing = false;
  private finished = false;
  private graceTimer: number | undefined;

  constructor(private readonly socket: Duplex) {
    socket.on("data", (chunk: Uint8Array) => this.receive(chunk));
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      window.clearTimeout(this.graceTimer);
      this.finish(1006);
    });
  }

  receive(chunk: Uint8Array): void {
    if (this.closing) return;
    try {
      for (const message of this.decoder.push(chunk)) {
        if (this.closing) return;
        if (message.type === "text") this.onText(message.text);
        else if (message.type === "ping") this.write(encodePong(message.payload));
        else if (message.type === "close") this.close(message.code);
      }
    } catch (error) {
      this.close(error instanceof FrameProtocolError ? error.closeCode : 1011);
    }
  }

  send(text: string): void {
    if (!this.closing) this.write(encodeText(text));
  }

  close(code: number): void {
    if (this.closing) return;
    this.closing = true;
    this.write(encodeClose(isSendableCloseCode(code) ? code : 1000));
    this.socket.end();
    this.graceTimer = window.setTimeout(() => this.socket.destroy(), CLOSE_GRACE_MS);
    this.finish(code);
  }

  private write(bytes: Uint8Array): void {
    if (this.socket.writable) this.socket.write(bytes);
  }

  private finish(code: number): void {
    if (this.finished) return;
    this.finished = true;
    this.onClosed(code);
  }
}

export class RemoteServer {
  private server: HttpServer | null = null;
  private pending = 0;
  private readonly connectionHandlers = new Set<(connection: RemoteConnection) => void>();
  private readonly changeListeners = new Set<() => void>();
  private readonly peers = new Set<SocketPeer>();
  private readonly peersByDevice = new Map<string, Set<SocketPeer>>();

  constructor(private readonly options: RemoteServerOptions) {}

  listen(host: string, port: number): Promise<number> {
    const http = requireNodeModule<typeof import("node:http")>("http");
    return new Promise((resolve, reject) => {
      const server = http.createServer((_request, response) => {
        response.writeHead(426, { Upgrade: "websocket", "Content-Length": "0" });
        response.end();
      });
      server.maxConnections = MAX_CONNECTIONS;
      server.headersTimeout = this.options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
      server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
      server.on("clientError", (_error, socket) => socket.destroy());
      const onStartupError = (error: Error): void => reject(error);
      server.once("error", onStartupError);
      server.listen({ host, port }, () => {
        server.off("error", onStartupError);
        server.on("error", (error) => logWarn("Remote server error", error.message));
        this.server = server;
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : port);
      });
    });
  }

  close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    for (const peer of [...this.peers]) peer.close(CLOSE_CODE.serverStopping);
    return new Promise((resolve) => {
      server.close(() => resolve());
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }

  onConnection(handler: (connection: RemoteConnection) => void): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  onConnectionsChanged(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  isDeviceConnected(deviceId: string): boolean {
    return (this.peersByDevice.get(deviceId)?.size ?? 0) > 0;
  }

  disconnectDevice(deviceId: string): void {
    for (const peer of [...(this.peersByDevice.get(deviceId) ?? [])]) {
      peer.close(CLOSE_CODE.revoked);
    }
  }

  private handleUpgrade(request: HttpRequest, socket: Duplex, head: Buffer): void {
    const key = request.headers["sec-websocket-key"];
    const isValidHandshake =
      request.method === "GET" &&
      request.headers.upgrade?.toLowerCase() === "websocket" &&
      request.headers["sec-websocket-version"] === "13" &&
      typeof key === "string" &&
      HANDSHAKE_KEY.test(key);
    if (!isValidHandshake) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (this.pending >= (this.options.maxPendingConnections ?? MAX_PENDING_CONNECTIONS)) {
      socket.end(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
      );
      return;
    }

    const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
    const accept = crypto
      .createHash("sha1")
      .update(key + HANDSHAKE_GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const peer = new SocketPeer(socket);
    this.peers.add(peer);
    this.pending += 1;
    let holdsPendingSlot = true;
    const releasePendingSlot = (): void => {
      if (!holdsPendingSlot) return;
      holdsPendingSlot = false;
      this.pending -= 1;
    };
    const timer = window.setTimeout(
      () => peer.close(CLOSE_CODE.authTimeout),
      this.options.authTimeoutMs ?? AUTH_TIMEOUT_MS
    );
    peer.onClosed = () => {
      window.clearTimeout(timer);
      releasePendingSlot();
      this.peers.delete(peer);
    };
    peer.onText = (text) => {
      window.clearTimeout(timer);
      releasePendingSlot();
      const device = this.authenticateFirstFrame(peer, text);
      if (device) this.admit(peer, device);
    };
    if (head.length > 0) peer.receive(new Uint8Array(head));
  }

  private authenticateFirstFrame(peer: SocketPeer, text: string): PairedDevice | null {
    const frame = parseClientFrame(text);
    if (!frame) return this.deny(peer, "bad-request");
    try {
      if (frame.type === "auth") {
        const device = this.options.devices.authenticate(frame.token);
        if (!device) return this.deny(peer, "token-rejected");
        this.sendFrame(peer, { type: "authed", deviceId: device.id });
        return device;
      }
      if (!this.options.consumePairingSecret(frame.secret)) {
        return this.deny(peer, "pairing-rejected");
      }
      const { device, token } = this.options.devices.create(frame.deviceName);
      this.sendFrame(peer, {
        type: "paired",
        token,
        deviceId: device.id,
        desktopName: this.options.desktopName,
      });
      return device;
    } catch (error) {
      logWarn("Remote authentication failed", error instanceof Error ? error.message : "unknown");
      return this.deny(peer, "bad-request");
    }
  }

  private deny(peer: SocketPeer, reason: DenyReason): null {
    this.sendFrame(peer, { type: "denied", reason });
    peer.close(CLOSE_CODE.denied);
    return null;
  }

  private sendFrame(peer: SocketPeer, frame: ChannelServerFrame): void {
    peer.send(JSON.stringify(frame));
  }

  private admit(peer: SocketPeer, device: PairedDevice): void {
    const devicePeers = this.peersByDevice.get(device.id) ?? new Set<SocketPeer>();
    devicePeers.add(peer);
    this.peersByDevice.set(device.id, devicePeers);
    this.options.devices.markSeen(device.id);
    peer.decoder.limit = MAX_MESSAGE_BYTES;

    const messageHandlers = new Set<(text: string) => void>();
    const closeHandlers = new Set<(event: { code: number }) => void>();
    peer.onText = (text) => {
      for (const handler of [...messageHandlers]) handler(text);
    };
    const releaseSlot = peer.onClosed;
    peer.onClosed = (code) => {
      releaseSlot(code);
      devicePeers.delete(peer);
      if (devicePeers.size === 0) this.peersByDevice.delete(device.id);
      this.options.devices.markSeen(device.id);
      for (const handler of [...closeHandlers]) handler({ code });
      this.notifyChanged();
    };

    const connection: RemoteConnection = {
      deviceId: device.id,
      deviceName: device.name,
      send: (text) => peer.send(text),
      onMessage(handler) {
        messageHandlers.add(handler);
        return () => messageHandlers.delete(handler);
      },
      onClose(handler) {
        closeHandlers.add(handler);
        return () => closeHandlers.delete(handler);
      },
      close: (code) => peer.close(code ?? CLOSE_CODE.serverStopping),
    };
    this.notifyChanged();
    for (const handler of [...this.connectionHandlers]) handler(connection);
  }

  private notifyChanged(): void {
    for (const listener of [...this.changeListeners]) listener();
  }
}
