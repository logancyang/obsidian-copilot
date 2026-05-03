/**
 * Locate the user-installed `claude` CLI to pass as
 * `pathToClaudeCodeExecutable`. The SDK's auto-discovery walks
 * `import.meta.url`, which fails inside Obsidian's bundled `main.js`.
 *
 * Pure leaf: callers inject `homeDir`, `platform`, `env`, and `fs` so tests
 * don't touch real disk.
 */
import * as path from "node:path";

export interface ClaudeBinaryResolverFs {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
}

export interface ClaudeBinaryResolverInput {
  /** User-configured override path. If set and exists, returned as-is. */
  override?: string;
  homeDir: string;
  platform: NodeJS.Platform;
  env: { NVM_BIN?: string; npm_config_prefix?: string; APPDATA?: string };
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

const posix = path.posix;
const win = path.win32;

function unixCandidates(input: ClaudeBinaryResolverInput): Array<string | null> {
  const { homeDir, env, fs } = input;
  return [
    posix.join(homeDir, ".claude", "local", "claude"),
    posix.join(homeDir, ".local", "bin", "claude"),
    posix.join(homeDir, ".volta", "bin", "claude"),
    posix.join(homeDir, ".asdf", "shims", "claude"),
    posix.join(homeDir, ".asdf", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    posix.join(homeDir, ".npm-global", "bin", "claude"),
    env.npm_config_prefix ? posix.join(env.npm_config_prefix, "bin", "claude") : null,
    env.NVM_BIN ? posix.join(env.NVM_BIN, "claude") : null,
    resolveNvmDefaultClaude(homeDir, fs),
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
  // Per-dir, prefer `claude.exe`, then `cli.js` under that dir's
  // node_modules. Never pick `claude.cmd` — it requires `shell: true` and
  // breaks SDK stdio streaming.
  const dirs = [
    env.APPDATA ? win.join(env.APPDATA, "npm") : null,
    env.npm_config_prefix ?? null,
    win.join(homeDir, "AppData", "Roaming", "npm"),
  ];
  const out: Array<string | null> = [];
  for (const dir of dirs) {
    if (!dir) continue;
    out.push(win.join(dir, "claude.exe"));
    out.push(win.join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
  }
  return out;
}

/**
 * NVM doesn't export `NVM_BIN` to GUI applications on macOS, so reading
 * `~/.nvm/alias/default` is the most reliable way to find the user's default
 * Node install. The file may contain `vX.Y.Z`, `X.Y.Z`, or an unresolvable
 * alias like `lts/*` — the latter we silently skip.
 */
function resolveNvmDefaultClaude(homeDir: string, fs: ClaudeBinaryResolverFs): string | null {
  const aliasPath = posix.join(homeDir, ".nvm", "alias", "default");
  let raw: string;
  try {
    raw = fs.readFileSync(aliasPath, "utf8");
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const versionPattern = /^v?\d+\.\d+\.\d+/;
  if (!versionPattern.test(trimmed)) return null;
  const version = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  return posix.join(homeDir, ".nvm", "versions", "node", version, "bin", "claude");
}
