import { connectInProcess } from "@/agentMode/session/host/inProcessTransport";
import { SessionHost } from "@/agentMode/session/host/SessionHost";
import { FakeHostChat, FakeHostChats } from "@/agentMode/session/host/testing/fakeHostChats";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";

const USAGE: SessionUsage = { usedTokens: 1_000, contextWindow: 200_000, updatedAt: 1 };
const LATER_USAGE: SessionUsage = { usedTokens: 2_000, contextWindow: 200_000, updatedAt: 2 };

function hostWith(chat: FakeHostChat): SessionHost {
  return new SessionHost(new FakeHostChats({ "chat-1": chat }));
}

describe("inProcessTransport", () => {
  describe("connectInProcess()", () => {
    it.each([true, false])(
      "connects a client that holds a watched chat's state as soon as watch returns (checks %s)",
      (checkFrames) => {
        const client = connectInProcess(hostWith(new FakeHostChat(USAGE)), { checkFrames });

        client.watch("chat-1");

        expect(client.getState("chat-1")).toEqual({ usage: USAGE, planUsage: null });
      }
    );

    it("delivers a chat change to the client before the chat's notification returns", () => {
      const chat = new FakeHostChat(USAGE);
      const client = connectInProcess(hostWith(chat), { checkFrames: true });
      client.watch("chat-1");
      const seen: (SessionUsage | null | undefined)[] = [];
      client.subscribe(() => seen.push(client.getState("chat-1")?.usage));

      chat.change({ usage: LATER_USAGE });

      expect(seen).toEqual([LATER_USAGE]);
    });

    it("with checks on, rejects a host frame holding a value JSON cannot carry and names its field", () => {
      const chat = new FakeHostChat(USAGE);
      const client = connectInProcess(hostWith(chat), { checkFrames: true });
      client.watch("chat-1");
      const notPlain = { ...LATER_USAGE, read: () => 2_000 } as SessionUsage;

      expect(() => chat.change({ usage: notPlain })).toThrow(
        'A chat protocol frame holds function at "ops[0].value.read", which cannot cross to another process.'
      );
    });

    it("with checks on, rejects a snapshot holding a class instance before the client sees it", () => {
      const usageWithMap = { ...USAGE, byModel: new Map([["sonnet", 1_000]]) } as SessionUsage;
      const client = connectInProcess(hostWith(new FakeHostChat(usageWithMap)), {
        checkFrames: true,
      });

      expect(() => client.watch("chat-1")).toThrow('holds Map at "state.usage.byModel"');
      expect(client.getState("chat-1")).toBeNull();
    });

    it("with checks on, freezes the state it hands over so neither side can change the other's copy", () => {
      const usage = { ...USAGE };
      const client = connectInProcess(hostWith(new FakeHostChat(usage)), { checkFrames: true });

      client.watch("chat-1");

      const state = client.getState("chat-1");
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state?.usage)).toBe(true);
      expect(Object.isFrozen(usage)).toBe(true);
    });

    it("with checks off, hands over the host's objects as they are, as production builds do", () => {
      const usage = { ...USAGE };
      const client = connectInProcess(hostWith(new FakeHostChat(usage)), { checkFrames: false });

      client.watch("chat-1");

      expect(client.getState("chat-1")?.usage).toBe(usage);
      expect(Object.isFrozen(usage)).toBe(false);
    });
  });
});
