import * as path from "node:path";

import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type CodexAcpBinaryResolverFs = NodeToolFs;

export interface CodexAcpBinaryResolverInput {
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: CodexAcpBinaryResolverFs;
  /** Desktop runtime's Node executable. Injected so Windows resolution is testable. */
  nodePath?: string;
}

export interface CodexLauncherDescriptor {
  command: string;
  args: string[];
  adapterPath: string;
  kind: "executable" | "node";
}

export function resolveCodexAcpLauncher(
  input: CodexAcpBinaryResolverInput
): CodexLauncherDescriptor | null {
  if (input.platform === "win32") return resolveWindowsLauncher(input);
  for (const candidate of supportedPosixCandidates(input)) {
    if (safeExists(input.fs, candidate)) {
      return { command: candidate, args: [], adapterPath: candidate, kind: "executable" };
    }
  }
  return null;
}

/** Compatibility helper for existing path-only configuration surfaces. */
export function resolveCodexAcpBinary(input: CodexAcpBinaryResolverInput): string | null {
  return resolveCodexAcpLauncher(input)?.adapterPath ?? null;
}

export function codexAcpSearchDirs(input: CodexAcpBinaryResolverInput): string[] {
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  const candidates =
    input.platform === "win32" ? supportedWindowsEntries(input) : supportedPosixCandidates(input);
  return Array.from(new Set(candidates.map((candidate) => pathImpl.dirname(candidate))));
}

/** Old package internals are surfaced for diagnostics but are never selected for launch. */
export function legacyCodexAcpCandidates(input: CodexAcpBinaryResolverInput): string[] {
  const dirs = nodeToolBinDirCandidates(input);
  if (input.platform !== "win32") {
    return dirs.map((dir) =>
      path.posix.join(dir, "node_modules", "@zed-industries", "codex-acp", "bin", "codex-acp")
    );
  }
  const win = path.win32;
  return dirs.flatMap((dir) => [
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
    ),
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
    ),
  ]);
}

function supportedPosixCandidates(input: CodexAcpBinaryResolverInput): string[] {
  const posix = path.posix;
  const dirs = [
    ...nodeToolBinDirCandidates(input),
    posix.join(input.homeDir, ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  return Array.from(new Set(dirs.map((dir) => posix.join(dir, "codex-acp"))));
}

function supportedWindowsEntries(input: CodexAcpBinaryResolverInput): string[] {
  const win = path.win32;
  return nodeToolBinDirCandidates(input).map((dir) =>
    win.join(dir, "node_modules", "@agentclientprotocol", "codex-acp", "dist", "index.js")
  );
}

function resolveWindowsLauncher(
  input: CodexAcpBinaryResolverInput
): CodexLauncherDescriptor | null {
  const entry = supportedWindowsEntries(input).find((candidate) => safeExists(input.fs, candidate));
  if (!entry) return null;
  const nodePath = resolveWindowsNode(input);
  if (!nodePath) return null;
  return { command: nodePath, args: [entry], adapterPath: entry, kind: "node" };
}

function resolveWindowsNode(input: CodexAcpBinaryResolverInput): string | null {
  const win = path.win32;
  const pathDirs = (input.env.Path ?? input.env.PATH ?? "").split(";").filter(Boolean);
  const candidates = [
    input.nodePath,
    ...pathDirs.map((dir) => win.join(dir, "node.exe")),
    ...nodeToolBinDirCandidates(input).map((dir) => win.join(dir, "node.exe")),
  ];
  return (
    candidates.find((candidate): candidate is string =>
      Boolean(candidate && safeExists(input.fs, candidate))
    ) ?? null
  );
}

function safeExists(fs: CodexAcpBinaryResolverFs, candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}
