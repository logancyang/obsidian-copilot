import { App, FuzzySuggestModal } from "obsidian";
import { extractAppIgnoreSettings } from "@/search/searchUtils";

export class FolderSearchModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private onChooseFolder: (folder: string) => void
  ) {
    super(app);
  }

  getItems(): string[] {
    const folderSet = new Set<string>();
    const ignoredFolders = extractAppIgnoreSettings(this.app);

    // Get all files in vault
    this.app.vault.getAllLoadedFiles().forEach((file) => {
      if (file.parent?.path && file.parent.path !== "/") {
        // Check if the folder or any of its parent folders are ignored
        const shouldInclude = !ignoredFolders.some(
          (ignored) => file.parent!.path === ignored || file.parent!.path.startsWith(ignored + "/")
        );

        if (shouldInclude) {
          folderSet.add(file.parent.path);
        }
      }
    });
    return Array.from(folderSet);
  }

  getItemText(tag: string): string {
    return tag;
  }

  onChooseItem(folder: string, evt: MouseEvent | KeyboardEvent) {
    this.onChooseFolder(folder);
  }
}
