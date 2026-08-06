/** Locate a user-installed `codex-acp` adapter for the Codex Configure dialog. */
import * as fs from "node:fs";
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

export type CodexAcpShimReader = (path: string, encoding: "utf8") => string;

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
 * @param readFile - Reads a Windows shim so its encoded package target can be resolved.
 */
export function codexAcpInvocation(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform,
  readFile: CodexAcpShimReader = fs.readFileSync
): CodexAcpInvocation {
  if (platform !== "win32" || !binaryPath.toLowerCase().endsWith(".cmd")) {
    return { command: binaryPath, args: [] };
  }
  const shimTarget = resolveWindowsShimTarget(binaryPath, readFile(binaryPath, "utf8"));
  return {
    command: "node",
    args: [shimTarget],
  };
}

const posix = path.posix;
const win = path.win32;
const MAINTAINED_WINDOWS_ENTRY =
  /"([^"\r\n]*@agentclientprotocol[\\/]+codex-acp[\\/]+dist[\\/]+index\.js)"/i;

function resolveWindowsShimTarget(binaryPath: string, contents: string): string {
  const encodedTarget = MAINTAINED_WINDOWS_ENTRY.exec(contents)?.[1];
  if (!encodedTarget) {
    throw new Error(`Could not resolve the maintained Codex ACP target from ${binaryPath}`);
  }

  const shimDir = win.dirname(binaryPath);
  const dp0Relative = encodedTarget.match(/^%~?dp0%?(.*)$/i);
  if (dp0Relative) {
    return win.normalize(`${shimDir}${dp0Relative[1]}`);
  }
  return win.isAbsolute(encodedTarget)
    ? win.normalize(encodedTarget)
    : win.resolve(shimDir, encodedTarget);
}

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
  const effectivePath = env.PATH ?? env.Path ?? env.path ?? "";
  const pathDirs = effectivePath
    .split(win.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);
  const nodeToolDirs = Array.from(
    new Set([...pathDirs, ...nodeToolBinDirCandidates(input), npmGlobal])
  );
  const out: string[] = [
    // The maintained adapter is a JavaScript npm package. Its command shim is
    // translated to a direct Node invocation by `codexAcpInvocation`.
    ...nodeToolDirs.map((dir) => win.join(dir, "codex-acp.cmd")),
    // Copilot's former Windows helper installed the superseded native release here.
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
