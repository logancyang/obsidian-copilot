import { logWarn } from "@/logger";
import type { PairedDevice } from "@/remote/host/PairedDeviceStore";
import {
  encodeClose,
  encodePong,
  encodeText,
  FrameDecoder,
  FrameProtocolError,
  isValidCloseCode,
  type IncomingMessage,
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
const MAX_UNAUTHENTICATED_PER_ADDRESS = 4;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
// A phone that stops reading (out of range, Tailscale dropped) leaves TCP open for minutes while
// the desktop keeps streaming, so a peer whose unsent backlog passes this is dropped. It has to
// exceed the largest frame the session protocol sends, which is checked before it is queued.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
const MAX_WRITE_BACKLOG_BYTES = 64 * 1024 * 1024;
const CLOSE_GRACE_MS = 1500;
const HANDSHAKE_KEY = /^[A-Za-z0-9+/]{22}==$/;
const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface RemoteConnection extends RemoteChannel {
  readonly deviceId: string;
  readonly deviceName: string;
}

export interface DeviceAuthority {
  authenticate(token: string): PairedDevice | null;
  create(
    deviceName: string,
    clientId?: string
  ): { device: PairedDevice; token: string; replacedDeviceIds: readonly string[] };
  markSeen(deviceId: string): void;
}

export interface RemoteServerOptions {
  devices: DeviceAuthority;
  consumePairingSecret: (secret: string) => boolean;
  desktopName: string;
  authTimeoutMs?: number;
  maxPendingConnections?: number;
  maxUnauthenticatedPerAddress?: number;
  maxWriteBacklogBytes?: number;
}

class SocketPeer {
  readonly decoder = new FrameDecoder(AUTH_FRAME_MAX_BYTES);
  onText: (text: string) => void = () => {};
  onClosed: (code: number) => void = () => {};
  private closing = false;
  private finished = false;
  private graceTimer: number | undefined;

  constructor(
    readonly socket: Duplex,
    private readonly maxWriteBacklogBytes: number
  ) {
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
      this.decoder.push(chunk, (message) => this.dispatch(message));
    } catch (error) {
      this.close(error instanceof FrameProtocolError ? error.closeCode : 1011);
    }
  }

  private dispatch(message: IncomingMessage): void {
    if (this.closing) return;
    switch (message.type) {
      case "text":
        this.onText(message.text);
        break;
      case "ping":
        // A pong is optional when several pings are outstanding (RFC 6455 section 5.5.3). Answering
        // only while nothing waits to be written keeps a peer that pings without reading from
        // growing this process's memory. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
        if (this.socket.writableLength === 0) this.write(encodePong(message.payload));
        break;
      case "close":
        this.close(message.code);
        break;
      case "pong":
        break;
    }
  }

  send(text: string): void {
    if (this.closing) return;
    if (this.socket.writableLength > this.maxWriteBacklogBytes) {
      this.socket.destroy();
      return;
    }
    this.write(encodeText(text));
  }

  close(code: number): void {
    if (this.closing) return;
    this.closing = true;
    // A peer's close frame may carry no status (1005) or a reserved one, and echoing it would be a
    // protocol error on the wire. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
    this.write(encodeClose(isValidCloseCode(code) ? code : 1000));
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
  private starting: Promise<number> | null = null;
  private pending = 0;
  private readonly unauthenticatedByAddress = new Map<string, number>();
  private readonly releaseUnauthenticated = new WeakMap<Duplex, () => void>();
  private readonly handshakeTimers = new WeakMap<Duplex, number>();
  private readonly connectionHandlers = new Set<(connection: RemoteConnection) => void>();
  private readonly changeListeners = new Set<() => void>();
  private readonly peers = new Set<SocketPeer>();
  private readonly peersByDevice = new Map<string, Set<SocketPeer>>();

  constructor(private readonly options: RemoteServerOptions) {}

  listen(host: string, port: number): Promise<number> {
    const http = requireNodeModule<typeof import("node:http")>("http");
    const authTimeoutMs = this.options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
    const starting = new Promise<number>((resolve, reject) => {
      const server = http.createServer((_request, response) => {
        response.writeHead(426, {
          Upgrade: "websocket",
          Connection: "close",
          "Content-Length": "0",
        });
        response.end();
      });
      server.maxConnections = MAX_CONNECTIONS;
      server.headersTimeout = authTimeoutMs;
      server.on("connection", (socket) => this.admitSocket(socket, authTimeoutMs));
      server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
      server.on("clientError", (_error, socket) => socket.destroy());
      const onStartupError = (error: Error): void => {
        if (this.server === server) this.server = null;
        reject(error);
      };
      server.once("error", onStartupError);
      this.server = server;
      server.listen({ host, port }, () => {
        server.off("error", onStartupError);
        server.on("error", (error) => logWarn("Remote server error", error.message));
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : port);
      });
    });
    this.starting = starting;
    return starting;
  }

  // close() may run while listen() is still binding, and the bind would then outlive the close.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/610
  async close(): Promise<void> {
    await this.starting?.catch(() => 0);
    this.starting = null;
    const server = this.server;
    this.server = null;
    if (!server) return;
    for (const peer of [...this.peers]) peer.close(CLOSE_CODE.serverStopping);
    await new Promise<void>((resolve) => {
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

  // Every connection has the authentication window to finish its handshake and first frame, however
  // slowly it sends, and one address may hold only a few unauthenticated connections so a single
  // peer cannot occupy every slot. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
  private admitSocket(socket: Duplex, authTimeoutMs: number): void {
    const address = (socket as Partial<{ remoteAddress: string }>).remoteAddress ?? "";
    const held = this.unauthenticatedByAddress.get(address) ?? 0;
    if (held >= (this.options.maxUnauthenticatedPerAddress ?? MAX_UNAUTHENTICATED_PER_ADDRESS)) {
      socket.destroy();
      return;
    }
    this.unauthenticatedByAddress.set(address, held + 1);
    const release = (): void => {
      if (!this.releaseUnauthenticated.delete(socket)) return;
      const remaining = (this.unauthenticatedByAddress.get(address) ?? 1) - 1;
      if (remaining > 0) this.unauthenticatedByAddress.set(address, remaining);
      else this.unauthenticatedByAddress.delete(address);
    };
    this.releaseUnauthenticated.set(socket, release);
    this.handshakeTimers.set(
      socket,
      window.setTimeout(() => socket.destroy(), authTimeoutMs)
    );
    socket.once("close", () => {
      window.clearTimeout(this.handshakeTimers.get(socket));
      release();
    });
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

    window.clearTimeout(this.handshakeTimers.get(socket));
    const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
    const accept = crypto
      .createHash("sha1")
      .update(key + HANDSHAKE_GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const peer = new SocketPeer(
      socket,
      this.options.maxWriteBacklogBytes ?? MAX_WRITE_BACKLOG_BYTES
    );
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
      const { device, token, replacedDeviceIds } = this.options.devices.create(
        frame.deviceName,
        frame.clientId
      );
      for (const replacedId of replacedDeviceIds) this.disconnectDevice(replacedId);
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
    this.releaseUnauthenticated.get(peer.socket)?.();
    this.recordSeen(device.id);
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
      this.recordSeen(device.id);
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

  // The last-seen time is informational, so a failed save must not drop a valid connection or skip
  // the cleanup that follows it. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
  private recordSeen(deviceId: string): void {
    try {
      this.options.devices.markSeen(deviceId);
    } catch (error) {
      logWarn(
        "Remote device last-seen time not saved",
        error instanceof Error ? error.message : "unknown"
      );
    }
  }

  private notifyChanged(): void {
    for (const listener of [...this.changeListeners]) listener();
  }
}
