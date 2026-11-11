import * as path from "node:path";
import { antigravitySearchDirs, resolveAntigravityBinary } from "./antigravityBinaryResolver";

function fsWith(paths: string[]) {
  const existing = new Set(paths);
  return { existsSync: (p: string): boolean => existing.has(p) };
}

describe("antigravityBinaryResolver", () => {
  describe("resolveAntigravityBinary()", () => {
    it("finds agy in ~/.local/bin, where its installer puts it", () => {
      const agy = path.posix.join("/home/me", ".local", "bin", "agy");

      expect(
        resolveAntigravityBinary({ homeDir: "/home/me", platform: "darwin", fs: fsWith([agy]) })
      ).toBe(agy);
    });

    it("finds agy in a well-known system bin directory", () => {
      expect(
        resolveAntigravityBinary({
          homeDir: "/home/me",
          platform: "darwin",
          fs: fsWith(["/opt/homebrew/bin/agy"]),
        })
      ).toBe("/opt/homebrew/bin/agy");
    });

    it("prefers the user's saved path over the usual install locations", () => {
      const agy = path.posix.join("/home/me", ".local", "bin", "agy");

      expect(
        resolveAntigravityBinary({
          override: "/custom/agy",
          homeDir: "/home/me",
          platform: "darwin",
          fs: fsWith([agy, "/custom/agy"]),
        })
      ).toBe("/custom/agy");
    });

    it("falls back to the usual install locations when the saved path no longer exists", () => {
      const agy = path.posix.join("/home/me", ".local", "bin", "agy");

      expect(
        resolveAntigravityBinary({
          override: "/removed/agy",
          homeDir: "/home/me",
          platform: "darwin",
          fs: fsWith([agy]),
        })
      ).toBe(agy);
    });

    it("finds agy.exe in the user's .local\\bin on Windows", () => {
      const agy = path.win32.join("C:\\Users\\me", ".local", "bin", "agy.exe");

      expect(
        resolveAntigravityBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          fs: fsWith([agy]),
        })
      ).toBe(agy);
    });

    it("returns null when agy is in none of the searched locations", () => {
      expect(
        resolveAntigravityBinary({ homeDir: "/home/me", platform: "linux", fs: fsWith([]) })
      ).toBeNull();
    });
  });

  describe("antigravitySearchDirs()", () => {
    it("lists ~/.local/bin first, then the well-known system bin directories", () => {
      const dirs = antigravitySearchDirs({
        homeDir: "/home/me",
        platform: "darwin",
        fs: fsWith([]),
      });

      expect(dirs[0]).toBe("/home/me/.local/bin");
      expect(dirs).toEqual(expect.arrayContaining(["/opt/homebrew/bin", "/usr/local/bin"]));
    });
  });
});
