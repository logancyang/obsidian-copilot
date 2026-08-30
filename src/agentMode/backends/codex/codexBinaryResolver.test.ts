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
  it("finds the current adapter's Windows npm entry point", () => {
    const expected = path.win32.join(
      "C:\\Users\\me",
      "AppData",
      "Roaming",
      "npm",
      "node_modules",
      "@agentclientprotocol",
      "codex-acp",
      "dist",
      "index.js"
    );

    expect(
      resolveCodexAcpBinary({
        homeDir: "C:\\Users\\me",
        platform: "win32",
        env: { APPDATA: path.win32.join("C:\\Users\\me", "AppData", "Roaming") },
        fs: fsWith([expected]),
      })
    ).toBe(expected);
  });

  it("https://github.com/logancyang/obsidian-copilot/issues/2916 does not select the legacy Zed package", () => {
    const legacy = path.win32.join(
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
          legacy,
        ]),
      })
    ).toBeNull();
  });

  it("reports the current Windows package directory in searched dirs", () => {
    const dirs = codexAcpSearchDirs({
      homeDir: "C:\\Users\\me",
      platform: "win32",
      env: { APPDATA: path.win32.join("C:\\Users\\me", "AppData", "Roaming") },
      fs: fsWith([]),
    });

    expect(dirs).toContain(
      path.win32.join(
        "C:\\Users\\me",
        "AppData",
        "Roaming",
        "npm",
        "node_modules",
        "@agentclientprotocol",
        "codex-acp",
        "dist"
      )
    );
  });

  it("skips an existing candidate that fails the package support contract", () => {
    const legacy = "/Users/me/.local/bin/codex-acp";
    const current = "/usr/local/bin/codex-acp";

    expect(
      resolveCodexAcpBinary(
        {
          homeDir: "/Users/me",
          platform: "darwin",
          env: {},
          fs: fsWith([legacy, current]),
        },
        (candidate) => candidate !== legacy
      )
    ).toBe(current);
  });
});
