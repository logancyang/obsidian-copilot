import WebSocket from "ws";
import type { ClientFrame } from "@/agentMode/protocol/frames";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { ClientTransport } from "@/agentMode/protocol/transport";
import {
  RemoteSessionTransport,
  type VisibilitySource,
} from "@/agentMode/mobile/RemoteSessionTransport";
import { buildHost, FakeManager } from "@/agentMode/session/host/hostTestHarness";
import { serveRemoteConnection } from "@/agentMode/session/host/serveRemoteConnection";
import type { SessionHost, SessionHostOptions } from "@/agentMode/session/host/SessionHost";
import type { SocketLike } from "@/remote/channel";
import { PairedDesktopStore, type PairedDesktop } from "@/remote/client/PairedDesktopStore";
import { RemoteClient } from "@/remote/client/RemoteClient";
import { PairedDeviceStore } from "@/remote/host/PairedDeviceStore";
import { PairingWindow } from "@/remote/host/PairingWindow";
import { RemoteServer } from "@/remote/host/RemoteServer";

const VAULT_ID = "3f9a1c2e";

export class FakeVisibility implements VisibilitySource {
  visible = true;
  private listeners = new Set<() => void>();

  isVisible(): boolean {
    return this.visible;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(visible: boolean): void {
    this.visible = visible;
    for (const listener of [...this.listeners]) listener();
  }
}

export interface PhoneStack {
  client: SessionClient;
  transport: RemoteSessionTransport;
  visibility: FakeVisibility;
  dispose(): void;
}

export interface RemoteRig {
  manager: FakeManager;
  server: RemoteServer;
  remote: RemoteClient;
  desktop: PairedDesktop;
  host: () => SessionHost;
  replaceHost(overrides?: Partial<SessionHostOptions>): SessionHost;
  connectPhone(options?: {
    connectTimeoutMs?: number;
    helloVersion?: number;
    dropResults?: boolean;
  }): PhoneStack;
  stop(): Promise<void>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function waitUntil(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await sleep(3);
  }
}

// A desktop listener (the real RemoteServer serving a real SessionHost) and a paired phone that
// reaches it through a real socket, with `ws` as the phone's WebSocket. Links name a Tailscale
// address while the listener is on loopback, so the phone's socket rewrites the host.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export async function startRemoteRig(
  options: { host?: Partial<SessionHostOptions> } = {}
): Promise<RemoteRig> {
  const manager = new FakeManager();
  let currentHost = buildHost(manager, options.host);
  let hostRaw: string | null = null;
  let phoneRaw: string | null = null;
  const hostStore = new PairedDeviceStore({ read: () => hostRaw, write: (v) => (hostRaw = v) });
  const pairing = new PairingWindow();
  const server = new RemoteServer({
    devices: hostStore,
    consumePairingSecret: (secret) => pairing.consume(secret),
    desktopName: "Studio Mac",
  });
  server.onConnection((connection) => {
    serveRemoteConnection(
      { connect: (send, onClose) => currentHost.connect(send, onClose) },
      connection
    );
  });
  const port = await server.listen("127.0.0.1", 0);
  const store = new PairedDesktopStore({ read: () => phoneRaw, write: (v) => (phoneRaw = v) });
  let connectTimeoutMs = 2000;
  const remote = new RemoteClient({
    store,
    vaultId: VAULT_ID,
    deviceName: "iPhone",
    vaultName: "Work notes",
    clientId: "phone-client-1",
    confirmPairing: async () => true,
    createId: () => "desktop-1",
    channelOptions: {
      createSocket: (url) =>
        new WebSocket(url.replace(/ws:\/\/[^:]+:/, "ws://127.0.0.1:")) as unknown as SocketLike,
      get connectTimeoutMs() {
        return connectTimeoutMs;
      },
      replyTimeoutMs: 2000,
    },
  });
  const { secret } = pairing.start();
  const link = `obsidian://copilot-pair?${new URLSearchParams({
    host: "100.64.0.9",
    port: String(port),
    vault: "Work notes",
    vaultId: VAULT_ID,
    secret,
  })}`;
  const paired = await remote.pairFromLink(link);
  if (!paired.ok) throw new Error(`test rig could not pair: ${paired.reason}`);
  const stacks: PhoneStack[] = [];

  return {
    manager,
    server,
    remote,
    desktop: paired.desktop,
    host: () => currentHost,
    replaceHost(overrides) {
      currentHost.dispose();
      currentHost = buildHost(manager, { ...options.host, ...overrides });
      return currentHost;
    },
    connectPhone(phoneOptions = {}) {
      connectTimeoutMs = phoneOptions.connectTimeoutMs ?? connectTimeoutMs;
      const visibility = new FakeVisibility();
      const transport = new RemoteSessionTransport({
        connect: () => remote.connect(paired.desktop),
        visibility,
        backoffMs: [20, 40, 80],
      });
      const { helloVersion, dropResults } = phoneOptions;
      const clientTransport: ClientTransport =
        helloVersion === undefined && !dropResults
          ? transport
          : {
              send: (frame: ClientFrame) =>
                transport.send(
                  frame.type === "hello" && helloVersion !== undefined
                    ? { ...frame, v: helloVersion }
                    : frame
                ),
              onFrame: (cb) =>
                transport.onFrame((frame) => {
                  if (!(dropResults && frame.type === "result")) cb(frame);
                }),
              onOpenChange: (cb) => transport.onOpenChange(cb),
              close: () => transport.close(),
            };
      const client = new SessionClient(clientTransport, { app: "test-1.0.0" });
      transport.start();
      const stack: PhoneStack = {
        client,
        transport,
        visibility,
        dispose: () => client.dispose(),
      };
      stacks.push(stack);
      return stack;
    },
    async stop() {
      for (const stack of stacks) stack.dispose();
      pairing.dispose();
      currentHost.dispose();
      await server.close();
    },
  };
}
