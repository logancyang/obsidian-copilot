import { CHUNK_SIZE } from "@/constants";
import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { RateLimiter } from "@/rateLimiter";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { formatDateTime } from "@/utils";
import { Embeddings } from "@langchain/core/embeddings";
import { MD5 } from "crypto-js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { App, Notice, TFile } from "obsidian";
import { DBOperations } from "./dbOperations";
import { extractAppIgnoreSettings, getFilePathsForQA } from "./searchUtils";

export interface IndexingState {
  isIndexingPaused: boolean;
  isIndexingCancelled: boolean;
  indexedCount: number;
  totalFilesToIndex: number;
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

  public async indexFile(file: TFile): Promise<void> {
    const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingInstance) {
      throw new CustomError("Embedding instance not found.");
    }

    const content = await this.app.vault.cachedRead(file);
    const fileCache = this.app.metadataCache.getFileCache(file);

    const fileToSave = {
      title: file.basename,
      path: file.path,
      content: content,
      embeddingModel: EmbeddingsManager.getModelName(embeddingInstance),
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

    await this.indexDocument(embeddingInstance, fileToSave);
  }

  private async indexDocument(
    embeddingsAPI: Embeddings,
    fileToSave: any
  ): Promise<any | undefined> {
    const textSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: CHUNK_SIZE,
    });

    // Add note title as contextual chunk headers
    // https://js.langchain.com/docs/modules/data_connection/document_transformers/contextual_chunk_headers
    const chunks = await textSplitter.createDocuments([fileToSave.content], [], {
      chunkHeader: `\n\nNOTE TITLE: [[${fileToSave.title}]]\n\nMETADATA:${JSON.stringify(
        fileToSave.metadata
      )}\n\nNOTE BLOCK CONTENT:\n\n`,
      appendChunkOverlapHeader: true,
    });

    const docVectors: number[][] = [];
    let hasEmbeddingError = false;

    // Generate all embeddings first
    for (let i = 0; i < chunks.length; i++) {
      try {
        await this.rateLimiter.wait();
        const embedding = await embeddingsAPI.embedDocuments([chunks[i].pageContent]);

        if (embedding.length > 0 && embedding[0].length > 0) {
          docVectors.push(embedding[0]);
        } else {
          throw new Error("Received empty embedding vector");
        }
      } catch (error) {
        hasEmbeddingError = true;
        console.error("Error during embeddings API call for chunk:", error);
        throw error;
      }
    }

    // Only proceed with saving if we have valid vectors
    if (docVectors.length > 0) {
      const chunkWithVectors = chunks.slice(0, docVectors.length).map((chunk, i) => ({
        id: this.getDocHash(chunk.pageContent),
        content: chunk.pageContent,
        embedding: docVectors[i],
      }));

      // Wait for all database operations to complete before considering the document indexed
      try {
        for (const chunkWithVector of chunkWithVectors) {
          await this.dbOps.upsert({
            ...fileToSave,
            id: chunkWithVector.id,
            content: chunkWithVector.content,
            embedding: chunkWithVector.embedding,
            created_at: Date.now(),
            nchars: chunkWithVector.content.length,
          });
        }
      } catch (error) {
        hasEmbeddingError = true;
        console.error("Error during database upsert:", error);
        throw error;
      }
    }

    return hasEmbeddingError ? undefined : fileToSave;
  }

  public async indexVaultToVectorStore(overwrite?: boolean): Promise<number> {
    let rateLimitNoticeShown = false;

    try {
      const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance) {
        throw new CustomError("Embedding instance not found.");
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

      const CHECKPOINT_INTERVAL = 200;
      const errors: string[] = [];

      for (let index = 0; index < files.length; index++) {
        if (this.state.isIndexingCancelled) {
          console.log(
            `Indexing stopped at ${this.state.indexedCount}/${files.length} files due to cancellation`
          );
          break;
        }
        await this.handlePause();

        try {
          await this.indexFile(files[index]);
          this.state.indexedCount++;
          this.updateIndexingNoticeMessage();

          if (this.state.indexedCount % CHECKPOINT_INTERVAL === 0) {
            await this.dbOps.saveDB();
            console.log("Copilot index checkpoint save completed.");
          }
        } catch (err) {
          this.handleIndexingError(err, files[index], errors, rateLimitNoticeShown);
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
    file: TFile,
    errors: string[],
    rateLimitNoticeShown: boolean
  ): void {
    console.error(`Error indexing file ${file.path}:`, err);
    errors.push(file.path);
    if (!rateLimitNoticeShown) {
      new Notice(`Error indexing file ${file.path}. Check console for details.`);
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

      // Proceed with single file reindex
      const content = await this.app.vault.cachedRead(file);
      const fileCache = this.app.metadataCache.getFileCache(file);

      const fileToSave = {
        title: file.basename,
        path: file.path,
        content: content,
        embeddingModel: EmbeddingsManager.getModelName(embeddingInstance),
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        tags: fileCache?.tags?.map((tag) => tag.tag) ?? [],
        extension: file.extension,
        metadata: {
          ...(fileCache?.frontmatter ?? {}),
          created: file.stat.ctime,
          modified: file.stat.mtime,
        },
      };

      await this.indexDocument(embeddingInstance, fileToSave);
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
