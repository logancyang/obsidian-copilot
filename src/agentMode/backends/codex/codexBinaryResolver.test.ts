import * as path from "node:path";

import {
  codexAcpSearchDirs,
  legacyCodexAcpCandidates,
  resolveCodexAcpBinary,
  resolveCodexAcpLauncher,
} from "./codexBinaryResolver";

function fsWith(paths: string[]) {
  const existing = new Set(paths);
  return {
    existsSync: (p: string): boolean => existing.has(p),
    readFileSync: (): string => "",
    readdirSync: (): string[] => [],
  };
}

describe("resolveCodexAcpLauncher", () => {
  it("selects a supported POSIX executable entry directly", () => {
    const expected = "/Users/me/.npm-global/bin/codex-acp";
    const launcher = resolveCodexAcpLauncher({
      homeDir: "/Users/me",
      platform: "darwin",
      env: { npm_config_prefix: "/Users/me/.npm-global" },
      fs: fsWith([expected]),
    });

    expect(launcher).toEqual({
      command: expected,
      args: [],
      adapterPath: expected,
      kind: "executable",
    });
    expect(
      resolveCodexAcpBinary({
        homeDir: "/Users/me",
        platform: "darwin",
        env: { npm_config_prefix: "/Users/me/.npm-global" },
        fs: fsWith([expected]),
      })
    ).toBe(expected);
  });

  it("launches the supported Windows npm entry through Node without a cmd shim", () => {
    const npmDir = "C:\\Users\\me\\AppData\\Roaming\\npm";
    const node = "C:\\Program Files\\nodejs\\node.exe";
    const entry = path.win32.join(
      npmDir,
      "node_modules",
      "@agentclientprotocol",
      "codex-acp",
      "dist",
      "index.js"
    );
    const launcher = resolveCodexAcpLauncher({
      homeDir: "C:\\Users\\me",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
      nodePath: node,
      fs: fsWith([entry, node, path.win32.join(npmDir, "codex-acp.cmd")]),
    });

    expect(launcher).toEqual({ command: node, args: [entry], adapterPath: entry, kind: "node" });
  });

  it("does not resolve a legacy package binary, but retains it for diagnostics", () => {
    const input = {
      homeDir: "C:\\Users\\me",
      platform: "win32" as const,
      env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
      fs: fsWith([]),
    };
    const legacy = legacyCodexAcpCandidates(input)[0];
    input.fs = fsWith([legacy]);

    expect(resolveCodexAcpLauncher(input)).toBeNull();
    expect(legacyCodexAcpCandidates(input)).toContain(legacy);
  });

  it("reports the supported npm package directory in searched dirs", () => {
    const dirs = codexAcpSearchDirs({
      homeDir: "C:\\Users\\me",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
      fs: fsWith([]),
    });

    expect(dirs).toContain(
      path.win32.join(
        "C:\\Users\\me\\AppData\\Roaming\\npm",
        "node_modules",
        "@agentclientprotocol",
        "codex-acp",
        "dist"
      )
    );
  });
});
