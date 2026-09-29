import type { ClientFrame, ServerFrame } from "@/agentMode/protocol/frames";
import { createInProcessTransport } from "@/agentMode/session/host/inProcessTransport";
import { settle } from "@/agentMode/session/host/hostTestHarness";

function fakeHost() {
  const received: ClientFrame[] = [];
  const state = { push: (_frame: ServerFrame) => {}, closed: 0 };
  const host = {
    connect: (send: (frame: ServerFrame) => void) => {
      state.push = send;
      return {
        receive: (frame: ClientFrame) => received.push(frame),
        close: () => {
          state.closed += 1;
        },
      };
    },
  };
  return { host, received, state };
}

const HELLO: ClientFrame = { type: "hello", v: 1, app: "x" };
const PAYLOAD: ServerFrame = {
  type: "ops",
  scope: "host",
  from: 1,
  ops: [{ t: "tab.patch", id: "s", patch: { label: null } }],
};

describe("inProcessTransport", () => {
  describe("createInProcessTransport()", () => {
    it("announces open once a listener registers and delivers client frames to the host asynchronously", async () => {
      const { host, received } = fakeHost();
      const transport = createInProcessTransport(host, { serialize: false });
      const opens: boolean[] = [];
      transport.onOpenChange((open) => opens.push(open));
      await settle();
      expect(opens).toEqual([true]);

      transport.send(HELLO);
      expect(received).toEqual([]);
      await settle();
      expect(received).toEqual([HELLO]);
    });

    it("passes frames by reference when serialization is off", async () => {
      const { host, state } = fakeHost();
      const transport = createInProcessTransport(host, { serialize: false });
      const seen: ServerFrame[] = [];
      transport.onFrame((frame) => seen.push(frame));
      transport.onOpenChange(() => {});
      await settle();
      transport.send(HELLO);
      await settle();
      state.push(PAYLOAD);
      await settle();
      expect(seen[0]).toBe(PAYLOAD);
    });

    it("round-trips frames through JSON when serialization is on, dropping undefined and copying objects", async () => {
      const { host, state, received } = fakeHost();
      const transport = createInProcessTransport(host, { serialize: true });
      const seen: ServerFrame[] = [];
      transport.onFrame((frame) => seen.push(frame));
      transport.onOpenChange(() => {});
      await settle();
      const outgoing = { type: "hello", v: 1, app: "x", extra: undefined } as ClientFrame;
      transport.send(outgoing);
      await settle();
      expect(received[0]).not.toBe(outgoing);
      expect(Object.keys(received[0])).not.toContain("extra");
      state.push(PAYLOAD);
      await settle();
      expect(seen[0]).toEqual(PAYLOAD);
      expect(seen[0]).not.toBe(PAYLOAD);
    });

    it("stops delivering after close and reports the socket closed", async () => {
      const { host, state, received } = fakeHost();
      const transport = createInProcessTransport(host, { serialize: false });
      const seen: ServerFrame[] = [];
      const opens: boolean[] = [];
      transport.onFrame((frame) => seen.push(frame));
      transport.onOpenChange((open) => opens.push(open));
      await settle();
      transport.send(HELLO);
      await settle();
      transport.close();
      state.push(PAYLOAD);
      transport.send(HELLO);
      await settle();
      expect(seen).toEqual([]);
      expect(received).toHaveLength(1);
      expect(opens).toEqual([true, false]);
      expect(state.closed).toBe(1);
    });

    it("disconnect drops in-flight frames, reconnect opens a fresh host connection, and dropNextFrame loses one frame", async () => {
      const { host, state, received } = fakeHost();
      const transport = createInProcessTransport(host, { serialize: false });
      const seen: ServerFrame[] = [];
      const opens: boolean[] = [];
      transport.onFrame((frame) => seen.push(frame));
      transport.onOpenChange((open) => opens.push(open));
      await settle();
      transport.send(HELLO);
      await settle();

      transport.disconnect();
      state.push(PAYLOAD);
      await settle();
      expect(seen).toEqual([]);
      expect(opens).toEqual([true, false]);

      transport.reconnect();
      transport.send(HELLO);
      await settle();
      expect(received).toHaveLength(2);

      transport.dropNextFrame();
      state.push(PAYLOAD);
      state.push(PAYLOAD);
      await settle();
      expect(seen).toHaveLength(1);
    });
  });
});
