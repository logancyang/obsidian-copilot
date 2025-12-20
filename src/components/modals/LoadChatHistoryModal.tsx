import {
  extractChatDate,
  extractChatLastAccessedAtMs,
  extractChatTitle,
  getChatDisplayText,
} from "@/utils/chatHistoryUtils";
import { getSettings } from "@/settings/model";
import { sortByStrategy } from "@/utils/recentUsageManager";
import { App, FuzzySuggestModal, TFile } from "obsidian";

export class LoadChatHistoryModal extends FuzzySuggestModal<TFile> {
  private onChooseFile: (file: TFile) => void;

  /**
   * Create a modal for selecting a chat history file from the vault.
   */
  constructor(
    app: App,
    private chatFiles: TFile[],
    onChooseFile: (file: TFile) => void
  ) {
    super(app);
    this.onChooseFile = onChooseFile;
  }

  /**
   * Return chat history files sorted by the persisted chat history sort strategy.
   */
  getItems(): TFile[] {
    const sortStrategy = getSettings().chatHistorySortStrategy;
    return sortByStrategy(this.chatFiles, sortStrategy, {
      getName: (file) => extractChatTitle(file),
      getCreatedAtMs: (file) => extractChatDate(file).getTime(),
      getLastUsedAtMs: (file) => extractChatLastAccessedAtMs(file),
    });
  }

  /**
   * Render the display label for a chat history file.
   */
  getItemText(file: TFile): string {
    return getChatDisplayText(file);
  }

  /**
   * Handle user selection.
   */
  onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent) {
    this.onChooseFile(file);
  }
}
