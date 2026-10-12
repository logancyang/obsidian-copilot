import { logWarn } from "@/logger";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { getVaultBase } from "@/utils/vaultPath";
import { App, Notice, TFolder } from "obsidian";

export async function revealFolderInExplorer(app: App, relPath: string): Promise<void> {
  const folder = app.vault.getAbstractFileByPath(relPath);
  if (!(folder instanceof TFolder)) {
    if (await app.vault.adapter.exists(relPath)) {
      const vaultBase = getVaultBase(app);
      if (vaultBase) {
        // Hidden folders are not indexed, so the File Explorer cannot show them; the system file manager can. https://github.com/logancyang/obsidian-copilot/issues/3075
        await openWithSystemDefault(`${vaultBase}/${relPath}`);
        return;
      }
      new Notice(
        `Folder "${relPath}" is hidden and can't be shown in Obsidian's File Explorer.`,
        5000
      );
      return;
    }
    new Notice(`Folder "${relPath}" doesn't exist yet — it's created on first use.`, 5000);
    return;
  }
  const fileExplorer = (
    app as unknown as {
      internalPlugins?: {
        getPluginById?: (
          id: string
        ) =>
          | { enabled?: boolean; instance?: { revealInFolder?: (folder: TFolder) => void } }
          | undefined;
      };
    }
  ).internalPlugins?.getPluginById?.("file-explorer");
  if (fileExplorer?.enabled && fileExplorer.instance?.revealInFolder) {
    fileExplorer.instance.revealInFolder(folder);
    return;
  }
  logWarn("[settings] File Explorer plugin unavailable; cannot reveal folder.");
  new Notice("File Explorer isn't enabled; can't reveal the folder.", 5000);
}
