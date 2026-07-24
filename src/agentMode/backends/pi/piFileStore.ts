import { PI_SESSIONS_FOLDER } from "@/pi/sessionStorage";
import type { PiFileStore } from "@/pi/types";
import type { App } from "obsidian";

/**
 * Back the transcript store with Obsidian's vault adapter. The adapter is the
 * one file API that exists on every platform, so transcripts written through
 * it survive on a phone as well as on the desktop.
 *
 * @param app the app whose vault adapter owns the plugin folder
 */
export function createPiFileStore(app: App): PiFileStore {
  const adapter = app.vault.adapter;
  const dir = `${app.vault.configDir}/plugins/copilot/${PI_SESSIONS_FOLDER}`;
  return {
    dir,
    read: (path) => adapter.read(path),
    write: (path, content) => adapter.write(path, content),
    append: (path, content) => adapter.append(path, content),
    mkdir: async (path) => {
      if (!(await adapter.exists(path))) await adapter.mkdir(path);
    },
    exists: (path) => adapter.exists(path),
  };
}
