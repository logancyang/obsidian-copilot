/**
 * Locate a user-installed native `antigravity-acp` or `agy` binary for the Antigravity Configure
 * dialog. On Windows, npm shims (`.cmd`, `.js`) are not spawnable through
 * Agent Mode's no-shell ACP process path, so this resolver restricts detection
 * to native `.exe` executables.
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

export function resolveAntigravityBinary(input: AntigravityBinaryResolverInput): string | null {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);
  for (const candidate of candidates) {
    if (candidate && input.fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function antigravitySearchDirs(input: AntigravityBinaryResolverInput): string[] {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);
  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  return Array.from(new Set(candidates.map((candidate) => pathImpl.dirname(candidate))));
}

function unixCandidates(input: AntigravityBinaryResolverInput): string[] {
  const posix = requireNodeModule<typeof import("node:path")>("path").posix;
  const { homeDir } = input;
  return [
    posix.join(homeDir, ".local", "bin", "antigravity-acp"),
    posix.join(homeDir, ".local", "bin", "agy"),
    posix.join(homeDir, ".gemini", "antigravity", "bin", "antigravity-acp"),
    posix.join(homeDir, ".gemini", "antigravity", "bin", "agy"),
    posix.join(homeDir, ".antigravity-acp", "bin", "antigravity-acp"),
    ...nodeToolBinDirCandidates(input).map((dir) => posix.join(dir, "antigravity-acp")),
    ...nodeToolBinDirCandidates(input).map((dir) => posix.join(dir, "agy")),
    "/usr/local/bin/antigravity-acp",
    "/usr/local/bin/agy",
    "/opt/homebrew/bin/antigravity-acp",
    "/opt/homebrew/bin/agy",
  ];
}

function windowsCandidates(input: AntigravityBinaryResolverInput): string[] {
  const win = requireNodeModule<typeof import("node:path")>("path").win32;
  const { homeDir, env } = input;
  const localAppData = env.LOCALAPPDATA ?? win.join(homeDir, "AppData", "Local");
  const appData = env.APPDATA ?? win.join(homeDir, "AppData", "Roaming");
  const npmGlobal = win.join(appData, "npm");
  const out: string[] = [
    win.join(localAppData, "Programs", "antigravity-acp", "antigravity-acp.exe"),
    win.join(localAppData, "antigravity-acp", "package", "bin", "antigravity-acp.exe"),
    win.join(localAppData, "antigravity-acp", "antigravity-acp.exe"),
    win.join(localAppData, "Programs", "antigravity", "bin", "antigravity-acp.exe"),
    win.join(homeDir, ".gemini", "antigravity", "bin", "antigravity-acp.exe"),
    win.join(homeDir, ".gemini", "antigravity", "bin", "agy.exe"),
    win.join(homeDir, ".local", "bin", "antigravity-acp.exe"),
    win.join(homeDir, ".local", "bin", "agy.exe"),
  ];

  for (const dir of [...nodeToolBinDirCandidates(input), npmGlobal]) {
    out.push(win.join(dir, "antigravity-acp.exe"));
    out.push(win.join(dir, "agy.exe"));
  }

  return out;
}
