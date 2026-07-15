import {
  ClaudeCompatibilityStore,
  type ClaudeCompatibilityInput,
} from "./claudeCompatibilityStore";

function input(cacheKey = "claude-a"): ClaudeCompatibilityInput {
  return {
    cacheKey,
    path: "/usr/local/bin/claude",
    source: "custom",
    env: process.env,
  };
}

describe("claudeCompatibilityStore", () => {
  describe("ClaudeCompatibilityStore.get()", () => {
    it("returns a stable checking snapshot until the runtime publishes state", () => {
      const store = new ClaudeCompatibilityStore();
      const first = store.get(input());

      expect(first).toEqual({ kind: "checking", source: "custom" });
      expect(store.get(input())).toBe(first);
    });
  });

  describe("ClaudeCompatibilityStore.refresh()", () => {
    it("publishes an incompatible result and notifies subscribers", async () => {
      const store = new ClaudeCompatibilityStore();
      const listener = jest.fn();
      store.subscribe(listener);
      const run = jest.fn().mockResolvedValue({ stdout: "2.1.205 (Claude Code)" });

      expect(store.get(input())).toEqual({ kind: "checking", source: "custom" });
      await expect(store.refresh(input(), { run })).resolves.toEqual({
        kind: "incompatible",
        source: "custom",
        currentVersion: "2.1.205",
        minVersion: "2.1.206",
        message:
          "Claude Code 2.1.205 is not supported. Copilot requires Claude Code 2.1.206 or newer.",
      });
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("deduplicates concurrent probes for the same runtime", async () => {
      const store = new ClaudeCompatibilityStore();
      let resolveRun!: (value: { stdout: string }) => void;
      const run = jest.fn(
        () => new Promise<{ stdout: string }>((resolve) => (resolveRun = resolve))
      );

      const first = store.refresh(input(), { run });
      const second = store.refresh(input(), { run });
      expect(first).toBe(second);
      expect(run).toHaveBeenCalledTimes(1);

      resolveRun({ stdout: "2.1.206 (Claude Code)" });
      await expect(first).resolves.toEqual({ kind: "ready", source: "custom" });
    });

    it("keeps states independent across runtime cache keys", async () => {
      const store = new ClaudeCompatibilityStore();
      const oldRun = jest.fn().mockResolvedValue({ stdout: "2.1.205 (Claude Code)" });
      const newRun = jest.fn().mockResolvedValue({ stdout: "2.1.206 (Claude Code)" });

      await store.refresh(input("old-path"), { run: oldRun });
      await store.refresh(input("new-path-or-env"), { run: newRun });

      expect(store.get(input("old-path")).kind).toBe("incompatible");
      expect(store.get(input("new-path-or-env"))).toEqual({ kind: "ready", source: "custom" });
    });

    it("returns a readable error when the version cannot be checked", async () => {
      const store = new ClaudeCompatibilityStore();
      const run = jest.fn().mockRejectedValue(new Error("spawn failed"));

      const state = await store.refresh(input(), { run });

      expect(state.kind).toBe("error");
      expect(state.kind === "error" && state.message).toContain(
        "Could not verify the installed Claude Code version"
      );
    });
  });
});
