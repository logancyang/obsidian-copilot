import { once } from "node:events";
import http from "node:http";
import WebSocket from "ws";
import { parseReply, rawText, sleep } from "@/remote/host/serverTestKit";
import { PairedDeviceStore } from "@/remote/host/PairedDeviceStore";
import { PairingWindow } from "@/remote/host/PairingWindow";
import { RemoteServer, type RemoteConnection } from "@/remote/host/RemoteServer";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";

interface Harness {
  server: RemoteServer;
  store: PairedDeviceStore;
  pairing: PairingWindow;
  port: number;
  connections: RemoteConnection[];
  clients: WebSocket[];
}

async function startHarness(
  options: {
    authTimeoutMs?: number;
    maxPendingConnections?: number;
    pairingTtlMs?: number;
    devices?: ConstructorParameters<typeof RemoteServer>[0]["devices"];
  } = {}
): Promise<Harness> {
  let raw: string | null = null;
  const store = new PairedDeviceStore({ read: () => raw, write: (value) => (raw = value) });
  const pairing = new PairingWindow({ ttlMs: options.pairingTtlMs });
  const server = new RemoteServer({
    devices: options.devices ?? store,
    consumePairingSecret: (secret) => pairing.consume(secret),
    desktopName: "Studio Mac",
    authTimeoutMs: options.authTimeoutMs,
    maxPendingConnections: options.maxPendingConnections,
  });
  const connections: RemoteConnection[] = [];
  server.onConnection((connection) => connections.push(connection));
  const port = await server.listen("127.0.0.1", 0);
  return { server, store, pairing, port, connections, clients: [] };
}

function open(harness: Harness): WebSocket {
  const client = new WebSocket(`ws://127.0.0.1:${harness.port}`);
  client.on("error", () => {});
  harness.clients.push(client);
  return client;
}

function collect(client: WebSocket): { messages: string[]; closed: Promise<number> } {
  const messages: string[] = [];
  client.on("message", (data) => messages.push(rawText(data)));
  const closed = new Promise<number>((resolve) => client.once("close", (code) => resolve(code)));
  return { messages, closed };
}

async function exchange(harness: Harness, firstFrame: unknown) {
  const client = open(harness);
  const { messages, closed } = collect(client);
  await once(client, "open");
  client.send(typeof firstFrame === "string" ? firstFrame : JSON.stringify(firstFrame));
  return { client, messages, closed };
}

async function pairDevice(harness: Harness, deviceName = "iPhone") {
  const { secret } = harness.pairing.start();
  const paired = await exchange(harness, { type: "pair", secret, deviceName });
  await waitFor(() => paired.messages.length > 0);
  return { ...paired, reply: parseReply(paired.messages[0]) };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await sleep(5);
  }
}

describe("RemoteServer", () => {
  let harness: Harness;

  afterEach(async () => {
    for (const client of harness?.clients ?? []) client.terminate();
    await harness?.server.close();
    harness?.pairing.dispose();
  });

  describe("RemoteServer", () => {
    describe("listen()", () => {
      describe("pairing", () => {
        it("exchanges the one-time secret for a device token and names the desktop", async () => {
          harness = await startHarness();

          const { reply } = await pairDevice(harness, "Zero's iPhone");

          expect(reply).toMatchObject({ type: "paired", desktopName: "Studio Mac" });
          expect(reply.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
          expect(harness.store.list().map((device) => device.name)).toEqual(["Zero's iPhone"]);
          expect(harness.store.authenticate(reply.token)?.id).toBe(reply.deviceId);
        });

        it("hands the paired connection to connection handlers as an authenticated device", async () => {
          harness = await startHarness();

          const { reply } = await pairDevice(harness);
          await waitFor(() => harness.connections.length === 1);

          expect(harness.connections[0]).toMatchObject({
            deviceId: reply.deviceId,
            deviceName: "iPhone",
          });
        });

        it(`rejects a secret that was already used and closes the connection (${ISSUE})`, async () => {
          harness = await startHarness();
          const { secret } = harness.pairing.start();
          const first = await exchange(harness, { type: "pair", secret, deviceName: "A" });
          await waitFor(() => first.messages.length > 0);

          const second = await exchange(harness, { type: "pair", secret, deviceName: "B" });

          expect(await second.closed).toBe(4401);
          expect(parseReply(second.messages[0])).toEqual({
            type: "denied",
            reason: "pairing-rejected",
          });
          expect(harness.store.list()).toHaveLength(1);
        });

        it(`rejects a secret after it expired (${ISSUE})`, async () => {
          harness = await startHarness({ pairingTtlMs: 40 });
          const { secret } = harness.pairing.start();
          await sleep(80);

          const attempt = await exchange(harness, { type: "pair", secret, deviceName: "A" });

          expect(await attempt.closed).toBe(4401);
          expect(parseReply(attempt.messages[0])).toEqual({
            type: "denied",
            reason: "pairing-rejected",
          });
          expect(harness.store.list()).toEqual([]);
        });

        it("rejects a secret the desktop never issued", async () => {
          harness = await startHarness();
          harness.pairing.start();

          const attempt = await exchange(harness, {
            type: "pair",
            secret: "guess-guess-guess-guess",
            deviceName: "A",
          });

          expect(await attempt.closed).toBe(4401);
          expect(harness.store.list()).toEqual([]);
        });

        it(`answers a store failure during pairing with a denial and no crash (${ISSUE})`, async () => {
          harness = await startHarness({
            devices: {
              authenticate: () => null,
              create: () => {
                throw new Error("keychain unavailable");
              },
              markSeen: () => {},
            },
          });
          const { secret } = harness.pairing.start();

          const attempt = await exchange(harness, { type: "pair", secret, deviceName: "A" });

          expect(await attempt.closed).toBe(4401);
          expect(parseReply(attempt.messages[0])).toEqual({
            type: "denied",
            reason: "bad-request",
          });
        });
      });

      describe("authentication", () => {
        it("admits a device presenting its token and records that it was seen", async () => {
          harness = await startHarness();
          const { reply } = await pairDevice(harness);
          const lastSeenAfterPairing = harness.store.list()[0].lastSeenAt;
          await sleep(5);

          const session = await exchange(harness, { type: "auth", token: reply.token });
          await waitFor(() => session.messages.length > 0);

          expect(parseReply(session.messages[0])).toEqual({
            type: "authed",
            deviceId: reply.deviceId,
          });
          expect(harness.store.list()[0].lastSeenAt).toBeGreaterThan(lastSeenAfterPairing ?? 0);
        });

        it("rejects a token no device owns and never surfaces the connection", async () => {
          harness = await startHarness();
          await pairDevice(harness);
          const before = harness.connections.length;

          const attempt = await exchange(harness, { type: "auth", token: "wrong-token" });

          expect(await attempt.closed).toBe(4401);
          expect(parseReply(attempt.messages[0])).toEqual({
            type: "denied",
            reason: "token-rejected",
          });
          expect(harness.connections).toHaveLength(before);
        });

        it(`closes a connection that sends no first frame within the timeout (${ISSUE})`, async () => {
          harness = await startHarness({ authTimeoutMs: 100 });
          const client = open(harness);
          const { closed } = collect(client);

          expect(await closed).toBe(4408);
        });

        it.each([
          ["text that is not JSON", "hello"],
          ["an unknown frame type", { type: "hello", v: 1 }],
          ["an auth frame without a token", { type: "auth" }],
        ])("denies a first frame of %s", async (_label, frame) => {
          harness = await startHarness();

          const attempt = await exchange(harness, frame);

          expect(await attempt.closed).toBe(4401);
          expect(parseReply(attempt.messages[0])).toEqual({
            type: "denied",
            reason: "bad-request",
          });
        });

        it(`closes a first frame over the pre-authentication size limit (${ISSUE})`, async () => {
          harness = await startHarness();

          const attempt = await exchange(
            harness,
            JSON.stringify({ type: "auth", token: "t".repeat(5000) })
          );

          expect(await attempt.closed).toBe(1009);
        });

        it(`closes a binary first frame (${ISSUE})`, async () => {
          harness = await startHarness();
          const client = open(harness);
          const { closed } = collect(client);
          await once(client, "open");

          client.send(Buffer.from([1, 2, 3]));

          expect(await closed).toBe(1003);
        });

        it(`turns away connections beyond the pending limit until earlier ones authenticate or time out (${ISSUE})`, async () => {
          harness = await startHarness({ maxPendingConnections: 2, authTimeoutMs: 5000 });
          const idle = [open(harness), open(harness)];
          await Promise.all(idle.map((client) => once(client, "open")));

          const refused = open(harness);
          const [, response] = (await once(refused, "unexpected-response")) as [
            unknown,
            http.IncomingMessage,
          ];

          expect(response.statusCode).toBe(503);
        });

        it("frees a pending slot when an idle connection closes", async () => {
          harness = await startHarness({ maxPendingConnections: 1, authTimeoutMs: 5000 });
          const first = open(harness);
          await once(first, "open");
          first.close();
          await once(first, "close");

          const second = await exchange(harness, { type: "auth", token: "x" });

          expect(await second.closed).toBe(4401);
        });
      });

      describe("handshake", () => {
        it("answers a plain HTTP request with 426 upgrade required", async () => {
          harness = await startHarness();

          const status = await new Promise<number>((resolve) =>
            http.get({ host: "127.0.0.1", port: harness.port }, (response) => {
              response.resume();
              resolve(response.statusCode ?? 0);
            })
          );

          expect(status).toBe(426);
        });

        it("refuses an upgrade with a malformed key or wrong version", async () => {
          harness = await startHarness();

          const statuses = await Promise.all(
            [
              { "Sec-WebSocket-Key": "short", "Sec-WebSocket-Version": "13" },
              { "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "8" },
            ].map(
              (headers) =>
                new Promise<number>((resolve) => {
                  const request = http.get({
                    host: "127.0.0.1",
                    port: harness.port,
                    headers: { Connection: "Upgrade", Upgrade: "websocket", ...headers },
                  });
                  request.on("response", (response) => {
                    response.resume();
                    resolve(response.statusCode ?? 0);
                  });
                  request.on("upgrade", () => resolve(101));
                })
            )
          );

          expect(statuses).toEqual([400, 400]);
        });
      });

      it("binds only to the address it is given", async () => {
        harness = await startHarness();

        const address = (harness.server as unknown as { server: http.Server }).server.address();

        expect(address).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
      });

      it("rejects when the port is already in use", async () => {
        harness = await startHarness();
        const second = new RemoteServer({
          devices: harness.store,
          consumePairingSecret: () => false,
          desktopName: "x",
        });

        await expect(second.listen("127.0.0.1", harness.port)).rejects.toMatchObject({
          code: "EADDRINUSE",
        });
      });
    });

    describe("onConnection()", () => {
      async function connectPaired() {
        harness = await startHarness();
        const { reply, client, messages, closed } = await pairDevice(harness);
        await waitFor(() => harness.connections.length === 1);
        return { connection: harness.connections[0], reply, client, messages, closed };
      }

      it("delivers text the phone sends to onMessage handlers", async () => {
        const { connection, client } = await connectPaired();
        const received: string[] = [];
        connection.onMessage((text) => received.push(text));

        client.send("hello desktop");
        await waitFor(() => received.length === 1);

        expect(received).toEqual(["hello desktop"]);
      });

      it("delivers text the desktop sends to the phone", async () => {
        const { connection, messages } = await connectPaired();

        connection.send("hello phone");
        await waitFor(() => messages.length === 2);

        expect(messages[1]).toBe("hello phone");
      });

      it("accepts messages far larger than the pre-authentication limit once authenticated", async () => {
        const { connection, client } = await connectPaired();
        const received: string[] = [];
        connection.onMessage((text) => received.push(text));

        client.send("x".repeat(1_000_000));
        await waitFor(() => received.length === 1);

        expect(received[0]).toHaveLength(1_000_000);
      });

      it("answers a ping with a pong", async () => {
        const { client } = await connectPaired();
        const pong = once(client, "pong");

        client.ping("beat");

        const [payload] = (await pong) as [Buffer];
        expect(payload.toString()).toBe("beat");
      });

      it("stops delivering to a handler that unsubscribed", async () => {
        const { connection, client } = await connectPaired();
        const received: string[] = [];
        const unsubscribe = connection.onMessage((text) => received.push(text));
        client.send("one");
        await waitFor(() => received.length === 1);

        unsubscribe();
        client.send("two");
        await sleep(30);

        expect(received).toEqual(["one"]);
      });

      it("reports the close code to onClose handlers when the phone disconnects", async () => {
        const { connection, client } = await connectPaired();
        const closes: number[] = [];
        connection.onClose((event) => closes.push(event.code));

        client.close(1000);
        await waitFor(() => closes.length === 1);

        expect(closes).toEqual([1000]);
      });

      it(`answers a close frame that carries no status with a normal close instead of echoing a reserved code (${ISSUE})`, async () => {
        const { client, closed } = await connectPaired();

        client.close();

        expect(await closed).toBe(1000);
      });

      it("closes the phone's socket when the desktop calls close()", async () => {
        const { connection, closed } = await connectPaired();

        connection.close(4000);

        expect(await closed).toBe(4000);
      });

      it("closes the connection on a binary frame after authentication", async () => {
        const { client, closed } = await connectPaired();

        client.send(Buffer.from([9]));

        expect(await closed).toBe(1003);
      });
    });

    describe("onConnectionsChanged()", () => {
      it("notifies once when a device connects and once when it disconnects", async () => {
        harness = await startHarness();
        const changes = jest.fn();
        harness.server.onConnectionsChanged(changes);

        const { reply, client } = await pairDevice(harness);
        await waitFor(() => harness.server.isDeviceConnected(reply.deviceId));
        client.close();
        await waitFor(() => !harness.server.isDeviceConnected(reply.deviceId));

        expect(changes).toHaveBeenCalledTimes(2);
      });

      it("stops notifying a listener after it unsubscribes", async () => {
        harness = await startHarness();
        const changes = jest.fn();
        harness.server.onConnectionsChanged(changes)();

        await pairDevice(harness);
        await waitFor(() => harness.connections.length === 1);

        expect(changes).not.toHaveBeenCalled();
      });
    });

    describe("isDeviceConnected()", () => {
      it("is true while a device has a live connection and false before and after", async () => {
        harness = await startHarness();
        const { reply, client } = await pairDevice(harness);
        await waitFor(() => harness.connections.length === 1);
        const whileConnected = harness.server.isDeviceConnected(reply.deviceId);

        client.close();
        await waitFor(() => !harness.server.isDeviceConnected(reply.deviceId));

        expect([whileConnected, harness.server.isDeviceConnected("someone-else")]).toEqual([
          true,
          false,
        ]);
      });
    });

    describe("disconnectDevice()", () => {
      it("closes every live connection of the device with the revoked code", async () => {
        harness = await startHarness();
        const { reply } = await pairDevice(harness);
        const first = await exchange(harness, { type: "auth", token: reply.token });
        const second = await exchange(harness, { type: "auth", token: reply.token });
        await waitFor(() => first.messages.length > 0 && second.messages.length > 0);

        harness.server.disconnectDevice(reply.deviceId);

        expect(await first.closed).toBe(4403);
        expect(await second.closed).toBe(4403);
        expect(harness.server.isDeviceConnected(reply.deviceId)).toBe(false);
      });

      it("leaves other devices connected", async () => {
        harness = await startHarness();
        const a = await pairDevice(harness, "A");
        const b = await pairDevice(harness, "B");
        await waitFor(() => harness.connections.length === 2);

        harness.server.disconnectDevice(a.reply.deviceId);
        await a.closed;

        expect(harness.server.isDeviceConnected(b.reply.deviceId)).toBe(true);
      });
    });

    describe("close()", () => {
      it("closes live connections with the going-away code and refuses new ones", async () => {
        harness = await startHarness();
        const { closed } = await pairDevice(harness);

        await harness.server.close();

        expect(await closed).toBe(1001);
        const late = open(harness);
        const [error] = (await once(late, "error")) as [Error & { code?: string }];
        expect(error.code).toBe("ECONNREFUSED");
      });

      it("is safe to call when the server never started", async () => {
        harness = await startHarness();
        await harness.server.close();

        await expect(harness.server.close()).resolves.toBeUndefined();
      });
    });
  });
});
