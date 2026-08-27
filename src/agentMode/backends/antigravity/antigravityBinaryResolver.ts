/**
 * Locate a user-installed native `agy-acp` adapter binary and `agy` CLI binary.
 */
import { requireNodeModule } from "@/utils/desktopRuntime";
import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type AntigravityBinaryResolverFs = NodeToolFs;

export interface AntigravityBinaryResolverInput {
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: AntigravityBinaryResolverFs;
}

export function resolveAntigravityAcpBinary(input: AntigravityBinaryResolverInput): string | null {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);

  for (const candidate of candidates) {
    if (candidate && input.fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function antigravityAcpSearchDirs(input: AntigravityBinaryResolverInput): string[] {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);
  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  return Array.from(new Set(candidates.map((candidate) => pathImpl.dirname(candidate))));
}

export function resolveDefaultAgyCliBinary(input: AntigravityBinaryResolverInput): string | null {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const { homeDir, env, platform } = input;
  if (platform === "win32") {
    const win = path.win32;
    const localAppData = env.LOCALAPPDATA ?? win.join(homeDir, "AppData", "Local");
    const p = win.join(localAppData, "agy", "bin", "agy.exe");
    if (input.fs.existsSync(p)) return p;
    const userLocal = win.join(homeDir, ".local", "bin", "agy.exe");
    if (input.fs.existsSync(userLocal)) return userLocal;
  } else {
    const posix = path.posix;
    const candidates = [
      posix.join(homeDir, ".local", "bin", "agy"),
      "/usr/local/bin/agy",
      "/opt/homebrew/bin/agy",
    ];
    for (const c of candidates) {
      if (input.fs.existsSync(c)) return c;
    }
  }
  return null;
}

function unixCandidates(input: AntigravityBinaryResolverInput): string[] {
  const posix = requireNodeModule<typeof import("node:path")>("path").posix;
  const { homeDir } = input;
  const dirs = [
    posix.join(homeDir, ".local", "bin"),
    posix.join(homeDir, ".agy-acp", "bin"),
    ...nodeToolBinDirCandidates(input),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  return dirs.map((dir) => posix.join(dir, "agy-acp"));
}

function windowsCandidates(input: AntigravityBinaryResolverInput): string[] {
  const win = requireNodeModule<typeof import("node:path")>("path").win32;
  const { homeDir, env } = input;
  const localAppData = env.LOCALAPPDATA ?? win.join(homeDir, "AppData", "Local");
  const appData = env.APPDATA ?? win.join(homeDir, "AppData", "Roaming");
  const npmGlobal = win.join(appData, "npm");
  const out: string[] = [
    win.join(localAppData, "Programs", "agy-acp", "agy-acp.exe"),
    win.join(localAppData, "agy-acp", "agy-acp.exe"),
    win.join(homeDir, ".local", "bin", "agy-acp.exe"),
  ];

  for (const dir of [...nodeToolBinDirCandidates(input), npmGlobal]) {
    out.push(win.join(dir, "agy-acp.exe"));
  }

  return out;
}
