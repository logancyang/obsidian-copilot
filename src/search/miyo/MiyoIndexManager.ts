/**
 * Miyo Index Manager
 *
 * Manages vault indexing via the Miyo retrieval service.
 * Miyo handles chunking and embedding internally, so this manager
 * only needs to send file paths and track indexing status.
 */

import { logError, logInfo, logWarn } from "@/logger";
import { App, Notice, TFile } from "obsidian";
import { getMatchingPatterns, shouldIndexFile } from "../searchUtils";
import { MiyoClient } from "./MiyoClient";
import { MiyoClientConfig, IngestResponse } from "./types";

/**
 * State of the indexing operation.
 */
export interface MiyoIndexingState {
  isIndexing: boolean;
  isPaused: boolean;
  isCancelled: boolean;
  indexedCount: number;
  skippedCount: number;
  errorCount: number;
  totalFiles: number;
  currentFile: string | null;
  errors: string[];
}

/**
 * Options for indexing operations.
 */
export interface MiyoIndexOptions {
  /** Force re-indexing even if files haven't changed */
  force?: boolean;
  /** Callback for progress updates */
  onProgress?: (state: MiyoIndexingState) => void;
}

/**
 * Manages vault indexing via Miyo.
 *
 * This manager coordinates with Miyo to index vault files.
 * Unlike the local Orama-based indexing, Miyo handles chunking
 * and embedding on the server side.
 *
 * @example
 * ```typescript
 * const manager = new MiyoIndexManager(app, {
 *   baseUrl: "http://localhost:8000",
 *   sourceId: "my-vault"
 * });
 *
 * // Index the vault
 * await manager.indexVault();
 *
 * // Check if a file is indexed
 * const isIndexed = await manager.isFileIndexed("path/to/note.md");
 * ```
 */
export class MiyoIndexManager {
  private readonly app: App;
  private client: MiyoClient;
  private state: MiyoIndexingState;
  private currentNotice: Notice | null = null;
  private noticeMessage: HTMLSpanElement | null = null;
  private settingsUnsubscribe?: () => void;

  constructor(app: App, config: MiyoClientConfig) {
    this.app = app;
    this.client = new MiyoClient(config);
    this.state = this.createInitialState();
  }

  /**
   * Create the initial indexing state.
   */
  private createInitialState(): MiyoIndexingState {
    return {
      isIndexing: false,
      isPaused: false,
      isCancelled: false,
      indexedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      totalFiles: 0,
      currentFile: null,
      errors: [],
    };
  }

  /**
   * Get the current indexing state.
   */
  getState(): Readonly<MiyoIndexingState> {
    return { ...this.state };
  }

  /**
   * Check if the Miyo service is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.client.isAvailable();
  }

  /**
   * Index all vault files to Miyo.
   *
   * @param options - Indexing options
   * @returns Number of files successfully indexed
   */
  async indexVault(options?: MiyoIndexOptions): Promise<number> {
    if (this.state.isIndexing) {
      logWarn("MiyoIndexManager: Indexing already in progress");
      new Notice("Indexing is already in progress");
      return 0;
    }

    try {
      // Check Miyo availability
      const isAvailable = await this.client.isAvailable();
      if (!isAvailable) {
        new Notice("Miyo service is not available. Please check your connection settings.");
        return 0;
      }

      // Get files to index
      const files = await this.getFilesToIndex(options?.force);
      if (files.length === 0) {
        new Notice("Vault index is up-to-date.");
        return 0;
      }

      // Initialize state
      this.state = {
        ...this.createInitialState(),
        isIndexing: true,
        totalFiles: files.length,
      };

      this.createIndexingNotice();
      logInfo(`MiyoIndexManager: Starting indexing of ${files.length} files`);

      // Index files
      for (const file of files) {
        if (this.state.isCancelled) {
          break;
        }

        // Handle pause
        while (this.state.isPaused && !this.state.isCancelled) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (this.state.isCancelled) {
          break;
        }

        this.state.currentFile = file.path;
        this.updateNoticeMessage();
        options?.onProgress?.(this.getState());

        try {
          const result = await this.indexFile(file, options?.force);

          if (result.action === "indexed" || result.action === "updated") {
            this.state.indexedCount++;
          } else if (result.action === "skipped") {
            this.state.skippedCount++;
          } else if (result.action === "failed") {
            this.state.errorCount++;
            this.state.errors.push(file.path);
          }
        } catch (error) {
          logError(`MiyoIndexManager: Failed to index ${file.path}`, error);
          this.state.errorCount++;
          this.state.errors.push(file.path);
        }

        this.updateNoticeMessage();
        options?.onProgress?.(this.getState());
      }

      // Finalize
      this.finalizeIndexing();
      return this.state.indexedCount;
    } catch (error) {
      logError("MiyoIndexManager: Fatal error during indexing", error);
      this.state.isIndexing = false;
      this.hideNotice();
      new Notice("Indexing failed. Check console for details.");
      return 0;
    }
  }

  /**
   * Index a single file to Miyo.
   *
   * @param file - The file to index
   * @param force - Force re-indexing
   * @returns The ingest response
   */
  async indexFile(file: TFile, force?: boolean): Promise<IngestResponse> {
    return this.client.ingest({
      file: file.path,
      force: force ?? false,
    });
  }

  /**
   * Remove a file from the Miyo index.
   *
   * @param filePath - Path of the file to remove
   */
  async removeFile(filePath: string): Promise<void> {
    try {
      await this.client.deleteFile(filePath);
      logInfo(`MiyoIndexManager: Removed ${filePath} from index`);
    } catch (error) {
      logError(`MiyoIndexManager: Failed to remove ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Clear the entire Miyo index for this vault.
   */
  async clearIndex(): Promise<void> {
    try {
      const result = await this.client.clearIndex();
      logInfo(`MiyoIndexManager: Cleared index (${result.deleted_chunks} chunks deleted)`);
      new Notice(`Index cleared: ${result.deleted_chunks} chunks deleted`);
    } catch (error) {
      logError("MiyoIndexManager: Failed to clear index", error);
      throw error;
    }
  }

  /**
   * Check if a file is indexed in Miyo.
   *
   * @param filePath - Path of the file to check
   * @returns true if the file is indexed
   */
  async isFileIndexed(filePath: string): Promise<boolean> {
    return this.client.isFileIndexed(filePath);
  }

  /**
   * Get all indexed file paths.
   *
   * @returns Array of indexed file paths
   */
  async getIndexedFiles(): Promise<string[]> {
    return this.client.getAllIndexedFiles();
  }

  /**
   * Run garbage collection to remove files that no longer exist in the vault.
   *
   * @returns Number of files removed
   */
  async garbageCollect(): Promise<number> {
    try {
      // Get indexed files from Miyo
      const indexedFiles = await this.client.getAllIndexedFiles();
      if (indexedFiles.length === 0) {
        return 0;
      }

      // Find files that no longer exist in vault
      const staleFiles: string[] = [];
      for (const filePath of indexedFiles) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file) {
          staleFiles.push(filePath);
        }
      }

      if (staleFiles.length === 0) {
        logInfo("MiyoIndexManager: No stale files to remove");
        return 0;
      }

      // Delete stale files
      await this.client.deleteFiles(staleFiles);
      logInfo(`MiyoIndexManager: Garbage collected ${staleFiles.length} files`);
      new Notice(`Removed ${staleFiles.length} stale files from index`);
      return staleFiles.length;
    } catch (error) {
      logError("MiyoIndexManager: Garbage collection failed", error);
      throw error;
    }
  }

  /**
   * Pause the current indexing operation.
   */
  pause(): void {
    if (this.state.isIndexing) {
      this.state.isPaused = true;
      this.updateNoticeMessage();
    }
  }

  /**
   * Resume a paused indexing operation.
   */
  resume(): void {
    if (this.state.isIndexing && this.state.isPaused) {
      this.state.isPaused = false;
      this.updateNoticeMessage();
    }
  }

  /**
   * Cancel the current indexing operation.
   */
  cancel(): void {
    if (this.state.isIndexing) {
      this.state.isCancelled = true;
      logInfo("MiyoIndexManager: Indexing cancelled by user");
    }
  }

  /**
   * Update the Miyo client configuration.
   * Call this when settings change.
   *
   * @param config - New client configuration
   */
  updateConfig(config: MiyoClientConfig): void {
    this.client = new MiyoClient(config);
  }

  /**
   * Get the underlying Miyo client.
   */
  getClient(): MiyoClient {
    return this.client;
  }

  /**
   * Clean up resources.
   */
  cleanup(): void {
    if (this.settingsUnsubscribe) {
      this.settingsUnsubscribe();
    }
    this.hideNotice();
  }

  /**
   * Get files that need to be indexed.
   */
  private async getFilesToIndex(force?: boolean): Promise<TFile[]> {
    const { inclusions, exclusions } = getMatchingPatterns();
    const allMarkdownFiles = this.app.vault.getMarkdownFiles();

    // Filter files based on inclusion/exclusion patterns
    const eligibleFiles = allMarkdownFiles.filter((file) => {
      return shouldIndexFile(file, inclusions, exclusions);
    });

    if (force) {
      return eligibleFiles;
    }

    // Check which files are already indexed
    try {
      const indexedFiles = new Set(await this.client.getAllIndexedFiles());

      // Get file mtimes from Miyo
      const filesResponse = await this.client.listFiles({ limit: 200 });
      const indexedMtimes = new Map<string, number>();
      for (const file of filesResponse.files) {
        if (file.indexed_at) {
          indexedMtimes.set(file.file_path, file.indexed_at);
        }
      }

      // Filter to files that need indexing
      return eligibleFiles.filter((file) => {
        // Not indexed yet
        if (!indexedFiles.has(file.path)) {
          return true;
        }

        // Check if file has been modified since last index
        const indexedAt = indexedMtimes.get(file.path);
        if (indexedAt && file.stat.mtime > indexedAt) {
          return true;
        }

        return false;
      });
    } catch (error) {
      // If we can't get indexed files, index everything
      logWarn(
        "MiyoIndexManager: Could not get indexed files, will index all eligible files",
        error
      );
      return eligibleFiles;
    }
  }

  /**
   * Create the indexing progress notice.
   */
  private createIndexingNotice(): void {
    const frag = document.createDocumentFragment();
    const container = frag.createEl("div", { cls: "copilot-notice-container" });

    this.noticeMessage = container.createEl("div", { cls: "copilot-notice-message" });
    this.updateNoticeMessage();

    // Button container
    const buttonContainer = container.createEl("div", { cls: "copilot-notice-buttons" });

    // Pause/Resume button
    const pauseButton = buttonContainer.createEl("button");
    pauseButton.textContent = "Pause";
    pauseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (this.state.isPaused) {
        this.resume();
        pauseButton.textContent = "Pause";
      } else {
        this.pause();
        pauseButton.textContent = "Resume";
      }
    });

    // Stop button
    const stopButton = buttonContainer.createEl("button");
    stopButton.textContent = "Stop";
    stopButton.style.marginLeft = "8px";
    stopButton.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.cancel();
    });

    frag.appendChild(this.noticeMessage);
    frag.appendChild(buttonContainer);

    this.currentNotice = new Notice(frag, 0);
  }

  /**
   * Update the notice message.
   */
  private updateNoticeMessage(): void {
    if (!this.noticeMessage) return;

    const status = this.state.isPaused ? " (Paused)" : "";
    const progress = `${this.state.indexedCount + this.state.skippedCount + this.state.errorCount}/${this.state.totalFiles}`;

    const messages = [
      `Miyo is indexing your vault...${status}`,
      `Progress: ${progress} files processed`,
    ];

    if (this.state.currentFile) {
      const fileName = this.state.currentFile.split("/").pop() || this.state.currentFile;
      messages.push(`Current: ${fileName}`);
    }

    if (this.state.errorCount > 0) {
      messages.push(`Errors: ${this.state.errorCount}`);
    }

    this.noticeMessage.textContent = messages.join("\n");
  }

  /**
   * Hide the current notice.
   */
  private hideNotice(): void {
    if (this.currentNotice) {
      this.currentNotice.hide();
      this.currentNotice = null;
      this.noticeMessage = null;
    }
  }

  /**
   * Finalize the indexing operation.
   */
  private finalizeIndexing(): void {
    this.hideNotice();
    this.state.isIndexing = false;
    this.state.currentFile = null;

    if (this.state.isCancelled) {
      new Notice(`Indexing cancelled. ${this.state.indexedCount} files indexed.`);
    } else if (this.state.errorCount > 0) {
      new Notice(
        `Indexing completed with ${this.state.errorCount} errors. ` +
          `${this.state.indexedCount} files indexed, ${this.state.skippedCount} skipped.`
      );
    } else {
      new Notice(
        `Indexing completed! ${this.state.indexedCount} files indexed, ${this.state.skippedCount} skipped.`
      );
    }

    logInfo(
      `MiyoIndexManager: Indexing completed - ` +
        `indexed: ${this.state.indexedCount}, skipped: ${this.state.skippedCount}, errors: ${this.state.errorCount}`
    );
  }
}
