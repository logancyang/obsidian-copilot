import * as path from "node:path";

import {
  codexAcpInvocation,
  codexAcpSearchDirs,
  resolveCodexAcpBinary,
} from "./codexBinaryResolver";

function fsWith(paths: string[]) {
  const existing = new Set(paths);
  return {
    existsSync: (p: string): boolean => existing.has(p),
    readFileSync: (): string => "",
    readdirSync: (): string[] => [],
  };
}

describe("codexBinaryResolver", () => {
  describe("resolveCodexAcpBinary()", () => {
    it("prefers the maintained Windows npm shim over a superseded native adapter", () => {
      const maintained = path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Roaming",
        "npm",
        "codex-acp.cmd"
      );
      const superseded = path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Local",
        "Programs",
        "codex-acp",
        "codex-acp.exe"
      );

      expect(
        resolveCodexAcpBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: {
            APPDATA: path.win32.join("C:\\Users\\me", "AppData", "Roaming"),
            LOCALAPPDATA: path.win32.join("C:\\Users\\me", "AppData", "Local"),
          },
          fs: fsWith([superseded, maintained]),
        })
      ).toBe(maintained);
    });

    it("finds a maintained shim under a custom npm prefix on PATH", () => {
      const expected = "D:\\portable-node\\bin\\codex-acp.cmd";

      expect(
        resolveCodexAcpBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: {
            Path: "D:\\portable-node\\bin;C:\\Windows\\System32",
          },
          fs: fsWith([expected]),
        })
      ).toBe(expected);
    });

    it("finds the Windows helper-script install path", () => {
      const expected = path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Local",
        "Programs",
        "codex-acp",
        "codex-acp.exe"
      );

      expect(
        resolveCodexAcpBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: { LOCALAPPDATA: path.win32.join("C:\\Users\\me", "AppData", "Local") },
          fs: fsWith([expected]),
        })
      ).toBe(expected);
    });

    it("finds the direct npm platform tarball extraction path", () => {
      const expected = path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Local",
        "codex-acp",
        "package",
        "bin",
        "codex-acp.exe"
      );

      expect(
        resolveCodexAcpBinary({
          homeDir: "C:\\Users\\me",
          platform: "win32",
          env: { LOCALAPPDATA: path.win32.join("C:\\Users\\me", "AppData", "Local") },
          fs: fsWith([expected]),
        })
      ).toBe(expected);
    });
  });

  describe("codexAcpSearchDirs()", () => {
    it("reports the Windows helper install directory in searched dirs", () => {
      const dirs = codexAcpSearchDirs({
        homeDir: "C:\\Users\\me",
        platform: "win32",
        env: { LOCALAPPDATA: path.win32.join("C:\\Users\\me", "AppData", "Local") },
        fs: fsWith([]),
      });

      expect(dirs).toContain(
        path.win32.join("C:\\Users\\me", "AppData", "Local", "Programs", "codex-acp")
      );
    });
  });

  describe("codexAcpInvocation()", () => {
    it("runs a global Windows npm shim through the target encoded by the shim", () => {
      expect(
        codexAcpInvocation(
          "C:\\Users\\me\\AppData\\Roaming\\npm\\codex-acp.cmd",
          "win32",
          () =>
            '"%_prog%" "%dp0%\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js" %*'
        )
      ).toEqual({
        command: "node",
        args: [
          "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js",
        ],
      });
    });

    it("resolves a project-local Windows shim target outside node_modules/.bin", () => {
      expect(
        codexAcpInvocation(
          "C:\\project\\node_modules\\.bin\\codex-acp.cmd",
          "win32",
          () => '"%~dp0\\..\\@agentclientprotocol\\codex-acp\\dist\\index.js" %*'
        )
      ).toEqual({
        command: "node",
        args: ["C:\\project\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js"],
      });
    });

    it("rejects a Windows shim that does not encode the maintained adapter target", () => {
      expect(() =>
        codexAcpInvocation("C:\\legacy\\codex-acp.cmd", "win32", () => '"legacy.exe" %*')
      ).toThrow("Could not resolve the maintained Codex ACP target");
    });

    it("executes non-Windows adapter paths directly", () => {
      expect(codexAcpInvocation("/usr/local/bin/codex-acp", "darwin")).toEqual({
        command: "/usr/local/bin/codex-acp",
        args: [],
      });
    });
  });
});
