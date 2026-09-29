import type { ServerFrame } from "@/agentMode/protocol/frames";
import type { ConnectOutcome } from "@/remote/client/RemoteClient";
import {
  DEFAULT_BACKOFF_MS,
  FIRST_FRAME_TIMEOUT_MS,
  RemoteSessionTransport,
  type VisibilitySource,
} from "@/agentMode/mobile/RemoteSessionTransport";
import type { RemoteChannel } from "@/remote/wire";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

class FakeChannel implements RemoteChannel {
  readonly sent: string[] = [];
  closedWith: number | null = null;
  alreadyClosedWith: number | null = null;
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
    if (this.alreadyClosedWith !== null) {
      handler({ code: this.alreadyClosedWith });
      return () => {};
    }
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
  answer: (outcome: ConnectOutcome | "channel", closedAtOnce?: number) => FakeChannel | null;
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
  const answer = (
    outcome: ConnectOutcome | "channel",
    closedAtOnce?: number
  ): FakeChannel | null => {
    const resolve = attempts.shift();
    if (!resolve) throw new Error("no connect attempt is pending");
    if (outcome === "channel") {
      const channel = new FakeChannel();
      if (closedAtOnce !== undefined) channel.alreadyClosedWith = closedAtOnce;
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

  describe("RemoteSessionTransport", () => {
    describe("start()", () => {
      it(`dials once and reports the link open to the client (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();
        expect(r.attempts).toHaveLength(1);

        r.answer("channel");
        await flush();

        expect(r.opens).toEqual([true]);
        expect(r.transport.getLinkState().phase).toBe("open");
      });

      it(`waits for the app to be visible before dialing (${ISSUE})`, async () => {
        const r = rig();
        r.visibility.visible = false;
        r.transport.start();
        expect(r.attempts).toHaveLength(0);

        r.visibility.set(true);
        expect(r.attempts).toHaveLength(1);
      });

      it(`classifies a refusal as offline and a timeout as unreachable, then retries with growing backoff (${ISSUE})`, async () => {
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

      it(`caps the backoff at its last step (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();
        for (let i = 0; i < DEFAULT_BACKOFF_MS.length + 3; i++) {
          r.answer(REFUSED);
          await flush();
          jest.advanceTimersByTime(DEFAULT_BACKOFF_MS[DEFAULT_BACKOFF_MS.length - 1]);
        }
        expect(r.attempts).toHaveLength(1);
      });

      it(`stops retrying when the desktop rejects this phone's token (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();
        r.answer({ ok: false, reason: "token-rejected" });
        await flush();
        jest.advanceTimersByTime(60_000);
        expect(r.transport.getLinkState().phase).toBe("denied");
        expect(r.attempts).toHaveLength(0);
      });

      it(`reports the link closed to the client and redials after the first backoff step when the channel drops (${ISSUE})`, async () => {
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
        `treats close code %s as a rejected phone and does not redial (${ISSUE})`,
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

      it(`does not report open, and stops retrying, for a channel that already closed as rejected when it was attached (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();

        r.answer("channel", 4403);
        await flush();

        expect(r.opens).toEqual([]);
        expect(r.transport.getLinkState().phase).toBe("denied");
        jest.advanceTimersByTime(60_000);
        expect(r.attempts).toHaveLength(0);
      });

      it(`keeps growing the backoff for a desktop that accepts the connection and drops it at once (${ISSUE})`, async () => {
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

      it(`resets the backoff once a connection has stayed open for a while (${ISSUE})`, async () => {
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

      it(`waits for the app to return instead of redialing while hidden (${ISSUE})`, async () => {
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

      it(`drops a channel whose desktop sends nothing within the reply window and reports an unexpected reply, since a desktop on an older Copilot never answers hello (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();
        const channel = r.answer("channel")!;
        await flush();

        jest.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS);

        expect(channel.closedWith).toBe(1000);
        expect(r.opens).toEqual([true, false]);
        expect(r.transport.getLinkState()).toMatchObject({
          phase: "retrying",
          failure: "protocol",
          attempts: 1,
        });
        jest.advanceTimersByTime(DEFAULT_BACKOFF_MS[0]);
        expect(r.attempts).toHaveLength(1);
      });

      it(`keeps a channel whose desktop answers within the reply window (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();
        const channel = r.answer("channel")!;
        await flush();

        jest.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS - 1);
        channel.receive(JSON.stringify({ type: "hello", v: 1, app: "1.0", hostId: "h", ok: true }));
        jest.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS * 2);

        expect(channel.closedWith).toBeNull();
        expect(r.transport.getLinkState().phase).toBe("open");
      });

      it(`does not count a frame that is not a protocol frame as the desktop's answer (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();
        const channel = r.answer("channel")!;
        await flush();

        channel.receive("not json");
        jest.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS);

        expect(channel.closedWith).toBe(1000);
      });
    });

    describe("reconnectNow()", () => {
      it(`replaces an open channel when the app returns to the foreground even though it still looks open (${ISSUE})`, async () => {
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

      it(`ignores the late close of a channel it already replaced (${ISSUE})`, async () => {
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

      it(`closes a channel that connects after a newer attempt replaced it (${ISSUE})`, async () => {
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

      it(`dials at once when called during a retry wait (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();
        r.answer(TIMED_OUT);
        await flush();
        r.transport.reconnectNow();
        expect(r.attempts).toHaveLength(1);
      });

      it(`does nothing once the phone was rejected (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();
        r.answer({ ok: false, reason: "token-rejected" });
        await flush();
        r.transport.reconnectNow();
        expect(r.attempts).toHaveLength(0);
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

    describe("onFrame()", () => {
      it("delivers the desktop's protocol frames", async () => {
        const r = rig();
        r.transport.start();
        const channel = r.answer("channel")!;
        await flush();

        channel.receive(JSON.stringify({ type: "hello", v: 1, app: "1.0", hostId: "h", ok: true }));

        expect(r.frames).toEqual([{ type: "hello", v: 1, app: "1.0", hostId: "h", ok: true }]);
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

      it("stops delivering to a listener that unsubscribed", async () => {
        const r = rig();
        const seen: ServerFrame[] = [];
        const stop = r.transport.onFrame((frame) => seen.push(frame));
        r.transport.start();
        const channel = r.answer("channel")!;
        await flush();
        stop();

        channel.receive(JSON.stringify({ type: "hello", v: 1, app: "1.0", hostId: "h", ok: true }));

        expect(seen).toEqual([]);
        expect(r.frames).toHaveLength(1);
      });
    });

    describe("onOpenChange()", () => {
      it("tells a listener that subscribes while the link is open that it is open", async () => {
        const r = rig();
        r.transport.start();
        r.answer("channel");
        await flush();
        const late: boolean[] = [];

        r.transport.onOpenChange((open) => late.push(open));

        expect(late).toEqual([true]);
      });

      it("stops notifying a listener that unsubscribed", async () => {
        const r = rig();
        const seen: boolean[] = [];
        const stop = r.transport.onOpenChange((open) => seen.push(open));
        stop();

        r.transport.start();
        r.answer("channel");
        await flush();

        expect(seen).toEqual([]);
      });
    });

    describe("getLinkState()", () => {
      it("starts as connecting with no failure and counts each failed attempt", async () => {
        const r = rig();
        expect(r.transport.getLinkState()).toMatchObject({
          phase: "connecting",
          failure: null,
          attempts: 0,
        });

        r.transport.start();
        r.answer(REFUSED);
        await flush();

        expect(r.transport.getLinkState()).toMatchObject({ failure: "offline", attempts: 1 });
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

    describe("close()", () => {
      it(`closes the channel, reports closed and never dials again (${ISSUE})`, async () => {
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

      it(`closes a channel that connects after the transport was closed (${ISSUE})`, async () => {
        const r = rig();
        r.transport.start();

        r.transport.close();
        const late = r.answer("channel")!;
        await flush();

        expect(late.closedWith).toBe(1000);
        expect(r.opens).toEqual([]);
      });
    });
  });
});
