import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import { augmentPathForDetection } from "@/utils/binaryPath";

const execFileAsync = promisify(execFile);

/**
 * Allowed shape for binary names handed to `which`/`where`. Restricts to
 * characters that real binary names use (alphanumerics, dot, dash,
 * underscore, plus). `execFile` already skips the shell, but this is a
 * defensive backstop so a future caller can't accidentally pipe a
 * user-controlled string with spaces or path separators into the lookup.
 */
const BINARY_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;

/**
 * Resolve the absolute path of an executable on `PATH`. Returns the first
 * match (Windows `where` may return many) or `null` when none exists or the
 * lookup tool itself isn't available.
 *
 * `name` MUST be a trusted literal (matching {@link BINARY_NAME_PATTERN}) —
 * never pass user input directly. Throws synchronously if the shape is
 * wrong rather than silently doing the wrong thing.
 *
 * Implementation deliberately uses `which` (POSIX) / `where` (Windows) rather
 * than parsing `PATH` ourselves so we honor the user's shell-equivalent
 * resolution rules (PATHEXT on Windows, symlink chasing, etc.).
 *
 * We augment PATH with well-known install prefixes and live version-manager
 * bin dirs before invoking the lookup. macOS GUI apps (Obsidian launched from
 * Finder/Dock) inherit a sparse `launchd` PATH that omits `/opt/homebrew/bin`
 * and nvm/fnm/asdf/Volta dirs; Windows GUI apps similarly miss `%APPDATA%\npm`,
 * so user-installed binaries (Homebrew, `npm install -g`, version managers)
 * would otherwise fail to detect.
 *
 * On Windows we drop `.cmd`/`.bat`/`.ps1` and extensionless matches and prefer
 * `.exe`: ACP backends spawn over stdio without `shell: true`, where a `.cmd`
 * shim can't launch and breaks stdio streaming (same rule as
 * `claudeBinaryResolver.ts`).
 */
export async function detectBinary(name: string): Promise<string | null> {
  if (!BINARY_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid binary name: ${JSON.stringify(name)}`);
  }
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "where" : "which";
  const env = { ...process.env, PATH: augmentPathForDetection(process.env.PATH) };
  try {
    const { stdout } = await execFileAsync(cmd, [name], { timeout: 5000, env });
    const matches = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return isWindows ? pickWindowsExecutable(matches) : (matches[0] ?? null);
  } catch {
    return null;
  }
}

/**
 * Pick the first stdio-spawnable match from `where` output. Drops `.cmd` /
 * `.bat` / `.ps1` shims (they require `shell: true` and break stdio) and
 * prefers a native `.exe`. Also drops extensionless matches: npm's cmd-shim
 * writes a `#!/bin/sh` POSIX shim with no extension alongside the `.cmd`/`.ps1`
 * pair, and `child_process.spawn` (no shell) can't launch that either. Returns
 * null — i.e. treat as not-found — when only an unspawnable shim exists, rather
 * than handing back a path that fails to launch.
 */
function pickWindowsExecutable(matches: string[]): string | null {
  const spawnable = matches.filter(
    (m) => !/\.(cmd|bat|ps1)$/i.test(m) && path.win32.extname(m) !== ""
  );
  const exe = spawnable.find((m) => /\.exe$/i.test(m));
  return exe ?? spawnable[0] ?? null;
}

/**
 * Validate that `p` is a real file and (on POSIX) marked executable.
 * Returns an error message suitable for surfacing in UI, or `null` when ok.
 * Centralizes the checks so backend-specific path inputs catch obvious
 * misconfigurations at config time rather than at spawn time.
 */
export async function validateExecutableFile(p: string): Promise<string | null> {
  const stat = await fs.promises.stat(p).catch(() => null);
  if (!stat || !stat.isFile()) return `No file at ${p}.`;
  if (process.platform !== "win32") {
    try {
      await fs.promises.access(p, fs.constants.X_OK);
    } catch {
      return `${p} is not executable. chmod +x and try again.`;
    }
  }
  return null;
}
