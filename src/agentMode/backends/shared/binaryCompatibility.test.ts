import { classifyBinaryInstall, assertBinaryCompatible } from "./binaryCompatibility";

describe("binaryCompatibility", () => {
  describe("classifyBinaryInstall()", () => {
    it.each(["Codex", "opencode"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/535 classifies every minimum boundary for %s",
      (name) => {
        const installed = (version: string) => ({
          kind: "installed" as const,
          version,
          source: "managed" as const,
        });
        expect(classifyBinaryInstall(installed("1.9.0"), "2.0.0", name)).toMatchObject({
          kind: "incompatible",
          currentVersion: "1.9.0",
          minVersion: "2.0.0",
        });
        expect(classifyBinaryInstall(installed("2.0.0-beta.1"), "2.0.0", name).kind).toBe(
          "incompatible"
        );
        expect(classifyBinaryInstall(installed("2.0.0"), "2.0.0", name)).toEqual({
          kind: "ready",
          source: "managed",
        });
        expect(
          classifyBinaryInstall({ ...installed("3.0.0"), source: "custom" }, "2.0.0", name)
        ).toEqual({ kind: "ready", source: "custom" });
        expect(classifyBinaryInstall(installed("garbage"), "2.0.0", name).kind).toBe("error");
        expect(classifyBinaryInstall({ kind: "absent" }, "2.0.0", name)).toEqual({
          kind: "absent",
        });
        expect(
          classifyBinaryInstall({ kind: "error", message: "invalid package" }, "2.0.0", name)
        ).toEqual({ kind: "error", message: "invalid package" });
      }
    );
  });
  describe("assertBinaryCompatible()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/535 allows supported runtimes and rejects incompatible, invalid, or missing installs", () => {
      expect(() =>
        assertBinaryCompatible(
          { kind: "installed", version: "2.0.0", source: "custom" },
          "1.0.0",
          "Agent"
        )
      ).not.toThrow();
      expect(() =>
        assertBinaryCompatible(
          { kind: "installed", version: "0.9.0", source: "custom" },
          "1.0.0",
          "Agent"
        )
      ).toThrow("requires");
      expect(() =>
        assertBinaryCompatible({ kind: "error", message: "invalid package" }, "1.0.0", "Agent")
      ).toThrow("invalid package");
      expect(() => assertBinaryCompatible({ kind: "absent" }, "1.0.0", "Agent")).toThrow(
        "not installed"
      );
    });
  });
});
