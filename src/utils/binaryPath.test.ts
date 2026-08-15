import { Platform } from "obsidian";
import * as os from "node:os";
import * as path from "node:path";

import { resolveNodeToolBinDirs } from "@/utils/nodeToolBinDirs";

import {
  augmentPathForDetection,
  detectionSearchDirs,
  formatBinaryPathForDisplay,
  mergePath,
  WELL_KNOWN_BIN_DIRS,
} from "./binaryPath";

// Isolate binaryPath's merging/ordering from the live version-manager probe;
// the resolver's own behavior is covered in nodeToolBinDirs.test.ts.
jest.mock("@/utils/nodeToolBinDirs", () => ({ resolveNodeToolBinDirs: jest.fn(() => []) }));

const resolveMock = resolveNodeToolBinDirs as jest.MockedFunction<typeof resolveNodeToolBinDirs>;

describe("binaryPath", () => {
  afterEach(() => resolveMock.mockReturnValue([]));

  describe("mergePath()", () => {
    test("prepends candidates and dedupes against inherited PATH", () => {
      const result = mergePath(["/opt/homebrew/bin", "/usr/local/bin"], "/usr/bin:/bin");
      expect(result).toBe("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    });

    test("drops duplicates while preserving first-seen order", () => {
      const result = mergePath(
        ["/opt/homebrew/bin", "/usr/bin"],
        "/usr/bin:/bin:/opt/homebrew/bin"
      );
      expect(result).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    });

    test("handles undefined / empty inherited PATH", () => {
      expect(mergePath(["/opt/homebrew/bin"], undefined)).toBe("/opt/homebrew/bin");
      expect(mergePath(["/opt/homebrew/bin"], "")).toBe("/opt/homebrew/bin");
    });
  });

  describe("detectionSearchDirs()", () => {
    test("lists version-manager bins ahead of the well-known dirs", () => {
      const nvmBin = "/home/me/.nvm/versions/node/v20.18.0/bin";
      resolveMock.mockReturnValue([nvmBin]);
      const dirs = detectionSearchDirs();
      expect(dirs[0]).toBe(nvmBin);
      expect(dirs.indexOf(nvmBin)).toBeLessThan(dirs.indexOf("/opt/homebrew/bin"));
      expect(dirs).toEqual([nvmBin, ...WELL_KNOWN_BIN_DIRS]);
    });
  });

  describe("augmentPathForDetection()", () => {
    test("prepends all well-known dirs ahead of the inherited PATH", () => {
      const result = augmentPathForDetection("/usr/bin:/bin");
      const parts = result.split(":");
      for (const dir of WELL_KNOWN_BIN_DIRS) {
        expect(parts).toContain(dir);
      }
      // Homebrew must come before whatever launchd already had.
      expect(parts.indexOf("/opt/homebrew/bin")).toBeLessThan(parts.indexOf("/usr/bin"));
    });

    test("prepends a discovered version-manager dir ahead of the inherited PATH", () => {
      const nvmBin = "/home/me/.nvm/versions/node/v20.18.0/bin";
      resolveMock.mockReturnValue([nvmBin]);
      const parts = augmentPathForDetection("/usr/bin:/bin:/usr/sbin:/sbin").split(":");
      expect(parts[0]).toBe(nvmBin);
      expect(parts.indexOf(nvmBin)).toBeLessThan(parts.indexOf("/usr/bin"));
    });

    test("covers the sparse launchd PATH that triggers the bug", () => {
      // This is the exact PATH Obsidian sees when launched from Finder/Dock.
      const result = augmentPathForDetection("/usr/bin:/bin:/usr/sbin:/sbin");
      expect(result.split(":")).toContain("/opt/homebrew/bin");
    });

    test("throws the desktop-only error on non-desktop runtimes instead of a TypeError", () => {
      const platform = Platform as { isMobile: boolean };
      platform.isMobile = true;
      try {
        expect(() => augmentPathForDetection("/usr/bin")).toThrow(
          /unavailable outside the desktop/
        );
      } finally {
        platform.isMobile = false;
      }
    });
  });

  describe("formatBinaryPathForDisplay()", () => {
    test("collapses the home directory to ~ on desktop", () => {
      const abs = path.join(os.homedir(), ".local", "bin", "claude");
      expect(formatBinaryPathForDisplay(abs)).toMatch(/^~[/\\]/);
    });

    test("throws the desktop-only error on non-desktop runtimes instead of a TypeError", () => {
      const platform = Platform as { isMobile: boolean };
      platform.isMobile = true;
      try {
        expect(() => formatBinaryPathForDisplay("/x/y")).toThrow(/unavailable outside the desktop/);
      } finally {
        platform.isMobile = false;
      }
    });
  });

  describe("module evaluation", () => {
    test("does not require Node built-ins at module evaluation time", () => {
      // The module is on the eager settings-UI import graph, which mobile also
      // evaluates; an eval-time require of a Node built-in would crash the
      // plugin at load there.
      const throwingIds = ["os", "fs", "path", "node:os", "node:fs", "node:path"];
      try {
        jest.isolateModules(() => {
          for (const id of throwingIds) {
            jest.doMock(id, () => {
              throw new Error(`eager require of ${id}`);
            });
          }
          expect(() => void jest.requireActual("./binaryPath")).not.toThrow();
        });
      } finally {
        for (const id of throwingIds) jest.dontMock(id);
      }
    });
  });
});
