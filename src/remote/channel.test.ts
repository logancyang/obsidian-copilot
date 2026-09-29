import { openChannel, SOCKET_OPEN, type SocketEvent, type SocketLike } from "@/remote/channel";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null | undefined = null;
  private listeners = new Map<string, Array<(event: SocketEvent) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }
  addEventListener(type: string, listener: (event: SocketEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: SocketEvent = {}): void {
    if (type === "open") this.readyState = SOCKET_OPEN;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const AUTH = { type: "auth", token: "tok" } as const;
const PAIR = { type: "pair", secret: "sec", deviceName: "iPhone" } as const;

function start(frame: typeof AUTH | typeof PAIR = AUTH, options = {}) {
  const socket = new FakeSocket();
  const created: string[] = [];
  const result = openChannel("ws://100.64.0.9:5000", frame, {
    createSocket: (url) => {
      created.push(url);
      return socket;
    },
    ...options,
  });
  return { socket, created, result };
}

describe("channel", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe("openChannel()", () => {
    it("connects to the given url and sends the first frame once the socket opens", async () => {
      const { socket, created, result } = start(PAIR);

      socket.emit("open");
      socket.emit("message", {
        data: JSON.stringify({ type: "paired", token: "t", deviceId: "d", desktopName: "Mac" }),
      });

      await expect(result).resolves.toMatchObject({
        ok: true,
        reply: { type: "paired", token: "t" },
      });
      expect(created).toEqual(["ws://100.64.0.9:5000"]);
      expect(socket.sent.map((text) => JSON.parse(text) as unknown)).toEqual([PAIR]);
    });

    it("resolves an auth handshake with the device id the desktop confirmed", async () => {
      const { socket, result } = start(AUTH);

      socket.emit("open");
      socket.emit("message", { data: JSON.stringify({ type: "authed", deviceId: "d1" }) });

      await expect(result).resolves.toMatchObject({
        ok: true,
        reply: { type: "authed", deviceId: "d1" },
      });
    });

    it("reports a denial with the reason the desktop gave and closes the socket", async () => {
      const { socket, result } = start(PAIR);

      socket.emit("open");
      socket.emit("message", {
        data: JSON.stringify({ type: "denied", reason: "pairing-rejected" }),
      });

      await expect(result).resolves.toEqual({
        ok: false,
        reason: "denied",
        denyReason: "pairing-rejected",
      });
      expect(socket.closedWith).not.toBeNull();
    });

    it("reports a reply of the wrong kind as a protocol failure", async () => {
      const { socket, result } = start(AUTH);

      socket.emit("open");
      socket.emit("message", {
        data: JSON.stringify({ type: "paired", token: "t", deviceId: "d", desktopName: "x" }),
      });

      await expect(result).resolves.toEqual({ ok: false, reason: "protocol" });
    });

    it("reports unreachable when the socket errors before opening", async () => {
      const { socket, result } = start();

      socket.emit("error");

      await expect(result).resolves.toEqual({ ok: false, reason: "unreachable" });
    });

    it("reports unreachable when the socket cannot be created", async () => {
      const result = await openChannel("ws://x", AUTH, {
        createSocket: () => {
          throw new Error("blocked");
        },
      });

      expect(result).toEqual({ ok: false, reason: "unreachable" });
    });

    it("gives up after the connect timeout when a socket stays connecting, as Obsidian iOS does for an unreachable Tailscale address (https://github.com/Brevilabs/obsidian-copilot-private/issues/610)", async () => {
      const { socket, result } = start(AUTH, { connectTimeoutMs: 3000 });

      jest.advanceTimersByTime(3000);

      await expect(result).resolves.toEqual({ ok: false, reason: "timeout" });
      expect(socket.closedWith).not.toBeNull();
    });

    it("gives up after the reply timeout when the desktop opens the socket but never answers", async () => {
      const { socket, result } = start(AUTH, { connectTimeoutMs: 3000, replyTimeoutMs: 2000 });

      socket.emit("open");
      jest.advanceTimersByTime(2000);

      await expect(result).resolves.toEqual({ ok: false, reason: "timeout" });
    });

    describe("the returned channel", () => {
      async function openAuthed() {
        const { socket, result } = start(AUTH);
        socket.emit("open");
        socket.emit("message", { data: JSON.stringify({ type: "authed", deviceId: "d1" }) });
        const opened = await result;
        if (!opened.ok) throw new Error("expected an open channel");
        return { socket, channel: opened.channel };
      }

      it("sends text over the open socket", async () => {
        const { socket, channel } = await openAuthed();

        channel.send("hello");

        expect(socket.sent.at(-1)).toBe("hello");
      });

      it("delivers a frame that arrives after the handshake to a message handler", async () => {
        const { socket, channel } = await openAuthed();
        const received: string[] = [];
        channel.onMessage((text) => received.push(text));

        socket.emit("message", { data: "one" });

        expect(received).toEqual(["one"]);
      });

      it("holds a frame that arrives before any handler subscribes and delivers it to the first one", async () => {
        const { socket, channel } = await openAuthed();
        socket.emit("message", { data: "early" });
        const received: string[] = [];

        channel.onMessage((text) => received.push(text));

        expect(received).toEqual(["early"]);
      });

      it("stops delivering to a handler after it unsubscribes", async () => {
        const { socket, channel } = await openAuthed();
        const received: string[] = [];
        const unsubscribe = channel.onMessage((text) => received.push(text));
        socket.emit("message", { data: "a" });

        unsubscribe();
        socket.emit("message", { data: "b" });

        expect(received).toEqual(["a"]);
      });

      it("reports the close code when the socket closes", async () => {
        const { socket, channel } = await openAuthed();
        const closes: number[] = [];
        channel.onClose((event) => closes.push(event.code));

        socket.emit("close", { code: 4403 });

        expect(closes).toEqual([4403]);
      });

      it("reports a close that already happened to a late subscriber", async () => {
        const { socket, channel } = await openAuthed();
        socket.emit("close", { code: 1006 });
        const closes: number[] = [];

        channel.onClose((event) => closes.push(event.code));

        expect(closes).toEqual([1006]);
      });

      it("closes the socket on close()", async () => {
        const { socket, channel } = await openAuthed();

        channel.close(1000);

        expect(socket.closedWith).toBe(1000);
      });
    });
  });
});
