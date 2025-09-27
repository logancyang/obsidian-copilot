import { getChatDisplayText } from "@/utils/chatHistoryUtils";
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
    return this.chatFiles.sort((a, b) => {
      const getEpoch = (file: TFile) => {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return frontmatter && frontmatter.epoch ? frontmatter.epoch : file.stat.ctime;
      };

      const epochA = getEpoch(a);
      const epochB = getEpoch(b);

      // Sort in descending order (most recent first)
      return epochB - epochA;
    });
  }

  getItemText(file: TFile): string {
    return getChatDisplayText(file);
  }

  onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent) {
    this.onChooseFile(file);
  }
}
