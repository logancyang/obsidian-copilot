import { logError } from "@/logger";
import { Notice } from "obsidian";

/**
 * Open an absolute filesystem path with the OS default application via
 * Electron's shell. Used for paths that should not be routed through
 * `app.workspace.openLinkText` — e.g. files outside the vault, or under
 * agent dotfile folders Obsidian doesn't index — because `openLinkText`
 * would otherwise materialize a phantom note (and its parent folders) for
 * an unresolved target. Surfaces the path via a `Notice` on failure so the
 * user can still open it manually.
 */
export async function openWithSystemDefault(absPath: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as {
      shell?: { openPath?: (path: string) => Promise<string> };
      remote?: { shell?: { openPath?: (path: string) => Promise<string> } };
    };
    const shell = electron.shell ?? electron.remote?.shell;
    if (!shell?.openPath) {
      new Notice(`Open this file manually: ${absPath}`);
      return;
    }
    const errMsg = await shell.openPath(absPath);
    if (typeof errMsg === "string" && errMsg.length > 0) {
      logError(`openWithSystemDefault: shell.openPath failed for ${absPath}: ${errMsg}`);
      new Notice(`Could not open file: ${errMsg}`);
    }
  } catch (err) {
    logError(`openWithSystemDefault failed for ${absPath}:`, err);
    new Notice(`Open this file manually: ${absPath}`);
  }
}
