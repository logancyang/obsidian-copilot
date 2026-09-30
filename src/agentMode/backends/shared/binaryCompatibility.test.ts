import { classifyBinaryInstall, assertBinaryCompatible } from "./binaryCompatibility";

describe("binaryCompatibility", () => {
  describe("classifyBinaryInstall()", () => {
    const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/535";
    const installed = (version: string, source: "managed" | "custom" = "managed") => ({
      kind: "installed" as const,
      version,
      source,
    });

    it(`${ISSUE} reports a custom or managed install at or above the minimum as ready with its source`, () => {
      expect(classifyBinaryInstall(installed("2.0.0"), "2.0.0", "Codex")).toEqual({
        kind: "ready",
        source: "managed",
      });
      expect(classifyBinaryInstall(installed("3.0.0", "custom"), "2.0.0", "Codex")).toEqual({
        kind: "ready",
        source: "custom",
      });
    });

    it(`${ISSUE} reports an install below the minimum as incompatible with both versions`, () => {
      expect(classifyBinaryInstall(installed("1.9.0"), "2.0.0", "Codex")).toMatchObject({
        kind: "incompatible",
        source: "managed",
        currentVersion: "1.9.0",
        minVersion: "2.0.0",
        message: "Codex v1.9.0 is not supported. Copilot requires Codex v2.0.0 or newer.",
      });
    });

    it(`${ISSUE} reports a prerelease of the minimum version as incompatible`, () => {
      expect(classifyBinaryInstall(installed("2.0.0-beta.1"), "2.0.0", "Codex").kind).toBe(
        "incompatible"
      );
    });

    it(`${ISSUE} reports an unparseable installed version as an error`, () => {
      expect(classifyBinaryInstall(installed("garbage"), "2.0.0", "Codex").kind).toBe("error");
    });

    it(`${ISSUE} passes absent and error inspections through unchanged`, () => {
      expect(classifyBinaryInstall({ kind: "absent" }, "2.0.0", "Codex")).toEqual({
        kind: "absent",
      });
      expect(
        classifyBinaryInstall({ kind: "error", message: "invalid package" }, "2.0.0", "Codex")
      ).toEqual({ kind: "error", message: "invalid package" });
    });
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
