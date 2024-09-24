import { formatDateTime, FormattedDateTime } from "@/utils";
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
    const [title] = file.basename.split("@");
    let formattedDateTime: FormattedDateTime;

    // Read the file's front matter
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter && frontmatter.epoch) {
      // Use the epoch from front matter if available
      formattedDateTime = formatDateTime(new Date(frontmatter.epoch));
    } else {
      // Fallback to file creation time if epoch is not in front matter
      formattedDateTime = formatDateTime(new Date(file.stat.ctime));
    }

    return `${title.replace(/_/g, " ").trim()} - ${formattedDateTime.display}`;
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
    this.onChooseFile(file);
  }
}
