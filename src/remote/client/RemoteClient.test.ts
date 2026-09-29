import WebSocket from "ws";
import { PairedDesktopStore } from "@/remote/client/PairedDesktopStore";
import { RemoteClient } from "@/remote/client/RemoteClient";
import { PairedDeviceStore } from "@/remote/host/PairedDeviceStore";
import { PairingWindow } from "@/remote/host/PairingWindow";
import { RemoteServer } from "@/remote/host/RemoteServer";
import type { SocketLike } from "@/remote/channel";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";
const VAULT_ID = "3f9a1c2e";

interface Rig {
  client: RemoteClient;
  desktopStore: PairedDesktopStore;
  hostStore: PairedDeviceStore;
  pairing: PairingWindow;
  server: RemoteServer;
  port: number;
  linkFor: (overrides?: Record<string, string>) => string;
}

async function makeRig(clientVaultId = VAULT_ID): Promise<Rig> {
  let hostRaw: string | null = null;
  let phoneRaw: string | null = null;
  const hostStore = new PairedDeviceStore({ read: () => hostRaw, write: (v) => (hostRaw = v) });
  const pairing = new PairingWindow();
  const server = new RemoteServer({
    devices: hostStore,
    consumePairingSecret: (secret) => pairing.consume(secret),
    desktopName: "Studio Mac",
  });
  const port = await server.listen("127.0.0.1", 0);
  const desktopStore = new PairedDesktopStore({
    read: () => phoneRaw,
    write: (v) => (phoneRaw = v),
  });
  let counter = 0;
  const client = new RemoteClient({
    store: desktopStore,
    vaultId: clientVaultId,
    deviceName: "iPhone",
    now: () => 5_000,
    createId: () => `desktop-${++counter}`,
    channelOptions: {
      // Links name a Tailscale address while the test listener is on loopback. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
      createSocket: (url) =>
        new WebSocket(url.replace(/ws:\/\/[^:]+:/, "ws://127.0.0.1:")) as unknown as SocketLike,
      connectTimeoutMs: 1000,
      replyTimeoutMs: 1000,
    },
  });
  const linkFor = (overrides: Record<string, string> = {}) => {
    const { secret } = pairing.start();
    const query = new URLSearchParams({
      host: "100.64.0.9",
      port: String(port),
      vault: "Work notes",
      vaultId: VAULT_ID,
      secret,
      ...overrides,
    });
    return `obsidian://copilot-pair?${query.toString()}`;
  };
  return { client, desktopStore, hostStore, pairing, server, port, linkFor };
}

async function waitUntil(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 5));
  }
}

describe("RemoteClient", () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await makeRig();
  });

  afterEach(async () => {
    rig.pairing.dispose();
    await rig.server.close();
  });

  describe("pairFromLink()", () => {
    it("exchanges the secret for a device token and stores the desktop", async () => {
      const outcome = await rig.client.pairFromLink(rig.linkFor());

      expect(outcome).toMatchObject({
        ok: true,
        desktop: { desktopName: "Studio Mac", vaultName: "Work notes" },
      });
      const [stored] = rig.desktopStore.list();
      expect(stored).toMatchObject({
        id: "desktop-1",
        host: "100.64.0.9",
        port: rig.port,
        pairedAt: 5_000,
      });
      expect(rig.hostStore.authenticate(stored.token)).not.toBeNull();
    });

    it("lets the desktop list the phone under the name the phone reported", async () => {
      await rig.client.pairFromLink(rig.linkFor());

      expect(rig.hostStore.list().map((device) => device.name)).toEqual(["iPhone"]);
    });

    it("rejects text that is not a pairing link without contacting the desktop", async () => {
      expect(await rig.client.pairFromLink("hello")).toEqual({ ok: false, reason: "invalid-link" });
      expect(rig.desktopStore.list()).toEqual([]);
    });

    it(`refuses a link for another vault before contacting the desktop, so no token is stored under the wrong vault (${ISSUE})`, async () => {
      const outcome = await rig.client.pairFromLink(rig.linkFor({ vaultId: "deadbeef" }));

      expect(outcome).toEqual({ ok: false, reason: "wrong-vault", vaultName: "Work notes" });
      expect(rig.desktopStore.list()).toEqual([]);
      expect(rig.hostStore.list()).toEqual([]);
    });

    it(`reports an expired or already used secret and stores nothing (${ISSUE})`, async () => {
      const link = rig.linkFor();
      await rig.client.pairFromLink(link);

      const second = await rig.client.pairFromLink(link);

      expect(second).toEqual({ ok: false, reason: "expired-or-used" });
      expect(rig.desktopStore.list()).toHaveLength(1);
    });

    it("reports an unreachable desktop when nothing listens on the port", async () => {
      const link = rig.linkFor();
      await rig.server.close();

      expect(await rig.client.pairFromLink(link)).toEqual({ ok: false, reason: "unreachable" });
    });
  });

  describe("pairFromParams()", () => {
    it("pairs from the parameters Obsidian hands the protocol handler", async () => {
      const query = Object.fromEntries(new URL(rig.linkFor()).searchParams);

      const outcome = await rig.client.pairFromParams({ action: "copilot-pair", ...query });

      expect(outcome.ok).toBe(true);
    });

    it("rejects parameters that do not describe a Tailscale desktop", async () => {
      const query = Object.fromEntries(new URL(rig.linkFor()).searchParams);

      expect(await rig.client.pairFromParams({ ...query, host: "192.168.1.5" })).toEqual({
        ok: false,
        reason: "invalid-link",
      });
    });
  });

  describe("connect()", () => {
    async function pairedDesktop() {
      await rig.client.pairFromLink(rig.linkFor());
      return rig.desktopStore.list()[0];
    }

    it("opens an authenticated channel that carries text both ways", async () => {
      const desktop = await pairedDesktop();
      const received: string[] = [];
      rig.server.onConnection((connection) =>
        connection.onMessage((text) => connection.send(`echo:${text}`))
      );

      const outcome = await rig.client.connect(desktop);
      if (!outcome.ok) throw new Error("expected a connection");
      outcome.channel.onMessage((text) => received.push(text));
      outcome.channel.send("ping");
      await waitUntil(() => received.length > 0);
      outcome.channel.close();

      expect(received).toEqual(["echo:ping"]);
    });

    it("reports a rejected token once the desktop revoked the phone", async () => {
      const desktop = await pairedDesktop();
      rig.pairing.start();
      rig.hostStore.revoke(rig.hostStore.list()[0].id);

      expect(await rig.client.connect(desktop)).toEqual({ ok: false, reason: "token-rejected" });
    });

    it("notices the desktop closing an open channel on revoke", async () => {
      const desktop = await pairedDesktop();
      const outcome = await rig.client.connect(desktop);
      if (!outcome.ok) throw new Error("expected a connection");
      const closes: number[] = [];
      outcome.channel.onClose((event) => closes.push(event.code));

      rig.server.disconnectDevice(outcome.deviceId);
      await waitUntil(() => closes.length > 0);

      expect(closes).toEqual([4403]);
    });

    it("reports an unreachable desktop when nothing listens", async () => {
      const desktop = await pairedDesktop();
      await rig.server.close();

      expect(await rig.client.connect(desktop)).toEqual({ ok: false, reason: "unreachable" });
    });
  });

  describe("store", () => {
    it("exposes the paired-desktop store the settings screen reads", () => {
      expect(rig.client.store).toBe(rig.desktopStore);
    });
  });
});
