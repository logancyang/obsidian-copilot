import { augmentPathForDetection, mergePath, WELL_KNOWN_BIN_DIRS } from "./binaryPath";

describe("mergePath", () => {
  test("prepends candidates and dedupes against inherited PATH", () => {
    const result = mergePath(["/opt/homebrew/bin", "/usr/local/bin"], "/usr/bin:/bin");
    expect(result).toBe("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
  });

  test("drops duplicates while preserving first-seen order", () => {
    const result = mergePath(["/opt/homebrew/bin", "/usr/bin"], "/usr/bin:/bin:/opt/homebrew/bin");
    expect(result).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });

  test("handles undefined / empty inherited PATH", () => {
    expect(mergePath(["/opt/homebrew/bin"], undefined)).toBe("/opt/homebrew/bin");
    expect(mergePath(["/opt/homebrew/bin"], "")).toBe("/opt/homebrew/bin");
  });
});

describe("augmentPathForDetection", () => {
  test("prepends all well-known dirs ahead of the inherited PATH", () => {
    const result = augmentPathForDetection("/usr/bin:/bin");
    const parts = result.split(":");
    for (const dir of WELL_KNOWN_BIN_DIRS) {
      expect(parts).toContain(dir);
    }
    // Homebrew must come before whatever launchd already had.
    expect(parts.indexOf("/opt/homebrew/bin")).toBeLessThan(parts.indexOf("/usr/bin"));
  });

  test("covers the sparse launchd PATH that triggers the bug", () => {
    // This is the exact PATH Obsidian sees when launched from Finder/Dock.
    const result = augmentPathForDetection("/usr/bin:/bin:/usr/sbin:/sbin");
    expect(result.split(":")).toContain("/opt/homebrew/bin");
  });
});
