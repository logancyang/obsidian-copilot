/**
 * Locate the user-installed `claude` CLI to pass as
 * `pathToClaudeCodeExecutable`. The SDK's auto-discovery walks
 * `import.meta.url`, which fails inside Obsidian's bundled `main.js`.
 *
 * Directory discovery is shared with the generic backend detector via
 * {@link nodeToolBinDirCandidates} (nvm/fnm/Volta/asdf/n/npm-global); this
 * resolver only layers on the Claude-specific filenames and package fallbacks.
 *
 * Pure leaf: callers inject `homeDir`, `platform`, `env`, and `fs` so tests
 * don't touch real disk.
 */
import * as path from "node:path";

import { WELL_KNOWN_BIN_DIRS } from "@/utils/binaryPath";
import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type ClaudeBinaryResolverFs = NodeToolFs;

export interface ClaudeBinaryResolverInput {
  /** User-configured override path. If set and exists, returned as-is. */
  override?: string;
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fs: ClaudeBinaryResolverFs;
}

export function resolveClaudeBinary(input: ClaudeBinaryResolverInput): string | null {
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

export function claudeBinarySearchDirs(input: ClaudeBinaryResolverInput): string[] {
  const candidates = input.platform === "win32" ? windowsCandidates(input) : unixCandidates(input);
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  return Array.from(
    new Set(
      candidates
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => pathImpl.dirname(candidate))
    )
  );
}

const posix = path.posix;
const win = path.win32;

function unixCandidates(input: ClaudeBinaryResolverInput): Array<string | null> {
  const { homeDir, env } = input;
  // Every bin dir a Node version manager / npm-global install might use, plus
  // the well-known system prefixes — then `claude` under each.
  const dirs = [...nodeToolBinDirCandidates(input), ...WELL_KNOWN_BIN_DIRS];
  return [
    posix.join(homeDir, ".claude", "local", "claude"),
    ...dirs.map((dir) => posix.join(dir, "claude")),
    // `npm i -g @anthropic-ai/claude-code` package fallbacks (no `bin` shim).
    posix.join(
      homeDir,
      ".npm-global",
      "lib",
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "cli.js"
    ),
    env.npm_config_prefix
      ? posix.join(
          env.npm_config_prefix,
          "lib",
          "node_modules",
          "@anthropic-ai",
          "claude-code",
          "cli.js"
        )
      : null,
    "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
    "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js",
  ];
}

function windowsCandidates(input: ClaudeBinaryResolverInput): Array<string | null> {
  const { homeDir, env } = input;
  const localAppData = env.LOCALAPPDATA ?? win.join(homeDir, "AppData", "Local");
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  // Native-installer (`irm https://claude.ai/install.ps1 | iex`) destinations
  // probed before the node-tool layout. Fixed list — no PATH walk. A PATH walk
  // on Windows risks `WindowsApps\Claude.exe`, the desktop app's GUI launcher
  // (opens a window instead of streaming stream-json).
  const out: Array<string | null> = [
    win.join(homeDir, ".local", "bin", "claude.exe"),
    win.join(homeDir, ".claude", "local", "claude.exe"),
    win.join(localAppData, "Claude", "claude.exe"),
    win.join(programFiles, "Claude", "claude.exe"),
    win.join(programFilesX86, "Claude", "claude.exe"),
  ];
  // Per-dir, prefer `claude.exe`, then `cli-wrapper.cjs` (newer Claude Code
  // packaging), then `cli.js` (legacy) under that dir's node_modules. Never
  // pick `claude.cmd` — it requires `shell: true` and breaks SDK stdio
  // streaming.
  for (const dir of nodeToolBinDirCandidates(input)) {
    out.push(win.join(dir, "claude.exe"));
    out.push(win.join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli-wrapper.cjs"));
    out.push(win.join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
  }
  return out;
}
