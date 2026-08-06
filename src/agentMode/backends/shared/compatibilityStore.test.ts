import {
  CompatibilityStore,
  type CompatibilityRefreshOptions,
  type CompatibilityStoreInput,
} from "./compatibilityStore";

interface TestOptions extends CompatibilityRefreshOptions {
  result?: "ready" | "error";
}

function input(cacheKey = "runtime-a"): CompatibilityStoreInput {
  return { cacheKey, source: "custom" };
}

describe("compatibilityStore", () => {
  describe("CompatibilityStore.get()", () => {
    it("returns a stable checking snapshot until the runtime publishes state", () => {
      const store = new CompatibilityStore(async () => ({ kind: "ready", source: "custom" }));
      const first = store.get(input());

      expect(first).toEqual({ kind: "checking", source: "custom" });
      expect(store.get(input())).toBe(first);
    });
  });

  describe("CompatibilityStore.refresh()", () => {
    it("publishes probe transitions and keeps cache keys independent", async () => {
      const store = new CompatibilityStore<CompatibilityStoreInput, TestOptions>(
        async (_input, options) =>
          options.result === "error"
            ? { kind: "error", message: "not supported" }
            : { kind: "ready", source: "custom" }
      );
      const listener = jest.fn();
      store.subscribe(listener);

      await expect(store.refresh(input("legacy"), { result: "error" })).resolves.toEqual({
        kind: "error",
        message: "not supported",
      });
      await expect(store.refresh(input("maintained"))).resolves.toEqual({
        kind: "ready",
        source: "custom",
      });

      expect(listener).toHaveBeenCalledTimes(4);
      expect(listener).toHaveBeenNthCalledWith(1, "legacy");
      expect(listener).toHaveBeenNthCalledWith(3, "maintained");
      expect(store.get(input("legacy"))).toEqual({
        kind: "error",
        message: "not supported",
      });
      expect(store.get(input("maintained"))).toEqual({
        kind: "ready",
        source: "custom",
      });
    });

    it("deduplicates concurrent probes for the same runtime", async () => {
      let resolveProbe!: (state: { kind: "ready"; source: "custom" }) => void;
      const probe = jest.fn(
        () =>
          new Promise<{ kind: "ready"; source: "custom" }>((resolve) => {
            resolveProbe = resolve;
          })
      );
      const store = new CompatibilityStore(probe);

      const first = store.refresh(input());
      const second = store.refresh(input());

      expect(first).toBe(second);
      expect(probe).toHaveBeenCalledTimes(1);
      resolveProbe({ kind: "ready", source: "custom" });
      await expect(first).resolves.toEqual({ kind: "ready", source: "custom" });
    });

    it("turns thrown probe failures into readable error states", async () => {
      const store = new CompatibilityStore(async () => {
        throw new Error("spawn failed");
      });

      await expect(store.refresh(input())).resolves.toEqual({
        kind: "error",
        message: "spawn failed",
      });
    });
  });

  describe("CompatibilityStore.subscribe()", () => {
    it("stops notifying a listener after unsubscribe", async () => {
      const store = new CompatibilityStore(async () => ({ kind: "ready", source: "custom" }));
      const listener = jest.fn();
      const unsubscribe = store.subscribe(listener);
      unsubscribe();

      await store.refresh(input());

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
