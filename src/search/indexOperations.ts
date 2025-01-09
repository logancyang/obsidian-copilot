import { CHUNK_SIZE } from "@/constants";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { RateLimiter } from "@/rateLimiter";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { formatDateTime } from "@/utils";
import { MD5 } from "crypto-js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { App, Notice, TFile } from "obsidian";
import { DBOperations } from "./dbOperations";
import { extractAppIgnoreSettings, getFilePathsForQA } from "./searchUtils";

const EMBEDDING_BATCH_SIZE = 16;
const CHECKPOINT_INTERVAL = 8 * EMBEDDING_BATCH_SIZE;

export interface IndexingState {
  isIndexingPaused: boolean;
  isIndexingCancelled: boolean;
  indexedCount: number;
  totalFilesToIndex: number;
  processedFiles: Set<string>;
  currentIndexingNotice: Notice | null;
  indexNoticeMessage: HTMLSpanElement | null;
}

export class IndexOperations {
  private rateLimiter: RateLimiter;
  private state: IndexingState = {
    isIndexingPaused: false,
    isIndexingCancelled: false,
    indexedCount: 0,
    totalFilesToIndex: 0,
    processedFiles: new Set(),
    currentIndexingNotice: null,
    indexNoticeMessage: null,
  };

  constructor(
    private app: App,
    private dbOps: DBOperations,
    private embeddingsManager: EmbeddingsManager
  ) {
    this.rateLimiter = new RateLimiter(getSettings().embeddingRequestsPerSecond);

    // Subscribe to settings changes
    subscribeToSettingsChange(async () => {
      const settings = getSettings();
      this.rateLimiter = new RateLimiter(settings.embeddingRequestsPerSecond);
    });
  }

  public async indexVaultToVectorStore(overwrite?: boolean): Promise<number> {
    let rateLimitNoticeShown = false;

    try {
      const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance) {
        console.error("Embedding instance not found.");
        return 0;
      }

      // Check for model change first
      const modelChanged = await this.dbOps.checkAndHandleEmbeddingModelChange(embeddingInstance);
      if (modelChanged) {
        // If model changed, force a full reindex by setting overwrite to true
        overwrite = true;
      }

      // Clear index if overwrite is true
      if (overwrite) {
        await this.dbOps.clearIndex(embeddingInstance);
      } else {
        // Run garbage collection first to clean up stale documents
        await this.dbOps.garbageCollect();
      }

      const files = await this.getFilesToIndex(overwrite);
      if (files.length === 0) {
        new Notice("Copilot vault index is up-to-date.");
        return 0;
      }

      this.initializeIndexingState(files.length);
      this.createIndexingNotice();

      // New: Prepare all chunks first
      const allChunks = await this.prepareAllChunks(files);
      if (allChunks.length === 0) {
        new Notice("No valid content to index.");
        return 0;
      }

      // Process chunks in batches
      const errors: string[] = [];
      for (let i = 0; i < allChunks.length; i += EMBEDDING_BATCH_SIZE) {
        if (this.state.isIndexingCancelled) break;
        await this.handlePause();

        const batch = allChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        try {
          await this.rateLimiter.wait();
          const embeddings = await embeddingInstance.embedDocuments(
            batch.map((chunk) => chunk.content)
          );

          // Save batch to database
          for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            await this.dbOps.upsert({
              ...chunk.fileInfo,
              id: this.getDocHash(chunk.content),
              content: chunk.content,
              embedding: embeddings[j],
              created_at: Date.now(),
              nchars: chunk.content.length,
            });
          }

          batch.forEach((chunk) => {
            this.state.processedFiles.add(chunk.fileInfo.path);
          });
          this.state.indexedCount = this.state.processedFiles.size;
          this.updateIndexingNoticeMessage();

          // Calculate if we've crossed a checkpoint threshold
          const previousCheckpoint = Math.floor(
            (this.state.indexedCount - batch.length) / CHECKPOINT_INTERVAL
          );
          const currentCheckpoint = Math.floor(this.state.indexedCount / CHECKPOINT_INTERVAL);

          if (currentCheckpoint > previousCheckpoint) {
            await this.dbOps.saveDB();
            console.log("Copilot index checkpoint save completed.");
          }
        } catch (err) {
          console.error("Batch processing error:", {
            error: err,
            batchSize: batch?.length || 0,
            firstChunk: batch?.[0]
              ? {
                  path: batch[0].fileInfo?.path,
                  contentLength: batch[0].content?.length,
                  hasFileInfo: !!batch[0].fileInfo,
                }
              : "No chunks in batch",
            errorType: err?.constructor?.name,
            errorMessage: err?.message,
          });
          this.handleIndexingError(err, batch?.[0]?.fileInfo?.path, errors, rateLimitNoticeShown);
          if (this.isRateLimitError(err)) {
            rateLimitNoticeShown = true;
            break;
          }
        }
      }

      this.finalizeIndexing(errors);
      await this.dbOps.saveDB();
      console.log("Copilot index final save completed.");
      return this.state.indexedCount;
    } catch (error) {
      this.handleFatalError(error);
      return 0;
    }
  }

  private async prepareAllChunks(files: TFile[]): Promise<
    Array<{
      content: string;
      fileInfo: any;
    }>
  > {
    const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingInstance) {
      console.error("Embedding instance not found.");
      return [];
    }
    const embeddingModel = EmbeddingsManager.getModelName(embeddingInstance);

    const textSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: CHUNK_SIZE,
    });
    const allChunks: Array<{ content: string; fileInfo: any }> = [];

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      if (!content?.trim()) continue;

      const fileCache = this.app.metadataCache.getFileCache(file);
      const fileInfo = {
        title: file.basename,
        path: file.path,
        embeddingModel,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        tags: fileCache?.tags?.map((tag) => tag.tag) ?? [],
        extension: file.extension,
        metadata: {
          ...(fileCache?.frontmatter ?? {}),
          created: formatDateTime(new Date(file.stat.ctime)).display,
          modified: formatDateTime(new Date(file.stat.mtime)).display,
        },
      };

      // Add note title as contextual chunk headers
      // https://js.langchain.com/docs/modules/data_connection/document_transformers/contextual_chunk_headers
      const chunks = await textSplitter.createDocuments([content], [], {
        chunkHeader: `\n\nNOTE TITLE: [[${fileInfo.title}]]\n\nMETADATA:${JSON.stringify(
          fileInfo.metadata
        )}\n\nNOTE BLOCK CONTENT:\n\n`,
        appendChunkOverlapHeader: true,
      });

      chunks.forEach((chunk) => {
        if (chunk.pageContent.trim()) {
          allChunks.push({
            content: chunk.pageContent,
            fileInfo,
          });
        }
      });
    }

    return allChunks;
  }

  private getDocHash(sourceDocument: string): string {
    return MD5(sourceDocument).toString();
  }

  private async getFilesToIndex(overwrite?: boolean): Promise<TFile[]> {
    // If overwrite is true, return all markdown files that match current filters
    if (overwrite) {
      const allMarkdownFiles = this.app.vault.getMarkdownFiles();
      const includedFiles = await getFilePathsForQA("inclusions", this.app);
      const excludedFiles = await getFilePathsForQA("exclusions", this.app);

      return allMarkdownFiles.filter((file) => {
        // Always respect exclusions, even with inclusion filters
        if (excludedFiles.has(file.path)) {
          return false;
        }
        // If there are inclusion filters, file must match one
        if (includedFiles.size > 0) {
          return includedFiles.has(file.path);
        }
        return true;
      });
    }

    // Get currently indexed files and latest mtime
    const indexedFilePaths = new Set(await this.dbOps.getIndexedFiles());
    const latestMtime = await this.dbOps.getLatestFileMtime();

    // Get current inclusion/exclusion rules
    const includedFiles = await getFilePathsForQA("inclusions", this.app);
    const excludedFiles = await getFilePathsForQA("exclusions", this.app);

    // Get all markdown files that should be indexed under current rules
    const allMarkdownFiles = this.app.vault.getMarkdownFiles();
    const filesToIndex = new Set<TFile>();
    const emptyFiles = new Set<string>();

    for (const file of allMarkdownFiles) {
      // Skip excluded files
      if (excludedFiles.has(file.path)) {
        continue;
      }

      // Check actual content
      const content = await this.app.vault.cachedRead(file);
      if (!content || content.trim().length === 0) {
        emptyFiles.add(file.path);
        continue;
      }

      const shouldBeIndexed = includedFiles.size === 0 || includedFiles.has(file.path);
      const isIndexed = indexedFilePaths.has(file.path);

      if (shouldBeIndexed && (!isIndexed || file.stat.mtime > latestMtime)) {
        filesToIndex.add(file);
      }
    }

    if (getSettings().debug) {
      console.log(`Files to index: ${filesToIndex.size}`);
      console.log(`Previously indexed: ${indexedFilePaths.size}`);
      console.log(`Empty files skipped: ${emptyFiles.size}`);
    }

    return Array.from(filesToIndex);
  }

  private initializeIndexingState(totalFiles: number) {
    this.state = {
      isIndexingPaused: false,
      isIndexingCancelled: false,
      indexedCount: 0,
      totalFilesToIndex: totalFiles,
      processedFiles: new Set(),
      currentIndexingNotice: null,
      indexNoticeMessage: null,
    };
  }

  private createIndexingNotice(): Notice {
    const frag = document.createDocumentFragment();
    const container = frag.createEl("div", { cls: "copilot-notice-container" });

    this.state.indexNoticeMessage = container.createEl("div", { cls: "copilot-notice-message" });
    this.updateIndexingNoticeMessage();

    // Create button container for better layout
    const buttonContainer = container.createEl("div", { cls: "copilot-notice-buttons" });

    // Pause/Resume button
    const pauseButton = buttonContainer.createEl("button");
    pauseButton.textContent = "Pause";
    pauseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (this.state.isIndexingPaused) {
        this.resumeIndexing();
        pauseButton.textContent = "Pause";
      } else {
        this.pauseIndexing();
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
      this.cancelIndexing();
    });

    frag.appendChild(this.state.indexNoticeMessage);
    frag.appendChild(buttonContainer);

    this.state.currentIndexingNotice = new Notice(frag, 0);
    return this.state.currentIndexingNotice;
  }

  private async handlePause(): Promise<void> {
    if (this.state.isIndexingPaused) {
      while (this.state.isIndexingPaused && !this.state.isIndexingCancelled) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // After we exit the pause loop (meaning we've resumed), re-evaluate files
      if (!this.state.isIndexingCancelled) {
        const files = await this.getFilesToIndex();
        if (files.length === 0) {
          // If no files to index after filter change, cancel the indexing
          console.log("No files to index after filter change, stopping indexing");
          this.cancelIndexing();
          new Notice("No files to index with current filters");
          return;
        }
        this.state.totalFilesToIndex = files.length;
        console.log("Total files to index:", this.state.totalFilesToIndex);
        console.log("Files to index:", files);
        this.updateIndexingNoticeMessage();
      }
    }
  }

  private pauseIndexing(): void {
    this.state.isIndexingPaused = true;
  }

  private resumeIndexing(): void {
    this.state.isIndexingPaused = false;
  }

  private updateIndexingNoticeMessage(): void {
    if (this.state.indexNoticeMessage) {
      const status = this.state.isIndexingPaused ? " (Paused)" : "";

      // Get the settings
      const settings = getSettings();
      const folders = extractAppIgnoreSettings(this.app);

      // Prepare inclusion and exclusion filter messages
      const inclusions = settings.qaInclusions
        ? `Inclusions: ${settings.qaInclusions}`
        : "Inclusions: None";
      const exclusions =
        folders.length > 0 || settings.qaExclusions
          ? `Exclusions: ${folders.join(", ")}${folders.length ? ", " : ""}${settings.qaExclusions || "None"}`
          : "Exclusions: None";

      this.state.indexNoticeMessage.textContent =
        `Copilot is indexing your vault...\n` +
        `${this.state.indexedCount}/${this.state.totalFilesToIndex} files processed${status}\n` +
        `${exclusions}\n${inclusions}`;
    }
  }

  private handleIndexingError(
    err: any,
    filePath: string,
    errors: string[],
    rateLimitNoticeShown: boolean
  ): void {
    console.error(`Error indexing file ${filePath || "unknown"}:`, err);
    errors.push(filePath || "unknown");
    if (!rateLimitNoticeShown) {
      new Notice(`Error indexing file ${filePath || "unknown"}. Check console for details.`);
    }
  }

  private isRateLimitError(err: any): boolean {
    return err?.message?.includes?.("rate limit") || false;
  }

  private finalizeIndexing(errors: string[]): void {
    if (this.state.currentIndexingNotice) {
      this.state.currentIndexingNotice.hide();
    }

    if (this.state.isIndexingCancelled) {
      new Notice(`Indexing cancelled`);
      return;
    }

    if (errors.length > 0) {
      new Notice(`Indexing completed with ${errors.length} errors. Check console for details.`);
    } else {
      new Notice("Indexing completed successfully!");
    }
  }

  private handleFatalError(error: any): void {
    console.error("Fatal error during indexing:", error);
    if (this.state.currentIndexingNotice) {
      this.state.currentIndexingNotice.hide();
    }
    new Notice("Fatal error during indexing. Check console for details.");
  }

  public async reindexFile(file: TFile): Promise<void> {
    try {
      const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance) {
        return;
      }

      await this.dbOps.removeDocs(file.path);

      // Check for model change
      const modelChanged = await this.dbOps.checkAndHandleEmbeddingModelChange(embeddingInstance);
      if (modelChanged) {
        await this.indexVaultToVectorStore(true);
        return;
      }

      // Reuse prepareAllChunks with a single file
      const chunks = await this.prepareAllChunks([file]);
      if (chunks.length === 0) return;

      // Process chunks
      const embeddings = await embeddingInstance.embedDocuments(
        chunks.map((chunk) => chunk.content)
      );

      // Save to database
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await this.dbOps.upsert({
          ...chunk.fileInfo,
          id: this.getDocHash(chunk.content),
          content: chunk.content,
          embedding: embeddings[i],
          created_at: Date.now(),
          nchars: chunk.content.length,
        });
      }

      // Mark that we have unsaved changes instead of saving immediately
      this.dbOps.markUnsavedChanges();

      if (getSettings().debug) {
        console.log(`Reindexed file: ${file.path}`);
      }
    } catch (error) {
      console.error(`Error reindexing file ${file.path}:`, error);
    }
  }

  public async cancelIndexing(): Promise<void> {
    console.log("Indexing cancelled by user");
    this.state.isIndexingCancelled = true;

    // Add a small delay to ensure all state updates are processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (this.state.currentIndexingNotice) {
      this.state.currentIndexingNotice.hide();
    }
  }
}
