import type { AgentHarness } from "@earendil-works/pi-agent-core";
import { installPromptCacheKey } from "./promptCache";

type PayloadHook = (event: { payload: unknown }) => { payload: unknown } | undefined;

function harnessStub(): { harness: Pick<AgentHarness, "on">; hook: () => PayloadHook } {
  let registered: PayloadHook | undefined;
  const harness = {
    on: jest.fn((_type: string, handler: PayloadHook) => {
      registered = handler;
      return () => (registered = undefined);
    }),
  } as unknown as Pick<AgentHarness, "on">;
  return {
    harness,
    hook: () => {
      if (!registered) throw new Error("no payload hook registered");
      return registered;
    },
  };
}

describe("piPromptCache", () => {
  describe("installPromptCacheKey()", () => {
    it("stamps every request with the conversation's key", () => {
      const { harness, hook } = harnessStub();
      installPromptCacheKey(harness, "session-1");

      expect(hook()({ payload: { model: "flash", messages: [] } })).toEqual({
        payload: { model: "flash", messages: [], prompt_cache_key: "session-1" },
      });
    });

    it("sends the same key on later turns, which is what makes the cache hit", () => {
      const { harness, hook } = harnessStub();
      installPromptCacheKey(harness, "session-1");

      const first = hook()({ payload: { messages: ["a"] } });
      const second = hook()({ payload: { messages: ["a", "b"] } });

      expect(first).toMatchObject({ payload: { prompt_cache_key: "session-1" } });
      expect(second).toMatchObject({ payload: { prompt_cache_key: "session-1" } });
    });

    it("leaves a payload it does not understand untouched", () => {
      const { harness, hook } = harnessStub();
      installPromptCacheKey(harness, "session-1");

      expect(hook()({ payload: "not-an-object" })).toBeUndefined();
      expect(hook()({ payload: null })).toBeUndefined();
    });

    it("stops stamping once uninstalled", () => {
      const { harness } = harnessStub();

      const uninstall = installPromptCacheKey(harness, "session-1");

      expect(() => uninstall()).not.toThrow();
    });
  });
});
