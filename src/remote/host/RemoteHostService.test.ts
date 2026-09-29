import { once } from "node:events";
import WebSocket from "ws";
import { parseReply, rawText, sleep } from "@/remote/host/serverTestKit";
import { PairedDeviceStore } from "@/remote/host/PairedDeviceStore";
import { PAIRING_TTL_MS, PairingWindow } from "@/remote/host/PairingWindow";
import {
  ADDRESS_RETRY_MS,
  RemoteHostService,
  type RemoteHostServiceDeps,
} from "@/remote/host/RemoteHostService";
import { RemoteServer } from "@/remote/host/RemoteServer";
import { parsePairingLink } from "@/remote/pairingLink";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";
const TAILSCALE = "100.118.223.39";

interface Rig {
  service: RemoteHostService;
  store: PairedDeviceStore;
  pairing: PairingWindow;
  control: { plus: boolean; address: string | null; savedPort: number | null };
  notifyPlus: () => void;
  saved: number[];
}

function makeRig(overrides: Partial<RemoteHostServiceDeps> = {}, vaultId = "3f9a1c2e"): Rig {
  let raw: string | null = null;
  const store = new PairedDeviceStore({ read: () => raw, write: (value) => (raw = value) });
  const pairing = new PairingWindow();
  const control = {
    plus: true,
    address: TAILSCALE as string | null,
    savedPort: null as number | null,
  };
  const plusListeners = new Set<() => void>();
  const saved: number[] = [];
  const service = new RemoteHostService({
    store,
    pairing,
    isPlus: () => control.plus,
    subscribePlus: (listener) => {
      plusListeners.add(listener);
      return () => plusListeners.delete(listener);
    },
    findTailscaleAddress: () => control.address,
    vault: { name: "Work notes", id: vaultId },
    desktopName: "Studio Mac",
    port: {
      load: () => control.savedPort,
      save: (port) => {
        control.savedPort = port;
        saved.push(port);
      },
    },
    ...overrides,
  });
  return {
    service,
    store,
    pairing,
    control,
    saved,
    notifyPlus: () => plusListeners.forEach((l) => l()),
  };
}

describe("RemoteHostService", () => {
  let rig: Rig | undefined;
  let listen: jest.SpyInstance;
  let close: jest.SpyInstance;

  afterEach(async () => {
    await rig?.service.dispose();
    rig = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe("RemoteHostService", () => {
    beforeEach(() => {
      listen = jest
        .spyOn(RemoteServer.prototype, "listen")
        .mockImplementation(async (_host, port) => port || 45123);
      close = jest.spyOn(RemoteServer.prototype, "close").mockResolvedValue(undefined);
    });

    describe("start()", () => {
      it("listens on nothing while no phone is paired and no pairing is open", async () => {
        rig = makeRig();

        await rig.service.start();

        expect(listen).not.toHaveBeenCalled();
        expect(rig.service.getState()).toMatchObject({
          plus: true,
          listening: false,
          pairing: null,
          error: null,
        });
      });

      it("listens only on the Tailscale address, never on all interfaces or loopback, when a phone is paired", async () => {
        rig = makeRig();
        rig.store.create("iPhone");

        await rig.service.start();

        expect(listen).toHaveBeenCalledTimes(1);
        expect(listen.mock.calls[0][0]).toBe(TAILSCALE);
        expect(listen.mock.calls.map(([host]: [string]) => host)).not.toEqual(
          expect.arrayContaining(["0.0.0.0", "127.0.0.1", "::"])
        );
        expect(rig.service.getState().listening).toBe(true);
      });

      it("does not listen without Copilot Plus even when a phone is paired", async () => {
        rig = makeRig();
        rig.control.plus = false;
        rig.store.create("iPhone");

        await rig.service.start();

        expect(listen).not.toHaveBeenCalled();
        expect(rig.service.getState()).toMatchObject({ plus: false, listening: false });
      });

      it(`does not listen when Tailscale has no address and reports why (${ISSUE})`, async () => {
        rig = makeRig();
        rig.control.address = null;
        rig.store.create("iPhone");

        await rig.service.start();

        expect(listen).not.toHaveBeenCalled();
        expect(rig.service.getState()).toMatchObject({ tailscaleAddress: null, listening: false });
      });

      it(`starts listening later when Tailscale gets an address after Obsidian started (${ISSUE})`, async () => {
        jest.useFakeTimers();
        rig = makeRig();
        rig.control.address = null;
        rig.store.create("iPhone");
        await rig.service.start();

        rig.control.address = TAILSCALE;
        await jest.advanceTimersByTimeAsync(ADDRESS_RETRY_MS);

        expect(listen).toHaveBeenCalledWith(TAILSCALE, expect.any(Number));
        expect(rig.service.getState().listening).toBe(true);
      });

      it("reuses the remembered port so a paired phone can reconnect after a restart", async () => {
        rig = makeRig();
        rig.control.savedPort = 51234;
        rig.store.create("iPhone");

        await rig.service.start();

        expect(listen).toHaveBeenCalledWith(TAILSCALE, 51234);
      });

      it("remembers the port it was given when none was saved yet", async () => {
        rig = makeRig();
        rig.store.create("iPhone");

        await rig.service.start();

        expect(rig.saved).toEqual([45123]);
      });

      it(`keeps the remembered port and reports an error when it is busy and a phone is paired, because moving it would strand the phone (${ISSUE})`, async () => {
        rig = makeRig();
        rig.control.savedPort = 51234;
        rig.store.create("iPhone");
        listen.mockRejectedValue(Object.assign(new Error("in use"), { code: "EADDRINUSE" }));

        await rig.service.start();

        expect(rig.control.savedPort).toBe(51234);
        expect(rig.service.getState().listening).toBe(false);
        expect(rig.service.getState().error).toContain("Remote listener");
      });

      it(`falls back to a fresh port when the remembered one is busy and no phone is paired (${ISSUE})`, async () => {
        rig = makeRig();
        rig.control.savedPort = 51234;
        listen.mockImplementation(async (_host, port) => {
          if (port === 51234) throw Object.assign(new Error("in use"), { code: "EADDRINUSE" });
          return 46000;
        });

        await rig.service.startPairing();

        expect(rig.control.savedPort).toBe(46000);
        expect(rig.service.getState().pairing).not.toBeNull();
      });
    });

    describe("startPairing()", () => {
      it("opens a pairing and publishes a link carrying the address, port, vault and a one-time secret", async () => {
        rig = makeRig();

        await rig.service.startPairing();

        const link = parsePairingLink(rig.service.getState().pairing?.link ?? "");
        expect(link).toMatchObject({
          host: TAILSCALE,
          port: 45123,
          vaultName: "Work notes",
          vaultId: "3f9a1c2e",
        });
        expect(link?.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
        expect(rig.service.getState().listening).toBe(true);
      });

      it("does nothing without Copilot Plus", async () => {
        rig = makeRig();
        rig.control.plus = false;

        await rig.service.startPairing();

        expect(listen).not.toHaveBeenCalled();
        expect(rig.service.getState().pairing).toBeNull();
      });

      it("opens no pairing and listens on nothing when Tailscale has no address", async () => {
        rig = makeRig();
        rig.control.address = null;

        await rig.service.startPairing();

        expect(listen).not.toHaveBeenCalled();
        expect(rig.service.getState()).toMatchObject({ pairing: null, tailscaleAddress: null });
      });

      it("issues a new secret each time so an earlier QR code stops working", async () => {
        rig = makeRig();
        await rig.service.startPairing();
        const first = parsePairingLink(rig.service.getState().pairing?.link ?? "");

        await rig.service.startPairing();
        const second = parsePairingLink(rig.service.getState().pairing?.link ?? "");

        expect(second?.secret).not.toBe(first?.secret);
        expect(rig.pairing.consume(first?.secret ?? "")).toBe(false);
      });

      it("reports an error and opens no pairing when the listener cannot start", async () => {
        rig = makeRig();
        listen.mockRejectedValue(new Error("EACCES: secret-path-detail"));

        await rig.service.startPairing();

        const state = rig.service.getState();
        expect(state.pairing).toBeNull();
        expect(state.listening).toBe(false);
        expect(state.error).toBe(
          "Copilot could not start the Remote listener. Check the logs and try again."
        );
      });

      it("clears an earlier error when pairing is started again", async () => {
        rig = makeRig();
        listen.mockRejectedValueOnce(new Error("boom"));
        await rig.service.startPairing();

        await rig.service.startPairing();

        expect(rig.service.getState().error).toBeNull();
        expect(rig.service.getState().pairing).not.toBeNull();
      });
    });

    describe("cancelPairing()", () => {
      it("stops listening when the cancelled pairing was the only reason to listen", async () => {
        rig = makeRig();
        await rig.service.startPairing();

        rig.service.cancelPairing();
        await rig.service.recheck();

        expect(close).toHaveBeenCalled();
        expect(rig.service.getState()).toMatchObject({ listening: false, pairing: null });
      });

      it("keeps listening when a phone is paired", async () => {
        rig = makeRig();
        rig.store.create("iPhone");
        await rig.service.startPairing();

        rig.service.cancelPairing();
        await rig.service.recheck();

        expect(rig.service.getState()).toMatchObject({ listening: true, pairing: null });
      });
    });

    describe("pairing expiry", () => {
      it(`stops listening once an unused pairing expires (${ISSUE})`, async () => {
        jest.useFakeTimers();
        rig = makeRig();
        await rig.service.startPairing();

        await jest.advanceTimersByTimeAsync(PAIRING_TTL_MS);

        expect(rig.service.getState()).toMatchObject({ listening: false, pairing: null });
      });
    });

    describe("revokeDevice()", () => {
      it("removes the device and stops listening when it was the last one and no pairing is open", async () => {
        rig = makeRig();
        const { device } = rig.store.create("iPhone");
        await rig.service.start();

        rig.service.revokeDevice(device.id);
        await rig.service.recheck();

        expect(rig.service.getState()).toMatchObject({ devices: [], listening: false });
      });

      it("keeps listening while other phones remain paired", async () => {
        rig = makeRig();
        const first = rig.store.create("A");
        rig.store.create("B");
        await rig.service.start();

        rig.service.revokeDevice(first.device.id);
        await rig.service.recheck();

        expect(rig.service.getState().devices.map((device) => device.name)).toEqual(["B"]);
        expect(rig.service.getState().listening).toBe(true);
      });

      it("disconnects the revoked device's live connections", async () => {
        rig = makeRig();
        const { device } = rig.store.create("iPhone");
        const disconnect = jest.spyOn(RemoteServer.prototype, "disconnectDevice");

        rig.service.revokeDevice(device.id);

        expect(disconnect).toHaveBeenCalledWith(device.id);
      });
    });

    describe("Copilot Plus changes", () => {
      it("stops listening when Plus lapses while a phone is paired", async () => {
        rig = makeRig();
        rig.store.create("iPhone");
        await rig.service.start();

        rig.control.plus = false;
        rig.notifyPlus();
        await rig.service.recheck();

        expect(rig.service.getState()).toMatchObject({ plus: false, listening: false });
      });

      it("resumes listening when Plus returns", async () => {
        rig = makeRig();
        rig.control.plus = false;
        rig.store.create("iPhone");
        await rig.service.start();

        rig.control.plus = true;
        rig.notifyPlus();
        await rig.service.recheck();

        expect(rig.service.getState()).toMatchObject({ plus: true, listening: true });
      });

      it("ignores settings changes that leave the Plus state alone", async () => {
        rig = makeRig();
        rig.store.create("iPhone");
        await rig.service.start();
        listen.mockClear();
        close.mockClear();

        rig.notifyPlus();
        await rig.service.recheck();

        expect(listen).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
      });
    });

    describe("recheck()", () => {
      it("moves the listener when Tailscale's address changes", async () => {
        rig = makeRig();
        rig.store.create("iPhone");
        await rig.service.start();

        rig.control.address = "100.90.1.2";
        await rig.service.recheck();

        expect(listen).toHaveBeenLastCalledWith("100.90.1.2", 45123);
      });

      it("keeps the listener when the address is unchanged", async () => {
        rig = makeRig();
        rig.store.create("iPhone");
        await rig.service.start();

        await rig.service.recheck();

        expect(listen).toHaveBeenCalledTimes(1);
      });

      it("shows the address Tailscale now has so the settings can leave the not-detected state", async () => {
        rig = makeRig();
        rig.control.address = null;
        await rig.service.start();

        rig.control.address = TAILSCALE;
        await rig.service.recheck();

        expect(rig.service.getState().tailscaleAddress).toBe(TAILSCALE);
      });
    });

    describe("getState() and subscribe()", () => {
      it("returns the same state object until something changes", async () => {
        rig = makeRig();
        await rig.service.start();

        expect(rig.service.getState()).toBe(rig.service.getState());
      });

      it("returns a shared frozen empty device list while no phone is paired", async () => {
        rig = makeRig();
        await rig.service.start();

        expect(rig.service.getState().devices).toBe(rig.service.getState().devices);
        expect(Object.isFrozen(rig.service.getState().devices)).toBe(true);
      });

      it("notifies subscribers when the state changes and stops after unsubscribing", async () => {
        rig = makeRig();
        await rig.service.start();
        const listener = jest.fn();
        const unsubscribe = rig.service.subscribe(listener);

        await rig.service.startPairing();
        const callsWhileSubscribed = listener.mock.calls.length;
        unsubscribe();
        rig.service.cancelPairing();
        await rig.service.recheck();

        expect(callsWhileSubscribed).toBeGreaterThan(0);
        expect(listener).toHaveBeenCalledTimes(callsWhileSubscribed);
      });

      it("lists paired devices with their name, creation time and last-seen time", async () => {
        rig = makeRig();
        const { device } = rig.store.create("Zero's iPhone");
        rig.store.markSeen(device.id);
        await rig.service.start();

        const [stored] = rig.store.list();
        expect(stored.lastSeenAt).not.toBeNull();
        expect(rig.service.getState().devices).toEqual([
          {
            id: device.id,
            name: "Zero's iPhone",
            createdAt: stored.createdAt,
            lastSeenAt: stored.lastSeenAt,
            connected: false,
          },
        ]);
      });
    });

    describe("dispose()", () => {
      it("closes the listener and stops reacting to changes", async () => {
        rig = makeRig();
        await rig.service.startPairing();
        close.mockClear();

        await rig.service.dispose();

        expect(close).toHaveBeenCalled();
        expect(rig.pairing.getActive()).toBeNull();
      });
    });
  });

  describe("over a real socket", () => {
    let rigs: Rig[] = [];

    afterEach(async () => {
      await Promise.all(rigs.map((realRig) => realRig.service.dispose()));
      rigs = [];
    });

    function linkParts(link: string) {
      const query = new URL(link).searchParams;
      return {
        host: query.get("host"),
        port: query.get("port"),
        vaultId: query.get("vaultId"),
        secret: query.get("secret") ?? "",
      };
    }

    function realRig(vaultId: string): Rig {
      const rig = makeRig({ findTailscaleAddress: () => "127.0.0.1" }, vaultId);
      rigs.push(rig);
      return rig;
    }

    async function pairOver(link: string, deviceName: string) {
      const parsed = linkParts(link);
      const client = new WebSocket(`ws://${parsed.host}:${parsed.port}`);
      const messages: string[] = [];
      client.on("message", (data) => messages.push(rawText(data)));
      await once(client, "open");
      client.send(JSON.stringify({ type: "pair", secret: parsed.secret, deviceName }));
      const deadline = Date.now() + 2000;
      while (messages.length === 0 && Date.now() < deadline) await sleep(5);
      return { client, reply: parseReply(messages[0] ?? "null") };
    }

    it("pairs a phone through the published link, lists it as connected, and rejects the same link a second time", async () => {
      const rig = realRig("3f9a1c2e");
      await rig.service.startPairing();
      const link = rig.service.getState().pairing?.link ?? "";

      const first = await pairOver(link, "Zero's iPhone");
      const second = await pairOver(link, "Intruder");

      expect(first.reply).toMatchObject({ type: "paired", desktopName: "Studio Mac" });
      expect(second.reply).toEqual({ type: "denied", reason: "pairing-rejected" });
      const state = rig.service.getState();
      expect(state.pairing).toBeNull();
      expect(state.devices.map((device) => [device.name, device.connected])).toEqual([
        ["Zero's iPhone", true],
      ]);
      first.client.terminate();
      second.client.terminate();
    });

    it("closes the phone's live connection when its device is revoked and rejects its token afterwards", async () => {
      const rig = realRig("3f9a1c2e");
      await rig.service.startPairing();
      const revoked = await pairOver(rig.service.getState().pairing?.link ?? "", "iPhone");
      await rig.service.startPairing();
      const other = await pairOver(rig.service.getState().pairing?.link ?? "", "iPad");
      const closed = new Promise<number>((resolve) =>
        revoked.client.once("close", (code) => resolve(code))
      );

      rig.service.revokeDevice(revoked.reply.deviceId);
      const retry = new WebSocket(`ws://127.0.0.1:${rig.control.savedPort}`);
      const answer = new Promise<string>((resolve) =>
        retry.on("message", (data) => resolve(rawText(data)))
      );
      await once(retry, "open");
      retry.send(JSON.stringify({ type: "auth", token: revoked.reply.token }));

      expect(await closed).toBe(4403);
      expect(parseReply(await answer)).toEqual({ type: "denied", reason: "token-rejected" });
      retry.terminate();
      other.client.terminate();
    });

    it("stops listening when the last paired phone is revoked and no pairing is open", async () => {
      const rig = realRig("3f9a1c2e");
      await rig.service.startPairing();
      const { client, reply } = await pairOver(
        rig.service.getState().pairing?.link ?? "",
        "iPhone"
      );

      rig.service.revokeDevice(reply.deviceId);
      await rig.service.recheck();

      expect(rig.service.getState().listening).toBe(false);
      const retry = new WebSocket(`ws://127.0.0.1:${rig.control.savedPort}`);
      const [error] = (await once(retry, "error")) as [Error & { code?: string }];
      expect(error.code).toBe("ECONNREFUSED");
      client.terminate();
    });

    it("rejects a valid token while Copilot Plus is inactive", async () => {
      const rig = realRig("3f9a1c2e");
      await rig.service.startPairing();
      const { client, reply } = await pairOver(
        rig.service.getState().pairing?.link ?? "",
        "iPhone"
      );
      client.terminate();
      rig.control.plus = false;

      const retry = new WebSocket(`ws://127.0.0.1:${rig.control.savedPort}`);
      const answer = new Promise<string>((resolve) =>
        retry.on("message", (data) => resolve(rawText(data)))
      );
      await once(retry, "open");
      retry.send(JSON.stringify({ type: "auth", token: reply.token }));

      expect(parseReply(await answer)).toEqual({ type: "denied", reason: "token-rejected" });
      retry.terminate();
    });

    it("gives two vault windows their own ports and their own vault ids in the links", async () => {
      const first = realRig("3f9a1c2e");
      const second = realRig("a1b2c3d4");

      await Promise.all([first.service.startPairing(), second.service.startPairing()]);

      const firstLink = linkParts(first.service.getState().pairing?.link ?? "");
      const secondLink = linkParts(second.service.getState().pairing?.link ?? "");
      expect(firstLink.port).not.toBe(secondLink.port);
      expect([firstLink.vaultId, secondLink.vaultId]).toEqual(["3f9a1c2e", "a1b2c3d4"]);
      expect(firstLink.secret).not.toBe(secondLink.secret);
    });
  });
});
