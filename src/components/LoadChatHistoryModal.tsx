import { App, FuzzySuggestModal, TFile } from "obsidian";

export class LoadChatHistoryModal extends FuzzySuggestModal<TFile> {
  private onChooseFile: (file: TFile) => void;

  constructor(
    app: App,
    private chatFiles: TFile[],
    onChooseFile: (file: TFile) => void
  ) {
    super(app);
    this.onChooseFile = onChooseFile;
  }

  getItems(): TFile[] {
    return this.chatFiles;
  }

  getItemText(file: TFile): string {
    const [title, timestamp] = file.basename.split("@");
    if (timestamp) {
      const formattedTimestamp = timestamp
        .replace(/_/g, "/")
        .replace(/(\d{4}\/\d{2}\/\d{2})\//, "$1 ")
        .replace(/(\d{2})\/(\d{2})\/(\d{2})$/, "$1:$2:$3");
      return `${title.replace(/_/g, " ").trim()} - ${formattedTimestamp}`;
    }
    return file.basename;
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
    this.onChooseFile(file);
  }
}
