/**
 * Locate a user-installed `codex-acp` adapter for the Codex Configure dialog.
 * On Windows, the npm shim (`codex-acp.cmd`) is not spawnable through Agent
 * Mode's no-shell process path, so resolve the package's JavaScript entry point
 * and let the backend launch it through Obsidian's bundled Node runtime.
 */
import { requireNodeModule } from "@/utils/desktopRuntime";
import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type CodexAcpBinaryResolverFs = NodeToolFs;

export interface CodexAcpBinaryResolverInput {
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: CodexAcpBinaryResolverFs;
}

export function resolveCodexAcpBinary(
  input: CodexAcpBinaryResolverInput,
  accepts: (candidate: string) => boolean = () => true
): string | null {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);

  for (const candidate of candidates) {
    if (candidate && input.fs.existsSync(candidate) && accepts(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function codexAcpSearchDirs(input: CodexAcpBinaryResolverInput): string[] {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);
  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  return Array.from(new Set(candidates.map((candidate) => pathImpl.dirname(candidate))));
}

function unixCandidates(input: CodexAcpBinaryResolverInput): string[] {
  const posix = requireNodeModule<typeof import("node:path")>("path").posix;
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
  const win = requireNodeModule<typeof import("node:path")>("path").win32;
  const { homeDir, env } = input;
  const appData = env.APPDATA ?? win.join(homeDir, "AppData", "Roaming");
  const npmGlobal = win.join(appData, "npm");
  const out: string[] = [];

  for (const dir of [...nodeToolBinDirCandidates(input), npmGlobal]) {
    out.push(
      win.join(dir, "node_modules", "@agentclientprotocol", "codex-acp", "dist", "index.js")
    );
  }

  return out;
}
