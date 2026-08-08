import * as path from "node:path";

import { codexAcpSearchDirs, resolveCodexAcpBinary } from "./codexBinaryResolver";

function fsWith(paths: string[]) {
  const existing = new Set(paths);
  return {
    existsSync: (p: string): boolean => existing.has(p),
    readFileSync: (): string => "",
    readdirSync: (): string[] => [],
  };
}

describe("resolveCodexAcpBinary", () => {
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

  it("finds native npm optional-dependency binaries without selecting cmd shims", () => {
    const expected = path.win32.join(
      "C:\\Users\\me",
      "AppData",
      "Roaming",
      "npm",
      "node_modules",
      "@zed-industries",
      "codex-acp",
      "node_modules",
      "@zed-industries",
      "codex-acp-win32-x64",
      "bin",
      "codex-acp.exe"
    );

    expect(
      resolveCodexAcpBinary({
        homeDir: "C:\\Users\\me",
        platform: "win32",
        env: { APPDATA: path.win32.join("C:\\Users\\me", "AppData", "Roaming") },
        fs: fsWith([
          path.win32.join("C:\\Users\\me", "AppData", "Roaming", "npm", "codex-acp.cmd"),
          expected,
        ]),
      })
    ).toBe(expected);
  });

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
