import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";

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
 */
export async function detectBinary(name: string): Promise<string | null> {
  if (!BINARY_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid binary name: ${JSON.stringify(name)}`);
  }
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(cmd, [name], { timeout: 5000 });
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
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
