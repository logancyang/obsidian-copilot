import type { ServerFrame } from "@/agentMode/protocol/frames";
import type { ConnectOutcome } from "@/remote/client/RemoteClient";
import {
  DEFAULT_BACKOFF_MS,
  RemoteSessionTransport,
  type VisibilitySource,
} from "@/agentMode/mobile/RemoteSessionTransport";
import type { RemoteChannel } from "@/remote/wire";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

class FakeChannel implements RemoteChannel {
  readonly sent: string[] = [];
  closedWith: number | null = null;
  private messageHandlers = new Set<(text: string) => void>();
  private closeHandlers = new Set<(event: { code: number }) => void>();

  send(text: string): void {
    this.sent.push(text);
  }
  onMessage(handler: (text: string) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }
  onClose(handler: (event: { code: number }) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }
  receive(text: string): void {
    for (const handler of [...this.messageHandlers]) handler(text);
  }
  drop(code = 1006): void {
    for (const handler of [...this.closeHandlers]) handler({ code });
  }
}

class FakeVisibility implements VisibilitySource {
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

interface Rig {
  transport: RemoteSessionTransport;
  visibility: FakeVisibility;
  channels: FakeChannel[];
  attempts: Array<(outcome: ConnectOutcome) => void>;
  opens: boolean[];
  frames: ServerFrame[];
  answer: (outcome: ConnectOutcome | "channel") => FakeChannel | null;
}

function rig(): Rig {
  const visibility = new FakeVisibility();
  const attempts: Rig["attempts"] = [];
  const channels: FakeChannel[] = [];
  const transport = new RemoteSessionTransport({
    connect: () => new Promise<ConnectOutcome>((resolve) => attempts.push(resolve)),
    visibility,
  });
  const opens: boolean[] = [];
  const frames: ServerFrame[] = [];
  transport.onOpenChange((open) => opens.push(open));
  transport.onFrame((frame) => frames.push(frame));
  const answer = (outcome: ConnectOutcome | "channel"): FakeChannel | null => {
    const resolve = attempts.shift();
    if (!resolve) throw new Error("no connect attempt is pending");
    if (outcome === "channel") {
      const channel = new FakeChannel();
      channels.push(channel);
      resolve({ ok: true, channel, deviceId: "phone-1" });
      return channel;
    }
    resolve(outcome);
    return null;
  };
  return { transport, visibility, channels, attempts, opens, frames, answer };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const REFUSED: ConnectOutcome = { ok: false, reason: "unreachable", timedOut: false };
const TIMED_OUT: ConnectOutcome = { ok: false, reason: "unreachable", timedOut: true };

describe("RemoteSessionTransport", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe("start()", () => {
    it("dials once, reports open to the client and delivers the desktop's frames", async () => {
      const r = rig();
      r.transport.start();
      expect(r.transport.getLinkState()).toMatchObject({ phase: "connecting", hasBeenOpen: false });

      const channel = r.answer("channel")!;
      await flush();
      channel.receive(JSON.stringify({ type: "hello", v: 1, app: "1.0", hostId: "h", ok: true }));

      expect(r.opens).toEqual([true]);
      expect(r.transport.getLinkState()).toMatchObject({ phase: "open", hasBeenOpen: true });
      expect(r.frames).toEqual([{ type: "hello", v: 1, app: "1.0", hostId: "h", ok: true }]);
    });

    it("waits for the app to be visible before dialing", async () => {
      const r = rig();
      r.visibility.visible = false;
      r.transport.start();
      expect(r.attempts).toHaveLength(0);

      r.visibility.set(true);
      expect(r.attempts).toHaveLength(1);
    });

    it("ignores frames that are not well-formed protocol frames", async () => {
      const r = rig();
      r.transport.start();
      const channel = r.answer("channel")!;
      await flush();
      channel.receive("not json");
      channel.receive(JSON.stringify({ type: "mystery" }));
      expect(r.frames).toEqual([]);
    });
  });

  describe("send()", () => {
    it("writes the frame as JSON on the open channel and drops it while there is none", async () => {
      const r = rig();
      r.transport.start();
      r.transport.send({ type: "focus", sessionId: null });
      const channel = r.answer("channel")!;
      await flush();
      r.transport.send({ type: "focus", sessionId: "s1" });
      expect(channel.sent).toEqual([JSON.stringify({ type: "focus", sessionId: "s1" })]);
    });
  });

  describe("failed attempts", () => {
    it("classifies a refusal as offline and a timeout as unreachable, then retries with growing backoff", async () => {
      const r = rig();
      r.transport.start();
      r.answer(REFUSED);
      await flush();
      expect(r.transport.getLinkState()).toMatchObject({
        phase: "retrying",
        failure: "offline",
        attempts: 1,
      });

      jest.advanceTimersByTime(DEFAULT_BACKOFF_MS[0]);
      expect(r.attempts).toHaveLength(1);
      r.answer(TIMED_OUT);
      await flush();
      expect(r.transport.getLinkState()).toMatchObject({ failure: "unreachable", attempts: 2 });

      jest.advanceTimersByTime(DEFAULT_BACKOFF_MS[1] - 1);
      expect(r.attempts).toHaveLength(0);
      jest.advanceTimersByTime(1);
      expect(r.attempts).toHaveLength(1);
    });

    it("caps the backoff at its last step", async () => {
      const r = rig();
      r.transport.start();
      for (let i = 0; i < DEFAULT_BACKOFF_MS.length + 3; i++) {
        r.answer(REFUSED);
        await flush();
        jest.advanceTimersByTime(DEFAULT_BACKOFF_MS[DEFAULT_BACKOFF_MS.length - 1]);
      }
      expect(r.attempts).toHaveLength(1);
    });

    it("stops retrying when the desktop rejects this phone's token", async () => {
      const r = rig();
      r.transport.start();
      r.answer({ ok: false, reason: "token-rejected" });
      await flush();
      jest.advanceTimersByTime(60_000);
      expect(r.transport.getLinkState().phase).toBe("denied");
      expect(r.attempts).toHaveLength(0);
    });
  });

  describe("unexpected close", () => {
    it("reports closed to the client and redials after the first backoff step", async () => {
      const r = rig();
      r.transport.start();
      const channel = r.answer("channel")!;
      await flush();

      channel.drop(1006);
      expect(r.opens).toEqual([true, false]);
      expect(r.transport.getLinkState().phase).toBe("retrying");
      jest.advanceTimersByTime(DEFAULT_BACKOFF_MS[0]);
      expect(r.attempts).toHaveLength(1);

      r.answer("channel");
      await flush();
      expect(r.opens).toEqual([true, false, true]);
    });

    it.each([4401, 4403])(
      "treats close code %s as a rejected phone and does not redial",
      async (code) => {
        const r = rig();
        r.transport.start();
        const channel = r.answer("channel")!;
        await flush();

        channel.drop(code);
        jest.advanceTimersByTime(60_000);

        expect(r.transport.getLinkState().phase).toBe("denied");
        expect(r.attempts).toHaveLength(0);
      }
    );

    it("keeps growing the backoff for a desktop that accepts the connection and drops it at once", async () => {
      const r = rig();
      r.transport.start();
      for (const step of DEFAULT_BACKOFF_MS.slice(0, 3)) {
        const channel = r.answer("channel")!;
        await flush();
        channel.drop(1009);
        jest.advanceTimersByTime(step - 1);
        expect(r.attempts).toHaveLength(0);
        jest.advanceTimersByTime(1);
        expect(r.attempts).toHaveLength(1);
      }
    });

    it("resets the backoff once a connection has stayed open for a while", async () => {
      const r = rig();
      r.transport.start();
      r.answer(REFUSED);
      await flush();
      jest.advanceTimersByTime(DEFAULT_BACKOFF_MS[0]);
      const channel = r.answer("channel")!;
      await flush();
      expect(r.transport.getLinkState().attempts).toBe(1);

      jest.advanceTimersByTime(5000);
      expect(r.transport.getLinkState().attempts).toBe(0);
      channel.drop(1006);
      jest.advanceTimersByTime(DEFAULT_BACKOFF_MS[0]);
      expect(r.attempts).toHaveLength(1);
    });

    it("waits for the app to return instead of redialing while hidden", async () => {
      const r = rig();
      r.transport.start();
      const channel = r.answer("channel")!;
      await flush();

      r.visibility.set(false);
      channel.drop(1006);
      jest.advanceTimersByTime(60_000);
      expect(r.attempts).toHaveLength(0);

      r.visibility.set(true);
      expect(r.attempts).toHaveLength(1);
    });
  });

  describe("reconnectNow()", () => {
    it(`replaces an open channel when the app returns to the foreground even though it still looks open ${ISSUE}`, async () => {
      const r = rig();
      r.transport.start();
      const stale = r.answer("channel")!;
      await flush();

      r.visibility.set(false);
      r.visibility.set(true);

      expect(stale.closedWith).toBe(1000);
      expect(r.opens).toEqual([true, false]);
      expect(r.attempts).toHaveLength(1);

      const fresh = r.answer("channel")!;
      await flush();
      expect(r.opens).toEqual([true, false, true]);
      stale.receive(JSON.stringify({ type: "hello", v: 1, app: "x", hostId: "old", ok: true }));
      expect(r.frames).toEqual([]);
      fresh.receive(JSON.stringify({ type: "hello", v: 1, app: "x", hostId: "new", ok: true }));
      expect(r.frames).toHaveLength(1);
    });

    it("ignores the late close of a channel it already replaced", async () => {
      const r = rig();
      r.transport.start();
      const stale = r.answer("channel")!;
      await flush();
      r.transport.reconnectNow();
      r.answer("channel");
      await flush();

      stale.drop(1006);

      expect(r.transport.getLinkState().phase).toBe("open");
      expect(r.opens).toEqual([true, false, true]);
    });

    it("closes a channel that connects after a newer attempt replaced it", async () => {
      const r = rig();
      r.transport.start();
      r.transport.reconnectNow();
      const late = r.answer("channel")!;
      await flush();
      expect(late.closedWith).toBe(1000);
      expect(r.opens).toEqual([]);
      r.answer("channel");
      await flush();
      expect(r.opens).toEqual([true]);
    });

    it("dials at once and resets the backoff when called during a retry wait", async () => {
      const r = rig();
      r.transport.start();
      r.answer(TIMED_OUT);
      await flush();
      r.transport.reconnectNow();
      expect(r.attempts).toHaveLength(1);
    });

    it("does nothing once the phone was rejected or the transport closed", async () => {
      const r = rig();
      r.transport.start();
      r.answer({ ok: false, reason: "token-rejected" });
      await flush();
      r.transport.reconnectNow();
      expect(r.attempts).toHaveLength(0);
    });
  });

  describe("close()", () => {
    it("closes the channel, reports closed and never dials again", async () => {
      const r = rig();
      r.transport.start();
      const channel = r.answer("channel")!;
      await flush();

      r.transport.close();
      r.visibility.set(false);
      r.visibility.set(true);
      jest.advanceTimersByTime(60_000);

      expect(channel.closedWith).toBe(1000);
      expect(r.opens).toEqual([true, false]);
      expect(r.transport.getLinkState().phase).toBe("closed");
      expect(r.attempts).toHaveLength(0);
    });
  });

  describe("subscribeLink()", () => {
    it("notifies each state change and stops after unsubscribe", async () => {
      const r = rig();
      const seen: string[] = [];
      const stop = r.transport.subscribeLink(() => seen.push(r.transport.getLinkState().phase));
      r.transport.start();
      r.answer(REFUSED);
      await flush();
      stop();
      jest.advanceTimersByTime(DEFAULT_BACKOFF_MS[0]);
      expect(seen).toEqual(["connecting", "retrying"]);
    });
  });
});
