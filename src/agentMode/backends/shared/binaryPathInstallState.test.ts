import { binaryPathInstallState } from "./simpleBinaryBackend";

describe("binaryPathInstallState", () => {
  it("absent when no path is configured", () => {
    expect(binaryPathInstallState(undefined)).toEqual({ kind: "absent" });
    expect(binaryPathInstallState("")).toEqual({ kind: "absent" });
  });

  it("ready/custom when the configured path exists on disk", () => {
    expect(binaryPathInstallState("/bin/codex-acp", () => true)).toEqual({
      kind: "ready",
      source: "custom",
    });
  });

  it("absent when the configured path is missing on this device (synced vault, #123)", () => {
    expect(binaryPathInstallState("/bin/codex-acp", () => false)).toEqual({ kind: "absent" });
  });
});
