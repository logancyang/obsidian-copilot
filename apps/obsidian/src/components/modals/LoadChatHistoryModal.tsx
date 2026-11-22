import {
  extractChatDate,
  extractChatLastAccessedAtMs,
  extractChatTitle,
  getChatDisplayText,
} from "@/utils/chatHistoryUtils";
import { getSettings } from "@/settings/model";
import { RecentUsageManager, sortByStrategy } from "@/utils/recentUsageManager";
import { App, FuzzySuggestModal, TFile } from "obsidian";

export class LoadChatHistoryModal extends FuzzySuggestModal<TFile> {
  private onChooseFile: (file: TFile) => void;

  constructor(
    app: App,
    private chatFiles: TFile[],
    private chatHistoryLastAccessedAtManager: RecentUsageManager<string>,
    onChooseFile: (file: TFile) => void
  ) {
    super(app);
    this.onChooseFile = onChooseFile;
  }

  getItems(): TFile[] {
    const sortStrategy = getSettings().chatHistorySortStrategy;
    return sortByStrategy(this.chatFiles, sortStrategy, {
      getName: (file) => extractChatTitle(this.app, file),
      getCreatedAtMs: (file) => extractChatDate(this.app, file).getTime(),
      getLastUsedAtMs: (file) => {
        const persistedMs = extractChatLastAccessedAtMs(this.app, file);
        return this.chatHistoryLastAccessedAtManager.getEffectiveLastUsedAt(file.path, persistedMs);
      },
    });
  }

  getItemText(file: TFile): string {
    return getChatDisplayText(this.app, file);
  }

  onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent) {
    this.onChooseFile(file);
  }
}
