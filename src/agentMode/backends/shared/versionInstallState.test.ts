import {
  isVersionSupported,
  versionInstallState,
} from "@/agentMode/backends/shared/versionInstallState";

describe("versionInstallState", () => {
  describe("isVersionSupported()", () => {
    it.each([
      ["2.3.4", true],
      ["2.3.4+build-beta.1", true],
      ["2.3.5-beta.1", true],
      ["2.3.4-beta.1", false],
      ["2.3.4-beta.1+build.1", false],
      ["2.3.3", false],
    ] as const)(
      "classifies %s against a stable floor as supported=%s (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)",
      (version, supported) => expect(isVersionSupported(version, "2.3.4")).toBe(supported)
    );
  });
  describe("versionInstallState()", () => {
    it("compares the release while retaining a native revision identity in upgrade guidance (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      expect(versionInstallState("Adapter", "2.3.4", "2.3.4", "managed", "2.3.4-r1")).toEqual({
        kind: "ready",
        source: "managed",
      });
      expect(
        versionInstallState("Adapter", "2.3.4-beta.1", "2.3.4", "managed", "2.3.4-beta.1-r1")
      ).toEqual({
        kind: "incompatible",
        source: "managed",
        currentVersion: "2.3.4-beta.1-r1",
        minVersion: "2.3.4",
        message:
          "Adapter v2.3.4-beta.1-r1 is not supported. Copilot requires Adapter v2.3.4 or newer.",
      });
    });
    it.each(["custom", "managed"] as const)(
      "accepts current and newer %s versions, and gives old versions upgrade guidance (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)",
      (source) => {
        for (const version of ["2.3.4", "2.3.5", "3.0.0", "2.3.4+build.1"]) {
          expect(versionInstallState("Adapter", version, "2.3.4", source)).toEqual({
            kind: "ready",
            source,
          });
        }
        expect(versionInstallState("Adapter", "2.3.3-r1", "2.3.4", source)).toEqual({
          kind: "incompatible",
          source,
          currentVersion: "2.3.3-r1",
          minVersion: "2.3.4",
          message: "Adapter v2.3.3-r1 is not supported. Copilot requires Adapter v2.3.4 or newer.",
        });
      }
    );
  });
});
