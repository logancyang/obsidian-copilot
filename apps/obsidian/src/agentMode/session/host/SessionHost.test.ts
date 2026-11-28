import { AgentSession } from "@/agentMode/session/AgentSession";
import { SessionHost } from "@/agentMode/session/host/SessionHost";
import { FakeHostChat, FakeHostChats } from "@/agentMode/session/host/testing/fakeHostChats";
import type { BackendProcess, SessionUpdateHandler } from "@/agentMode/session/types";
import { SessionClient } from "@copilot/protocol/client";
import type { ClientFrame, HostFrame } from "@copilot/protocol/frames";
import type { PlanUsage } from "@copilot/protocol/planUsage";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));

function usage(usedTokens: number): SessionUsage {
  return { usedTokens, contextWindow: 200_000, updatedAt: usedTokens };
}

const PLAN_USAGE: PlanUsage = {
  windows: [{ id: "seven_day", label: "Weekly", percent: 17, resetsAt: 9_000 }],
  updatedAt: 1,
};

interface Wired {
  client: SessionClient;
  received: HostFrame[];
  send: (frame: ClientFrame) => void;
}

function wire(host: SessionHost, deliver: (frame: HostFrame) => boolean = () => true): Wired {
  const received: HostFrame[] = [];
  const client = new SessionClient((frame) => send(frame));
  const send = host.connect((frame) => {
    received.push(frame);
    if (deliver(frame)) client.receive(frame);
  });
  return { client, received, send };
}

function rawConnection(host: SessionHost): {
  send: (frame: ClientFrame) => void;
  received: HostFrame[];
} {
  const received: HostFrame[] = [];
  const send = host.connect((frame) => received.push(frame));
  return { send, received };
}

describe("SessionHost", () => {
  describe("SessionHost", () => {
    describe("connect()", () => {
      it("answers a subscribe with a snapshot of the chat's usage and plan usage", () => {
        const chat = new FakeHostChat(usage(1_000), PLAN_USAGE);
        const { client } = wire(new SessionHost(new FakeHostChats({ "chat-1": chat })));

        client.watch("chat-1");

        expect(client.getState("chat-1")).toEqual({ usage: usage(1_000), planUsage: PLAN_USAGE });
      });

      it("sends each usage and plan usage change of a subscribed chat as numbered ops", () => {
        const chat = new FakeHostChat();
        const { client, received } = wire(new SessionHost(new FakeHostChats({ "chat-1": chat })));
        client.watch("chat-1");

        chat.change({ usage: usage(1_000) });
        chat.change({ usage: usage(2_000), planUsage: PLAN_USAGE });

        expect(received.slice(1)).toEqual([
          {
            type: "ops",
            scope: "chat-1",
            from: 1,
            ops: [{ type: "slice", key: "usage", value: usage(1_000) }],
          },
          {
            type: "ops",
            scope: "chat-1",
            from: 2,
            ops: [
              { type: "slice", key: "usage", value: usage(2_000) },
              { type: "slice", key: "planUsage", value: PLAN_USAGE },
            ],
          },
        ]);
      });

      it("keeps a client's replica equal to the host state through a run of changes", () => {
        const chat = new FakeHostChat();
        const host = new SessionHost(new FakeHostChats({ "chat-1": chat }));
        const { client } = wire(host);
        client.watch("chat-1");

        for (let used = 1; used <= 20; used++) {
          chat.change({ usage: usage(used * 1_000), planUsage: used % 5 ? PLAN_USAGE : null });
        }
        const late = wire(host);
        late.client.watch("chat-1");

        expect(client.getState("chat-1")).toEqual(late.client.getState("chat-1"));
        expect(client.getState("chat-1")).toEqual({ usage: usage(20_000), planUsage: null });
      });

      it("gives a late subscriber a snapshot numbered at the host's latest op", () => {
        const chat = new FakeHostChat();
        const host = new SessionHost(new FakeHostChats({ "chat-1": chat }));
        wire(host).client.watch("chat-1");
        chat.change({ usage: usage(1_000) });
        chat.change({ planUsage: PLAN_USAGE });

        const late = rawConnection(host);
        late.send({ type: "subscribe", scope: "chat-1" });

        expect(late.received).toEqual([
          {
            type: "snapshot",
            scope: "chat-1",
            seq: 2,
            state: { usage: usage(1_000), planUsage: PLAN_USAGE },
          },
        ]);
      });

      it("sends nothing for a chat change that left both usage slices as they were", () => {
        const chat = new FakeHostChat(usage(1_000));
        const { client, received } = wire(new SessionHost(new FakeHostChats({ "chat-1": chat })));
        client.watch("chat-1");

        chat.change({});

        expect(received.map((frame) => frame.type)).toEqual(["snapshot"]);
      });

      it("brings a client that missed an ops frame back in step with a fresh snapshot", () => {
        const chat = new FakeHostChat();
        const host = new SessionHost(new FakeHostChats({ "chat-1": chat }));
        let dropNextOps = false;
        const { client, received } = wire(host, (frame) => {
          if (frame.type !== "ops" || !dropNextOps) return true;
          dropNextOps = false;
          return false;
        });
        client.watch("chat-1");
        chat.change({ usage: usage(1_000) });

        dropNextOps = true;
        chat.change({ usage: usage(2_000) });
        chat.change({ planUsage: PLAN_USAGE });

        expect(received.at(-1)).toEqual({
          type: "snapshot",
          scope: "chat-1",
          seq: 3,
          state: { usage: usage(2_000), planUsage: PLAN_USAGE },
        });
        expect(client.getState("chat-1")).toEqual({ usage: usage(2_000), planUsage: PLAN_USAGE });
        chat.change({ usage: usage(4_000) });
        expect(client.getState("chat-1")).toEqual({ usage: usage(4_000), planUsage: PLAN_USAGE });
      });

      it("stops sending a chat's ops to a client once it unsubscribes", () => {
        const chat = new FakeHostChat();
        const host = new SessionHost(new FakeHostChats({ "chat-1": chat }));
        const connection = rawConnection(host);
        connection.send({ type: "subscribe", scope: "chat-1" });

        connection.send({ type: "unsubscribe", scope: "chat-1" });
        chat.change({ usage: usage(1_000) });

        expect(connection.received.map((frame) => frame.type)).toEqual(["snapshot"]);
      });

      it("listens to a chat once however many clients subscribe to it", () => {
        const chat = new FakeHostChat();
        const host = new SessionHost(new FakeHostChats({ "chat-1": chat }));

        wire(host).client.watch("chat-1");
        wire(host).client.watch("chat-1");

        expect(chat.listeners.size).toBe(1);
      });

      it("keeps each chat's state and sequence apart", () => {
        const first = new FakeHostChat(usage(1_000));
        const second = new FakeHostChat(usage(50_000), PLAN_USAGE);
        const { client } = wire(
          new SessionHost(new FakeHostChats({ "chat-1": first, "chat-2": second }))
        );
        client.watch("chat-1");
        client.watch("chat-2");

        second.change({ usage: usage(60_000) });

        expect(client.getState("chat-1")).toEqual({ usage: usage(1_000), planUsage: null });
        expect(client.getState("chat-2")).toEqual({ usage: usage(60_000), planUsage: PLAN_USAGE });
      });

      it("gives a subscribe to a chat it cannot find an empty snapshot", () => {
        const connection = rawConnection(new SessionHost(new FakeHostChats()));

        connection.send({ type: "subscribe", scope: "missing" });

        expect(connection.received).toEqual([
          { type: "snapshot", scope: "missing", seq: 0, state: { usage: null, planUsage: null } },
        ]);
      });

      it("keeps listening to a chat while another client still subscribes to it", () => {
        const chat = new FakeHostChat();
        const host = new SessionHost(new FakeHostChats({ "chat-1": chat }));
        const leaving = rawConnection(host);
        const staying = rawConnection(host);
        leaving.send({ type: "subscribe", scope: "chat-1" });
        staying.send({ type: "subscribe", scope: "chat-1" });

        leaving.send({ type: "unsubscribe", scope: "chat-1" });
        chat.change({ usage: usage(1_000) });

        expect(chat.listeners.size).toBe(1);
        expect(staying.received.map((frame) => frame.type)).toEqual(["snapshot", "ops"]);
      });

      it("stops listening to a chat once its last client leaves, and starts it fresh on the next subscribe", () => {
        const chat = new FakeHostChat(usage(1_000));
        const host = new SessionHost(new FakeHostChats({ "chat-1": chat }));
        const connection = rawConnection(host);
        connection.send({ type: "subscribe", scope: "chat-1" });
        chat.change({ usage: usage(2_000) });

        connection.send({ type: "unsubscribe", scope: "chat-1" });
        expect(chat.listeners.size).toBe(0);

        connection.send({ type: "subscribe", scope: "chat-1" });
        expect(connection.received.at(-1)).toEqual({
          type: "snapshot",
          scope: "chat-1",
          seq: 0,
          state: { usage: usage(2_000), planUsage: null },
        });
      });

      it("turns a usage update an agent reports for a real chat into an op the replica applies", () => {
        let handler: SessionUpdateHandler | null = null;
        const backend = {
          registerSessionHandler: (_id: string, h: SessionUpdateHandler) => {
            handler = h;
            return () => {};
          },
        } as unknown as BackendProcess;
        const session = new AgentSession({
          backend,
          backendSessionId: "acp-1",
          internalId: "chat-1",
          backendId: "claude",
        });
        const { client } = wire(new SessionHost(new FakeHostChats({ "chat-1": session })));
        client.watch("chat-1");

        handler!({
          sessionId: "acp-1",
          update: { sessionUpdate: "usage_update", usage: usage(42_000) },
        });
        handler!({
          sessionId: "acp-1",
          update: { sessionUpdate: "plan_usage_update", planUsage: PLAN_USAGE },
        });

        expect(client.getState("chat-1")).toEqual({ usage: usage(42_000), planUsage: PLAN_USAGE });
      });
    });

    describe("dispose()", () => {
      it("stops listening to every chat a client still subscribes to", () => {
        const chat = new FakeHostChat();
        const host = new SessionHost(new FakeHostChats({ "chat-1": chat }));
        wire(host).client.watch("chat-1");

        host.dispose();

        expect(chat.listeners.size).toBe(0);
      });
    });
  });
});
