import { SessionClient } from "@copilot/protocol/client";
import type { ClientFrame, HostFrame } from "@copilot/protocol/frames";
import type { SessionState } from "@copilot/protocol/session";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";

const USAGE: SessionUsage = { usedTokens: 1_000, contextWindow: 200_000, updatedAt: 1 };
const LATER_USAGE: SessionUsage = { usedTokens: 9_000, contextWindow: 200_000, updatedAt: 2 };
const STATE: SessionState = { usage: USAGE, planUsage: null };

function connectedClient(): { client: SessionClient; sent: ClientFrame[] } {
  const sent: ClientFrame[] = [];
  const client = new SessionClient((frame) => sent.push(frame));
  return { client, sent };
}

function snapshot(seq: number, state: SessionState = STATE): HostFrame {
  return { type: "snapshot", liveChatId: "chat-1", seq, state };
}

function usageOps(from: number, usage: SessionUsage): HostFrame {
  return {
    type: "ops",
    liveChatId: "chat-1",
    from,
    ops: [{ type: "slice", key: "usage", value: usage }],
  };
}

describe("client", () => {
  describe("SessionClient", () => {
    describe("watch()", () => {
      it("subscribes to a live chat the first time it is watched, and not again for a second watcher", () => {
        const { client, sent } = connectedClient();

        client.watch("chat-1");
        client.watch("chat-1");

        expect(sent).toEqual([{ type: "subscribe", liveChatId: "chat-1" }]);
      });

      it("unsubscribes and drops the replica once the last watcher releases the live chat", () => {
        const { client, sent } = connectedClient();
        const releaseFirst = client.watch("chat-1");
        const releaseSecond = client.watch("chat-1");
        client.receive(snapshot(0));

        releaseFirst();
        expect(client.getState("chat-1")).toEqual(STATE);
        expect(sent).not.toContainEqual({ type: "unsubscribe", liveChatId: "chat-1" });

        releaseSecond();
        expect(client.getState("chat-1")).toBeNull();
        expect(sent).toContainEqual({ type: "unsubscribe", liveChatId: "chat-1" });
      });
    });

    describe("receive()", () => {
      it("keeps the snapshot of a watched live chat as its replica and tells listeners", () => {
        const { client } = connectedClient();
        const listener = jest.fn();
        client.subscribe(listener);
        client.watch("chat-1");

        client.receive(snapshot(3));

        expect(client.getState("chat-1")).toEqual(STATE);
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("applies ops that continue the replica's sequence, in order", () => {
        const { client } = connectedClient();
        client.watch("chat-1");
        client.receive(snapshot(3, { usage: null, planUsage: null }));

        client.receive({
          type: "ops",
          liveChatId: "chat-1",
          from: 4,
          ops: [
            { type: "slice", key: "usage", value: USAGE },
            { type: "slice", key: "usage", value: LATER_USAGE },
          ],
        });
        client.receive(usageOps(6, USAGE));

        expect(client.getState("chat-1")).toEqual({ usage: USAGE, planUsage: null });
      });

      it("asks for a fresh snapshot on a sequence gap and keeps the last good state until it arrives", () => {
        const { client, sent } = connectedClient();
        client.watch("chat-1");
        client.receive(snapshot(3));
        sent.length = 0;

        client.receive(usageOps(5, LATER_USAGE));

        expect(sent).toEqual([{ type: "subscribe", liveChatId: "chat-1" }]);
        expect(client.getState("chat-1")).toEqual(STATE);
      });

      it("ignores ops after a gap until the fresh snapshot, then follows the snapshot's sequence", () => {
        const { client, sent } = connectedClient();
        client.watch("chat-1");
        client.receive(snapshot(3));
        client.receive(usageOps(5, LATER_USAGE));

        client.receive(usageOps(4, LATER_USAGE));
        client.receive(usageOps(6, LATER_USAGE));
        expect(client.getState("chat-1")).toEqual(STATE);
        expect(sent.filter((frame) => frame.type === "subscribe")).toHaveLength(2);

        client.receive(snapshot(6, { usage: LATER_USAGE, planUsage: null }));
        client.receive(usageOps(7, USAGE));
        expect(client.getState("chat-1")).toEqual({ usage: USAGE, planUsage: null });
      });

      it("treats ops that repeat sequence numbers it already applied as a gap", () => {
        const { client, sent } = connectedClient();
        client.watch("chat-1");
        client.receive(snapshot(3));
        sent.length = 0;

        client.receive(usageOps(3, LATER_USAGE));

        expect(sent).toEqual([{ type: "subscribe", liveChatId: "chat-1" }]);
        expect(client.getState("chat-1")).toEqual(STATE);
      });

      it("ignores snapshots and ops for a live chat nobody watches", () => {
        const { client } = connectedClient();
        const listener = jest.fn();
        client.subscribe(listener);

        client.receive(snapshot(0));
        client.receive(usageOps(1, USAGE));

        expect(client.getState("chat-1")).toBeNull();
        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe("subscribe()", () => {
      it("stops telling a listener about changes once it unsubscribes", () => {
        const { client } = connectedClient();
        const listener = jest.fn();
        const unsubscribe = client.subscribe(listener);
        client.watch("chat-1");

        unsubscribe();
        client.receive(snapshot(0));

        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe("getState()", () => {
      it("returns null for a watched live chat whose snapshot has not arrived", () => {
        const { client } = connectedClient();
        client.watch("chat-1");

        expect(client.getState("chat-1")).toBeNull();
      });

      it("returns the same state object until an op changes it, so React can skip renders", () => {
        const { client } = connectedClient();
        client.watch("chat-1");
        client.receive(snapshot(0));
        const first = client.getState("chat-1");

        expect(client.getState("chat-1")).toBe(first);
        client.receive(usageOps(1, LATER_USAGE));
        expect(client.getState("chat-1")).not.toBe(first);
      });
    });
  });
});
