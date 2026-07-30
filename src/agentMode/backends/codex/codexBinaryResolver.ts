/** Locate a user-installed `codex-acp` adapter for the Codex Configure dialog. */
import * as path from "node:path";

import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type CodexAcpBinaryResolverFs = NodeToolFs;

export interface CodexAcpBinaryResolverInput {
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: CodexAcpBinaryResolverFs;
}

export interface CodexAcpInvocation {
  command: string;
  args: string[];
}

export function resolveCodexAcpBinary(input: CodexAcpBinaryResolverInput): string | null {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);

  for (const candidate of candidates) {
    if (candidate && input.fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function codexAcpSearchDirs(input: CodexAcpBinaryResolverInput): string[] {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  return Array.from(new Set(candidates.map((candidate) => pathImpl.dirname(candidate))));
}

/**
 * Converts npm's Windows command shim into a no-shell Node invocation.
 * @param binaryPath - The selected adapter path saved in settings.
 * @param platform - The device platform that determines whether command shims need translation.
 */
export function codexAcpInvocation(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform
): CodexAcpInvocation {
  if (platform !== "win32" || !binaryPath.toLowerCase().endsWith(".cmd")) {
    return { command: binaryPath, args: [] };
  }
  return {
    command: "node",
    args: [
      path.win32.join(
        path.win32.dirname(binaryPath),
        "node_modules",
        "@agentclientprotocol",
        "codex-acp",
        "dist",
        "index.js"
      ),
    ],
  };
}

const posix = path.posix;
const win = path.win32;

function unixCandidates(input: CodexAcpBinaryResolverInput): string[] {
  const { homeDir } = input;
  const dirs = [
    posix.join(homeDir, ".local", "bin"),
    posix.join(homeDir, ".codex-acp", "bin"),
    ...nodeToolBinDirCandidates(input),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  return dirs.map((dir) => posix.join(dir, "codex-acp"));
}

function windowsCandidates(input: CodexAcpBinaryResolverInput): string[] {
  const { homeDir, env } = input;
  const localAppData = env.LOCALAPPDATA ?? win.join(homeDir, "AppData", "Local");
  const appData = env.APPDATA ?? win.join(homeDir, "AppData", "Roaming");
  const npmGlobal = win.join(appData, "npm");
  const nodeToolDirs = Array.from(new Set([...nodeToolBinDirCandidates(input), npmGlobal]));
  const out: string[] = [
    // The maintained adapter is a JavaScript npm package. Its command shim is
    // translated to a direct Node invocation by `codexAcpInvocation`.
    ...nodeToolDirs.map((dir) => win.join(dir, "codex-acp.cmd")),
    // Copilot's docs helper installs the native release zip here.
    win.join(localAppData, "Programs", "codex-acp", "codex-acp.exe"),
    // Earlier direct-tarball docs extracted the npm platform package here.
    win.join(localAppData, "codex-acp", "package", "bin", "codex-acp.exe"),
    // Allow users who manually extracted the release zip to this simpler dir.
    win.join(localAppData, "codex-acp", "codex-acp.exe"),
    win.join(homeDir, ".local", "bin", "codex-acp.exe"),
  ];

  for (const dir of nodeToolDirs) {
    out.push(win.join(dir, "codex-acp.exe"));
    out.push(
      win.join(
        dir,
        "node_modules",
        "@zed-industries",
        "codex-acp-win32-x64",
        "bin",
        "codex-acp.exe"
      )
    );
    out.push(
      win.join(
        dir,
        "node_modules",
        "@zed-industries",
        "codex-acp-win32-arm64",
        "bin",
        "codex-acp.exe"
      )
    );
    out.push(
      win.join(
        dir,
        "node_modules",
        "@zed-industries",
        "codex-acp",
        "node_modules",
        "@zed-industries",
        "codex-acp-win32-x64",
        "bin",
        "codex-acp.exe"
      )
    );
    out.push(
      win.join(
        dir,
        "node_modules",
        "@zed-industries",
        "codex-acp",
        "node_modules",
        "@zed-industries",
        "codex-acp-win32-arm64",
        "bin",
        "codex-acp.exe"
      )
    );
  }

  return out;
}
