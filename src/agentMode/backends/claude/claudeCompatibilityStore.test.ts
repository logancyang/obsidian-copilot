import {
  claudeCompatibilityStore,
  type ClaudeCompatibilityInput,
} from "./claudeCompatibilityStore";

function input(cacheKey: string): ClaudeCompatibilityInput {
  return {
    cacheKey,
    path: "/usr/local/bin/claude",
    source: "custom",
    env: process.env,
  };
}

describe("claudeCompatibilityStore", () => {
  describe("refresh()", () => {
    it("publishes an incompatible result and notifies subscribers", async () => {
      const listener = jest.fn();
      const unsubscribe = claudeCompatibilityStore.subscribe(listener);
      const run = jest.fn().mockResolvedValue({ stdout: "2.1.205 (Claude Code)" });

      await expect(
        claudeCompatibilityStore.refresh(input("claude-incompatible"), { run })
      ).resolves.toEqual({
        kind: "incompatible",
        source: "custom",
        currentVersion: "2.1.205",
        minVersion: "2.1.206",
        message:
          "Claude Code 2.1.205 is not supported. Copilot requires Claude Code 2.1.206 or newer.",
      });
      expect(listener).toHaveBeenCalledTimes(2);
      unsubscribe();
    });

    it("returns a readable error when the version cannot be checked", async () => {
      const run = jest.fn().mockRejectedValue(new Error("spawn failed"));

      const state = await claudeCompatibilityStore.refresh(input("claude-error"), { run });

      expect(state.kind).toBe("error");
      expect(state.kind === "error" && state.message).toContain(
        "Could not verify the installed Claude Code version"
      );
    });
  });
});
