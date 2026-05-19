import * as fs from "node:fs";

/**
 * Retry-aware `fs.rename`. Windows commonly fails the first attempt when
 * Obsidian's vault watcher, OneDrive / Dropbox / iCloud, or AV hold an
 * open handle on either side; a brief wait + retry usually clears it.
 *
 * Lives under `skills/` (not `backends/opencode/`) so the skills layer can
 * reuse it without violating the import-direction rules: backends are
 * allowed to import skills, but not vice versa. The Opencode binary
 * installer imports this from its new home.
 *
 * @param from Source absolute path.
 * @param to Destination absolute path.
 * @param attempts Total attempts (default 3).
 */
export async function renameWithRetry(from: string, to: string, attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => window.setTimeout(r, 200));
    }
  }
  throw lastErr;
}
