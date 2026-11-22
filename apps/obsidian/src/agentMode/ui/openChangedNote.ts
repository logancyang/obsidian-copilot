import { logError } from "@/logger";
import { openFileInTab, type OpenPane } from "@/utils/openVaultPath";
import { Notice, TFile, type App } from "obsidian";

export function openChangedNote(app: App, path: string, pane: OpenPane): void {
  const file = app.vault.getAbstractFileByPath(path);
  // Opening a path whose file was renamed or deleted after the turn would create an empty note.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (!(file instanceof TFile)) {
    new Notice(`${path} no longer exists.`);
    return;
  }
  void openFileInTab(app, file, pane).catch((error: unknown) =>
    logError("[openChangedNote] failed to open the note", error)
  );
}
