import * as path from "node:path";
import { antigravitySearchDirs, resolveAntigravityBinary } from "./antigravityBinaryResolver";

function fsWith(paths: string[]) {
  const existing = new Set(paths);
  return {
    existsSync: (p: string): boolean => existing.has(p),
    readFileSync: (): string => "",
    readdirSync: (): string[] => [],
  };
}

describe("antigravityBinaryResolver", () => {
  describe("resolveAntigravityBinary()", () => {
    it("finds the Windows install path under LocalAppData", () => {
      const expected = path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Local",
        "Programs",
        "antigravity-acp",
        "antigravity-acp.exe"
      );

      expect(
        resolveAntigravityBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: { LOCALAPPDATA: path.win32.join("C:\\Users\\me", "AppData", "Local") },
          fs: fsWith([expected]),
        })
      ).toBe(expected);
    });

    it("finds the Antigravity CLI bin path under ~/.gemini/antigravity/bin", () => {
      const expected = path.posix.join(
        "/home/me",
        ".gemini",
        "antigravity",
        "bin",
        "antigravity-acp"
      );

      expect(
        resolveAntigravityBinary({
          homeDir: "/home/me",
          platform: "linux",
          env: {},
          fs: fsWith([expected]),
        })
      ).toBe(expected);
    });

    it("finds the npm global antigravity-acp.exe on Windows", () => {
      const expected = path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Roaming",
        "npm",
        "antigravity-acp.exe"
      );
      expect(
        resolveAntigravityBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: { APPDATA: path.win32.join("C:\\Users\\me", "AppData", "Roaming") },
          fs: fsWith([expected]),
        })
      ).toBe(expected);
    });

    it("rejects non-spawnable .cmd shims on Windows", () => {
      const cmdShim = path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Roaming",
        "npm",
        "antigravity-acp.cmd"
      );
      expect(
        resolveAntigravityBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: { APPDATA: path.win32.join("C:\\Users\\me", "AppData", "Roaming") },
          fs: fsWith([cmdShim]),
        })
      ).toBeNull();
    });

    it("finds the agy CLI binary under ~/.local/bin", () => {
      const expected = path.posix.join("/home/me", ".local", "bin", "agy");
      expect(
        resolveAntigravityBinary({
          homeDir: "/home/me",
          platform: "linux",
          env: {},
          fs: fsWith([expected]),
        })
      ).toBe(expected);
    });

    it("returns null when no candidate exists", () => {
      expect(
        resolveAntigravityBinary({
          homeDir: "/home/me",
          platform: "linux",
          env: {},
          fs: fsWith([]),
        })
      ).toBeNull();
    });
  });

  describe("antigravitySearchDirs()", () => {
    it("reports the Windows install directory in searched dirs", () => {
      const dirs = antigravitySearchDirs({
        homeDir: "C:\\Users\\me",
        platform: "win32",
        env: { LOCALAPPDATA: path.win32.join("C:\\Users\\me", "AppData", "Local") },
        fs: fsWith([]),
      });

      expect(dirs).toContain(
        path.win32.join("C:\\Users\\me", "AppData", "Local", "Programs", "antigravity-acp")
      );
    });
  });
});
