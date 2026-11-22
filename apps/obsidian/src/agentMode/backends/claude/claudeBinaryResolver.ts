import { WELL_KNOWN_BIN_DIRS } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { nodeToolBinDirCandidates, type NodeToolFs } from "@/utils/nodeToolBinDirs";

export type ClaudeBinaryResolverFs = NodeToolFs;

export interface ClaudeBinaryResolverInput {
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
  const path = requireNodeModule<typeof import("node:path")>("path");
  const pathImpl = input.platform === "win32" ? path.win32 : path.posix;
  return Array.from(
    new Set(
      candidates
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => pathImpl.dirname(candidate))
    )
  );
}

function unixCandidates(input: ClaudeBinaryResolverInput): Array<string | null> {
  const posix = requireNodeModule<typeof import("node:path")>("path").posix;
  const { homeDir, env } = input;
  const dirs = [...nodeToolBinDirCandidates(input), ...WELL_KNOWN_BIN_DIRS];
  return [
    posix.join(homeDir, ".claude", "local", "claude"),
    ...dirs.map((dir) => posix.join(dir, "claude")),
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
  const win = requireNodeModule<typeof import("node:path")>("path").win32;
  const { homeDir, env } = input;
  const localAppData = env.LOCALAPPDATA ?? win.join(homeDir, "AppData", "Local");
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  const out: Array<string | null> = [
    win.join(homeDir, ".local", "bin", "claude.exe"),
    win.join(homeDir, ".claude", "local", "claude.exe"),
    win.join(localAppData, "Claude", "claude.exe"),
    win.join(programFiles, "Claude", "claude.exe"),
    win.join(programFilesX86, "Claude", "claude.exe"),
  ];
  for (const dir of nodeToolBinDirCandidates(input)) {
    out.push(win.join(dir, "claude.exe"));
    out.push(win.join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli-wrapper.cjs"));
    out.push(win.join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
  }
  return out;
}
