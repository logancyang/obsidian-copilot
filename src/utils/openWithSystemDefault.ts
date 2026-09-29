import { logError } from "@/logger";
import { Notice } from "obsidian";

export async function openWithSystemDefault(absPath: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell is optional and loaded lazily for this desktop-only action
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
