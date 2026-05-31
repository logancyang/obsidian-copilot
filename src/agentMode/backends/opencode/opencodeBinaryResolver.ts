/**
 * Locate a user-installed `opencode` binary for the "Use your own binary"
 * Auto-detect button. Independent of the managed-binary path (which
 * `OpencodeBinaryManager` owns) — this resolver only walks well-known
 * native-install and node-tool layouts to find an externally installed CLI.
 *
 * Mirrors {@link ./claudeBinaryResolver.ts}: pure leaf with injected `homeDir`,
 * `platform`, `env`, and `fs` so tests don't touch real disk. On Windows we
 * never emit `.cmd` / `.bat` / `.ps1` shims — ACP spawns over stdio without
 * `shell: true`, so those break stream-json.
 */
import * as path from "node:path";

import { WELL_KNOWN_BIN_DIRS } from "@/utils/binaryPath";
import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type OpencodeBinaryResolverFs = NodeToolFs;

export interface OpencodeBinaryResolverInput {
  /** User-configured override path. If set and exists, returned as-is. */
  override?: string;
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: OpencodeBinaryResolverFs;
}

export function resolveOpencodeBinary(input: OpencodeBinaryResolverInput): string | null {
  const { override, fs } = input;

  if (override && fs.existsSync(override)) {
    return override;
  }

  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const posix = path.posix;
const win = path.win32;

function unixCandidates(input: OpencodeBinaryResolverInput): Array<string | null> {
  const { homeDir } = input;
  // Native installer (`curl -fsSL https://opencode.ai/install | bash`) lands at
  // ~/.opencode/bin/opencode; `bun install -g` lands at ~/.bun/bin. Probe these
  // first, then every node-tool bin dir, then well-known system prefixes.
  const dirs = [...nodeToolBinDirCandidates(input), ...WELL_KNOWN_BIN_DIRS];
  return [
    posix.join(homeDir, ".opencode", "bin", "opencode"),
    posix.join(homeDir, ".bun", "bin", "opencode"),
    posix.join(homeDir, ".local", "bin", "opencode"),
    ...dirs.map((dir) => posix.join(dir, "opencode")),
  ];
}

function windowsCandidates(input: OpencodeBinaryResolverInput): Array<string | null> {
  const { homeDir, env } = input;
  const localAppData = env.LOCALAPPDATA ?? win.join(homeDir, "AppData", "Local");
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  // Native-installer / package-manager destinations probed before the node-tool
  // layout. Fixed list — no PATH walk.
  const out: Array<string | null> = [
    win.join(homeDir, ".opencode", "bin", "opencode.exe"),
    win.join(homeDir, ".bun", "bin", "opencode.exe"),
    win.join(homeDir, ".local", "bin", "opencode.exe"),
    win.join(localAppData, "opencode", "bin", "opencode.exe"),
    win.join(programFiles, "opencode", "bin", "opencode.exe"),
    win.join(programFilesX86, "opencode", "bin", "opencode.exe"),
  ];
  // Per-dir, probe `opencode.exe` only. Never pick `.cmd` / `.bat` / `.ps1` —
  // ACP spawns over stdio without `shell: true`, which breaks them.
  for (const dir of nodeToolBinDirCandidates(input)) {
    out.push(win.join(dir, "opencode.exe"));
  }
  return out;
}
