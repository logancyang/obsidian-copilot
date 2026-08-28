/**
 * Locate the official Antigravity `agy` CLI without depending on Obsidian's
 * inherited PATH. Antigravity's installer uses a per-user bin directory on
 * Windows; the remaining candidates cover the usual Unix and Node-tool
 * layouts used when the CLI is installed manually.
 *
 * This is deliberately a pure leaf: callers inject the home directory,
 * platform, environment, and filesystem so tests never touch the real disk.
 */
import { WELL_KNOWN_BIN_DIRS } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type AntigravityBinaryResolverFs = NodeToolFs;

export interface AntigravityBinaryResolverInput {
  /** User-configured override path. It is used only when it exists. */
  override?: string;
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: AntigravityBinaryResolverFs;
}

export function resolveAntigravityBinary(input: AntigravityBinaryResolverInput): string | null {
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

export function antigravityBinarySearchDirs(input: AntigravityBinaryResolverInput): string[] {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);
  return Array.from(
    new Set(
      candidates
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => pathImpl.dirname(candidate))
    )
  );
}

function unixCandidates(input: AntigravityBinaryResolverInput): Array<string | null> {
  const posix = requireNodeModule<typeof import("node:path")>("path").posix;
  const { homeDir, env } = input;
  const dirs = [...nodeToolBinDirCandidates(input), ...WELL_KNOWN_BIN_DIRS];
  return [
    posix.join(homeDir, ".local", "bin", "agy"),
    posix.join(homeDir, ".agy", "bin", "agy"),
    ...dirs.map((dir) => posix.join(dir, "agy")),
    env.npm_config_prefix ? posix.join(env.npm_config_prefix, "bin", "agy") : null,
  ];
}

function windowsCandidates(input: AntigravityBinaryResolverInput): Array<string | null> {
  const win = requireNodeModule<typeof import("node:path")>("path").win32;
  const { homeDir, env } = input;
  const localAppData = env.LOCALAPPDATA ?? win.join(homeDir, "AppData", "Local");
  const appData = env.APPDATA ?? win.join(homeDir, "AppData", "Roaming");
  const dirs = nodeToolBinDirCandidates(input);
  const candidates: Array<string | null> = [
    // Official Antigravity CLI installer location on Windows.
    win.join(localAppData, "agy", "bin", "agy.exe"),
    win.join(localAppData, "Antigravity", "bin", "agy.exe"),
    win.join(homeDir, ".local", "bin", "agy.exe"),
    win.join(homeDir, ".agy", "bin", "agy.exe"),
    win.join(appData, "npm", "agy.exe"),
  ];

  for (const dir of dirs) {
    candidates.push(win.join(dir, "agy.exe"));
    candidates.push(win.join(dir, "agy"));
  }

  return candidates;
}
