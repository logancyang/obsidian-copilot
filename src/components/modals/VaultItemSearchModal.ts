import { App, FuzzySuggestModal, TAbstractFile, TFolder } from "obsidian";

export class VaultItemSearchModal extends FuzzySuggestModal<TAbstractFile> {
  constructor(
    app: App,
    private onChoose: (item: TAbstractFile) => void
  ) {
    super(app);
    this.setPlaceholder("Link a note or folder...");
  }

  getItems(): TAbstractFile[] {
    return this.app.vault.getAllLoadedFiles().filter((item) => item.path !== "/");
  }

  getItemText(item: TAbstractFile): string {
    return item instanceof TFolder ? `${item.path}/` : item.path;
  }

  onChooseItem(item: TAbstractFile): void {
    this.onChoose(item);
  }
}
