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

  /**
   * Create a modal for selecting a chat history file from the vault.
   */
  constructor(
    app: App,
    private chatFiles: TFile[],
    private chatHistoryLastAccessedAtManager: RecentUsageManager<string>,
    onChooseFile: (file: TFile) => void
  ) {
    super(app);
    this.onChooseFile = onChooseFile;
  }

  /**
   * Return chat history files sorted by the configured strategy.
   * Uses in-memory recency data for immediate UI feedback when available.
   */
  getItems(): TFile[] {
    const sortStrategy = getSettings().chatHistorySortStrategy;
    return sortByStrategy(this.chatFiles, sortStrategy, {
      getName: (file) => extractChatTitle(this.app, file),
      getCreatedAtMs: (file) => extractChatDate(this.app, file).getTime(),
      getLastUsedAtMs: (file) => {
        // Reason: Use getEffectiveLastUsedAt to prefer in-memory value over persisted frontmatter.
        // This ensures the modal reflects recent access immediately, even within the throttle window.
        const persistedMs = extractChatLastAccessedAtMs(this.app, file);
        return this.chatHistoryLastAccessedAtManager.getEffectiveLastUsedAt(file.path, persistedMs);
      },
    });
  }

  /**
   * Render the display label for a chat history file.
   */
  getItemText(file: TFile): string {
    return getChatDisplayText(this.app, file);
  }

  /**
   * Handle user selection.
   */
  onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent) {
    this.onChooseFile(file);
  }
}
