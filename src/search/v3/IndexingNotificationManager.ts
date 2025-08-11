import { Notice } from "obsidian";
import { App } from "obsidian";
import { getSettings } from "@/settings/model";
import { extractAppIgnoreSettings, getDecodedPatterns } from "@/search/searchUtils";

export interface IndexingProgress {
  completed: number;
  total: number;
}

/**
 * Manages UI notifications during indexing operations
 */
export class IndexingNotificationManager {
  private static readonly PAUSE_CHECK_INTERVAL_MS = 100; // Interval for checking pause state
  private static readonly BUTTON_MARGIN_LEFT = "8px"; // Button spacing

  private notice: Notice | null = null;
  private messageEl: HTMLDivElement | null = null;
  private isPaused = false;
  private isCancelled = false;

  constructor(private app: App) {}

  /**
   * Show the indexing notification with pause/stop controls
   */
  show(totalFiles: number): void {
    const container = document.createElement("div");
    container.className = "copilot-notice-container";

    const msg = document.createElement("div");
    msg.className = "copilot-notice-message";
    msg.textContent = "";
    container.appendChild(msg);
    this.messageEl = msg;

    const buttonContainer = document.createElement("div");
    buttonContainer.className = "copilot-notice-buttons";

    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Pause";
    pauseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (this.isPaused) {
        this.isPaused = false;
        pauseButton.textContent = "Pause";
      } else {
        this.isPaused = true;
        pauseButton.textContent = "Resume";
      }
    });
    buttonContainer.appendChild(pauseButton);

    const stopButton = document.createElement("button");
    stopButton.textContent = "Stop";
    stopButton.style.marginLeft = IndexingNotificationManager.BUTTON_MARGIN_LEFT;
    stopButton.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.isCancelled = true;
      this.hide();
    });
    buttonContainer.appendChild(stopButton);

    container.appendChild(buttonContainer);

    const frag = document.createDocumentFragment();
    frag.appendChild(container);
    this.notice = new Notice(frag, 0);

    this.update({ completed: 0, total: totalFiles });
  }

  /**
   * Update the progress message
   */
  update(progress: IndexingProgress): void {
    if (!this.messageEl) return;

    const status = this.isPaused ? " (Paused)" : "";
    const messages: string[] = [
      `Copilot is indexing your vault...`,
      `${progress.completed}/${progress.total} files processed${status}`,
    ];

    const settings = getSettings();
    const inclusions = getDecodedPatterns(settings.qaInclusions);
    if (inclusions.length > 0) {
      messages.push(`Inclusions: ${inclusions.join(", ")}`);
    }

    const obsidianIgnoreFolders = extractAppIgnoreSettings(this.app);
    const exclusions = [...obsidianIgnoreFolders, ...getDecodedPatterns(settings.qaExclusions)];
    if (exclusions.length > 0) {
      messages.push(`Exclusions: ${exclusions.join(", ")}`);
    }

    this.messageEl.textContent = messages.join("\n");
  }

  /**
   * Show final completion notice
   */
  finalize(fileCount: number): void {
    this.hide();

    if (this.isCancelled) {
      new Notice("Indexing cancelled");
    } else if (fileCount > 0) {
      new Notice(`Indexing completed successfully! Indexed ${fileCount} files.`);
    } else {
      new Notice("Indexing completed successfully!");
    }
  }

  /**
   * Hide the notification
   */
  hide(): void {
    if (this.notice) {
      this.notice.hide();
    }
    this.notice = null;
    this.messageEl = null;
  }

  /**
   * Check if indexing should be paused
   */
  get shouldPause(): boolean {
    return this.isPaused;
  }

  /**
   * Check if indexing should be cancelled
   */
  get shouldCancel(): boolean {
    return this.isCancelled;
  }

  /**
   * Check if notification is currently active
   */
  get isActive(): boolean {
    return this.notice !== null;
  }

  /**
   * Wait while paused
   */
  async waitIfPaused(): Promise<void> {
    if (!this.isPaused) return;
    while (this.isPaused && !this.isCancelled) {
      await new Promise((resolve) =>
        setTimeout(resolve, IndexingNotificationManager.PAUSE_CHECK_INTERVAL_MS)
      );
    }
  }

  /**
   * Reset the notification state
   */
  reset(): void {
    this.hide();
    this.isPaused = false;
    this.isCancelled = false;
  }
}
