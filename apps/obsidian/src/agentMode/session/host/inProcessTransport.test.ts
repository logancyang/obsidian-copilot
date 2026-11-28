import { connectInProcess } from "@/agentMode/session/host/inProcessTransport";
import { SessionHost } from "@/agentMode/session/host/SessionHost";
import { FakeHostChat, FakeHostChats } from "@/agentMode/session/host/testing/fakeHostChats";
import type { SessionClient } from "@copilot/protocol/client";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";

const USAGE: SessionUsage = { usedTokens: 1_000, contextWindow: 200_000, updatedAt: 1 };
const LATER_USAGE: SessionUsage = { usedTokens: 2_000, contextWindow: 200_000, updatedAt: 2 };

function hostWith(chat: FakeHostChat): SessionHost {
  return new SessionHost(new FakeHostChats({ "chat-1": chat }));
}

function asProductionBuild<T>(run: () => T): T {
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    return run();
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
}

describe("inProcessTransport", () => {
  describe("connectInProcess()", () => {
    it.each([
      ["a development build", (connect: () => SessionClient) => connect()],
      ["a production build", asProductionBuild],
    ])(
      "in %s, connects a client that holds a watched chat's state as soon as watch returns",
      (_build, build) => {
        const client = build(() => connectInProcess(hostWith(new FakeHostChat(USAGE))));

        client.watch("chat-1");

        expect(client.getState("chat-1")).toEqual({ usage: USAGE, planUsage: null });
      }
    );

    it("delivers a chat change to the client before the chat's notification returns", () => {
      const chat = new FakeHostChat(USAGE);
      const client = connectInProcess(hostWith(chat));
      client.watch("chat-1");
      const seen: (SessionUsage | null | undefined)[] = [];
      client.subscribe(() => seen.push(client.getState("chat-1")?.usage));

      chat.change({ usage: LATER_USAGE });

      expect(seen).toEqual([LATER_USAGE]);
    });

    it("applies, in order, a change a listener causes while the previous change is being delivered", () => {
      const chat = new FakeHostChat(USAGE);
      const other = new FakeHostChat(LATER_USAGE);
      const client = connectInProcess(
        new SessionHost(new FakeHostChats({ "chat-1": chat, "chat-2": other }))
      );
      client.watch("chat-1");
      const seen: (number | undefined)[] = [];
      let reacted = false;
      client.subscribe(() => {
        seen.push(client.getState("chat-1")?.usage?.usedTokens);
        if (reacted) return;
        reacted = true;
        client.watch("chat-2");
        chat.change({ usage: { ...USAGE, usedTokens: 3_000 } });
      });

      chat.change({ usage: LATER_USAGE });

      expect(seen).toEqual([2_000, 2_000, 3_000]);
      expect(client.getState("chat-1")?.usage?.usedTokens).toBe(3_000);
      expect(client.getState("chat-2")?.usage).toEqual(LATER_USAGE);
    });

    it("outside production, rejects a host frame holding a value JSON cannot carry and names its field", () => {
      const chat = new FakeHostChat(USAGE);
      const client = connectInProcess(hostWith(chat));
      client.watch("chat-1");
      const notPlain = { ...LATER_USAGE, read: () => 2_000 } as SessionUsage;

      expect(() => chat.change({ usage: notPlain })).toThrow(
        'A chat protocol frame holds function at "ops[0].value.read", which cannot cross to another process.'
      );
    });

    it("outside production, rejects a snapshot holding a class instance before the client sees it", () => {
      const usageWithMap = { ...USAGE, byModel: new Map([["sonnet", 1_000]]) } as SessionUsage;
      const client = connectInProcess(hostWith(new FakeHostChat(usageWithMap)));

      expect(() => client.watch("chat-1")).toThrow('holds Map at "state.usage.byModel"');
      expect(client.getState("chat-1")).toBeNull();
    });

    it("outside production, freezes the state it hands over so neither side can change the other's copy", () => {
      const usage = { ...USAGE };
      const client = connectInProcess(hostWith(new FakeHostChat(usage)));

      client.watch("chat-1");

      const state = client.getState("chat-1");
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state?.usage)).toBe(true);
      expect(Object.isFrozen(usage)).toBe(true);
    });

    it("in a production build, hands over the host's objects as they are", () => {
      const usage = { ...USAGE };
      const client = asProductionBuild(() => connectInProcess(hostWith(new FakeHostChat(usage))));

      client.watch("chat-1");

      expect(client.getState("chat-1")?.usage).toBe(usage);
      expect(Object.isFrozen(usage)).toBe(false);
    });
  });
});
