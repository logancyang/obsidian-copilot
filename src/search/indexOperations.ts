import {
  flushIndexingCount,
  getIndexingProgressState,
  resetIndexingProgressState,
  setIndexingProgressState,
  throttledUpdateIndexingCount,
  updateIndexingProgressState,
} from "@/aiParams";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { logError, logInfo, logWarn } from "@/logger";
import { RateLimiter } from "@/rateLimiter";
import { ChunkManager, getSharedChunkManager } from "@/search/v3/chunks";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { formatDateTime } from "@/utils";
import { MD5 } from "crypto-js";
import { App, Notice, TFile } from "obsidian";
import type { SemanticIndexBackend } from "./indexBackend/SemanticIndexBackend";
import { getMatchingPatterns, shouldIndexFile } from "./searchUtils";

export interface IndexingState {
  isIndexingPaused: boolean;
  isIndexingCancelled: boolean;
  indexedCount: number;
  totalFilesToIndex: number;
  processedFiles: Set<string>;
}

export class IndexOperations {
  private rateLimiter: RateLimiter;
  private checkpointInterval: number;
  private embeddingBatchSize: number;
  private chunkManager: ChunkManager;
  private state: IndexingState = {
    isIndexingPaused: false,
    isIndexingCancelled: false,
    indexedCount: 0,
    totalFilesToIndex: 0,
    processedFiles: new Set(),
  };

  constructor(
    private app: App,
    private indexBackend: SemanticIndexBackend,
    private embeddingsManager: EmbeddingsManager
  ) {
    const settings = getSettings();
    this.rateLimiter = new RateLimiter(settings.embeddingRequestsPerMin);
    this.embeddingBatchSize = settings.embeddingBatchSize;
    this.checkpointInterval = 8 * this.embeddingBatchSize;
    this.chunkManager = getSharedChunkManager(app);

    // Subscribe to settings changes
    subscribeToSettingsChange(async () => {
      const settings = getSettings();
      this.rateLimiter = new RateLimiter(settings.embeddingRequestsPerMin);
      this.embeddingBatchSize = settings.embeddingBatchSize;
      this.checkpointInterval = 8 * this.embeddingBatchSize;
    });
  }

  public async indexVaultToVectorStore(
    overwrite?: boolean,
    options?: { userInitiated?: boolean }
  ): Promise<number> {
    if (!getSettings().enableSemanticSearchV3) {
      logWarn("indexVaultToVectorStore called with semantic search disabled, skipping.");
      return 0;
    }

    const errors: string[] = [];

    // Reset any stale state from a previous run but do NOT set isActive yet —
    // the card should only appear once we confirm there is actual work to do.
    resetIndexingProgressState();

    try {
      const embeddingInstance = await this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance) {
        logError("Embedding instance not found.");
        setIndexingProgressState({
          isActive: false,
          isPaused: false,
          isCancelled: false,
          indexedCount: 0,
          totalFiles: 0,
          errors: [
            "Embedding model not available. Please check your Copilot settings to make sure you have a working embedding model.",
          ],
          completionStatus: "error",
        });
        return 0;
      }

      // Check for model change first
      const modelChanged =
        await this.indexBackend.checkAndHandleEmbeddingModelChange(embeddingInstance);
      if (modelChanged) {
        // If model changed, force a full reindex by setting overwrite to true
        overwrite = true;
      }

      // Clear index and tracking if overwrite is true
      if (overwrite) {
        await this.indexBackend.clearIndex(embeddingInstance);
        this.indexBackend.clearFilesMissingEmbeddings();
      } else {
        // Run garbage collection first to clean up stale documents
        await this.indexBackend.garbageCollect();
      }

      const files = await this.getFilesToIndex(overwrite);
      if (files.length === 0) {
        // For user-initiated actions, briefly show "Index Up to Date"
        if (options?.userInitiated) {
          updateIndexingProgressState({ completionStatus: "success" });
        }
        return 0;
      }

      this.initializeIndexingState(files.length);

      // Clear the missing embeddings list before starting new indexing
      this.indexBackend.clearFilesMissingEmbeddings();

      // New: Prepare all chunks first
      const allChunks = await this.prepareAllChunks(files);
      if (allChunks.length === 0) {
        // No valid content to index — silently reset so the card never appears
        resetIndexingProgressState();
        return 0;
      }

      // Check if user cancelled during chunk preparation
      if (this.state.isIndexingCancelled || getIndexingProgressState().isCancelled) {
        updateIndexingProgressState({ isActive: false, completionStatus: "cancelled" });
        return 0;
      }

      // Update totalFiles to reflect only files that produced chunks
      // (some files may be empty or produce no valid content after chunking)
      const filesWithChunks = new Set(allChunks.map((c) => c.fileInfo.path)).size;
      this.state.totalFilesToIndex = filesWithChunks;
      updateIndexingProgressState({ totalFiles: filesWithChunks });

      // Process chunks in batches
      for (let i = 0; i < allChunks.length; i += this.embeddingBatchSize) {
        if (this.state.isIndexingCancelled || getIndexingProgressState().isCancelled) break;
        await this.handlePause();

        const batch = allChunks.slice(i, i + this.embeddingBatchSize);
        try {
          await this.rateLimiter.wait();
          const embeddings = await embeddingInstance.embedDocuments(
            batch.map((chunk) => chunk.content)
          );

          // Validate embeddings
          if (!embeddings || embeddings.length !== batch.length) {
            throw new Error(
              `Embedding model returned ${embeddings?.length ?? 0} embeddings for ${batch.length} documents`
            );
          }

          // Save batch to database
          for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            const embedding = embeddings[j];

            // Skip documents with invalid embeddings
            if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
              logError(`Invalid embedding for document ${chunk.fileInfo.path}: ${embedding}`);
              this.indexBackend.markFileMissingEmbeddings(chunk.fileInfo.path);
              continue;
            }

            try {
              await this.indexBackend.upsert({
                ...chunk.fileInfo,
                id: this.getDocHash(chunk.content),
                content: chunk.content,
                embedding,
                created_at: Date.now(),
                nchars: chunk.content.length,
              });
              // Mark success for this file
              this.state.processedFiles.add(chunk.fileInfo.path);
            } catch (err) {
              // Log error but continue processing other documents in batch
              this.handleError(err, {
                filePath: chunk.fileInfo.path,
                errors,
              });
              this.indexBackend.markFileMissingEmbeddings(chunk.fileInfo.path);
              continue;
            }
          }

          // Update progress after the batch (throttled to reduce React re-renders)
          this.state.indexedCount = this.state.processedFiles.size;
          throttledUpdateIndexingCount(this.state.indexedCount);

          // Calculate if we've crossed a checkpoint threshold
          const previousCheckpoint = Math.floor(
            (this.state.indexedCount - batch.length) / this.checkpointInterval
          );
          const currentCheckpoint = Math.floor(this.state.indexedCount / this.checkpointInterval);

          if (currentCheckpoint > previousCheckpoint) {
            await this.indexBackend.save();
            console.log("Copilot index checkpoint save completed.");
          }
        } catch (err) {
          this.handleError(err, {
            filePath: batch?.[0]?.fileInfo?.path,
            errors,
            batch,
          });
          if (this.isRateLimitError(err)) {
            break;
          }
        }

        // Yield to main thread so the browser can process editor input events
        await this.yieldToMainThread();
      }

      // Show completion notice before running integrity check
      this.finalizeIndexing(errors);

      // Run save and integrity check with setTimeout to ensure it's non-blocking
      setTimeout(() => {
        this.indexBackend
          .save()
          .then(() => {
            logInfo("Copilot index final save completed.");
            this.indexBackend.checkIndexIntegrity().catch((err) => {
              logError("Background integrity check failed:", err);
            });
          })
          .catch((err) => {
            logError("Background save failed:", err);
          });
      }, 100); // 100ms delay

      return this.state.indexedCount;
    } catch (error) {
      this.handleError(error);
      // Ensure atom is cleared so UI doesn't stay stuck on "Indexing..."
      updateIndexingProgressState({
        isActive: false,
        completionStatus: "error",
        errors: [error instanceof Error ? error.message : String(error)],
      });
      return 0;
    }
  }

  /**
   * Prepares chunks for all files using the shared ChunkManager for consistent chunking.
   * This ensures chunk IDs (note_path#chunk_index) are identical across semantic and lexical search.
   * Processes files in batches to bypass ChunkManager's 1000-file limit for search queries.
   */
  private async prepareAllChunks(files: TFile[]): Promise<
    Array<{
      content: string;
      chunkId: string;
      fileInfo: any;
    }>
  > {
    const embeddingInstance = await this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingInstance) {
      console.error("Embedding instance not found.");
      return [];
    }
    const embeddingModel = EmbeddingsManager.getModelName(embeddingInstance);

    const allChunks: Array<{ content: string; chunkId: string; fileInfo: any }> = [];

    // Process files in batches to bypass ChunkManager's 1000-file limit
    // The limit exists to protect memory during search queries, but indexing needs all files
    const CHUNK_BATCH_SIZE = 1000;
    for (let i = 0; i < files.length; i += CHUNK_BATCH_SIZE) {
      const batch = files.slice(i, i + CHUNK_BATCH_SIZE);
      const filePaths = batch.map((f) => f.path);
      const chunks = await this.chunkManager.getChunks(filePaths);

      for (const chunk of chunks) {
        const file = this.app.vault.getAbstractFileByPath(chunk.notePath);
        if (!file || !(file instanceof TFile)) continue;

        const fileCache = this.app.metadataCache.getFileCache(file);
        const fileInfo = {
          title: chunk.title,
          path: chunk.notePath,
          embeddingModel,
          ctime: file.stat.ctime,
          mtime: chunk.mtime,
          tags: fileCache?.tags?.map((tag) => tag.tag) ?? [],
          extension: file.extension,
          metadata: {
            ...(fileCache?.frontmatter ?? {}),
            created: formatDateTime(new Date(file.stat.ctime)).display,
            modified: formatDateTime(new Date(chunk.mtime)).display,
            chunkId: chunk.id, // Store chunkId in metadata for retrieval
            heading: chunk.heading, // Store heading for context
          },
        };

        if (chunk.content.trim()) {
          // Inject metadata into chunk content for semantic search
          // ChunkManager produces: "NOTE TITLE: [[title]]\n\nNOTE BLOCK CONTENT:\n\n[content]"
          // We need to insert metadata between title and content for embeddings
          const metadataStr = `METADATA:${JSON.stringify(fileInfo.metadata)}\n\n`;
          const insertPoint = chunk.content.indexOf("NOTE BLOCK CONTENT:");
          const contentWithMetadata =
            insertPoint > 0
              ? chunk.content.slice(0, insertPoint) + metadataStr + chunk.content.slice(insertPoint)
              : chunk.content;

          allChunks.push({
            content: contentWithMetadata,
            chunkId: chunk.id,
            fileInfo,
          });
        }
      }

      // Yield to main thread between chunk preparation batches
      await this.yieldToMainThread();
    }

    return allChunks;
  }

  /**
   * Yields to the main thread so the browser can process pending input events and re-renders.
   */
  private yieldToMainThread(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private getDocHash(sourceDocument: string): string {
    return MD5(sourceDocument).toString();
  }

  private async getFilesToIndex(overwrite?: boolean): Promise<TFile[]> {
    const { inclusions, exclusions } = getMatchingPatterns();
    const allMarkdownFiles = this.app.vault.getMarkdownFiles();

    // If overwrite is true, return all markdown files that match current filters
    if (overwrite) {
      return allMarkdownFiles.filter((file) => {
        return shouldIndexFile(file, inclusions, exclusions);
      });
    }

    // Get currently indexed files and latest mtime
    const indexedFilePaths = new Set(await this.indexBackend.getIndexedFiles());
    const latestMtime = await this.indexBackend.getLatestFileMtime();
    const filesMissingEmbeddings = new Set(this.indexBackend.getFilesMissingEmbeddings());

    // Get all markdown files that should be indexed under current rules
    const filesToIndex = new Set<TFile>();
    const emptyFiles = new Set<string>();

    for (const file of allMarkdownFiles) {
      if (!shouldIndexFile(file, inclusions, exclusions)) {
        continue;
      }

      // Check actual content
      const content = await this.app.vault.cachedRead(file);
      if (!content || content.trim().length === 0) {
        emptyFiles.add(file.path);
        continue;
      }

      const isIndexed = indexedFilePaths.has(file.path);
      const needsEmbeddings = filesMissingEmbeddings.has(file.path);

      if (!isIndexed || needsEmbeddings || file.stat.mtime > latestMtime) {
        filesToIndex.add(file);
      }
    }

    logInfo(
      [
        `Files to index: ${filesToIndex.size}`,
        `Previously indexed: ${indexedFilePaths.size}`,
        `Empty files skipped: ${emptyFiles.size}`,
        `Files missing embeddings: ${filesMissingEmbeddings.size}`,
      ].join("\n")
    );

    return Array.from(filesToIndex);
  }

  private initializeIndexingState(totalFiles: number) {
    this.state = {
      isIndexingPaused: false,
      isIndexingCancelled: false,
      indexedCount: 0,
      totalFilesToIndex: totalFiles,
      processedFiles: new Set(),
    };
    setIndexingProgressState({
      isActive: true,
      isPaused: false,
      isCancelled: false,
      indexedCount: 0,
      totalFiles,
      errors: [],
      completionStatus: "none",
    });
  }

  private async handlePause(): Promise<void> {
    // Sync pause state from atom (UI may have toggled it)
    const atomState = getIndexingProgressState();
    this.state.isIndexingPaused = atomState.isPaused;
    this.state.isIndexingCancelled = atomState.isCancelled;

    if (this.state.isIndexingPaused) {
      while (this.state.isIndexingPaused && !this.state.isIndexingCancelled) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Re-read atom state each iteration
        const current = getIndexingProgressState();
        this.state.isIndexingPaused = current.isPaused;
        this.state.isIndexingCancelled = current.isCancelled;
      }

      // After we exit the pause loop (meaning we've resumed), re-evaluate files
      if (!this.state.isIndexingCancelled) {
        const files = await this.getFilesToIndex();
        if (files.length === 0) {
          logInfo("No files to index after filter change, stopping indexing");
          this.cancelIndexing();
          return;
        }
        this.state.totalFilesToIndex = files.length;
        updateIndexingProgressState({ totalFiles: files.length });
      }
    }
  }

  private isStringLengthError(error: any): boolean {
    if (!error) return false;

    // Check if it's a direct RangeError
    if (error instanceof RangeError && error.message.toLowerCase().includes("string length")) {
      return true;
    }

    // Check the error message at any depth
    const message = error.message || error.toString();
    const lowerMessage = message.toLowerCase();
    return lowerMessage.includes("string length") || lowerMessage.includes("rangeerror");
  }

  private handleError(
    error: any,
    context?: {
      filePath?: string;
      errors?: string[];
      batch?: Array<{ content: string; fileInfo: any }>;
    }
  ): void {
    const filePath = context?.filePath;

    // Log the error with appropriate context
    if (filePath) {
      if (context.batch) {
        // Detailed batch processing error logging
        console.error("Batch processing error:", {
          error,
          batchSize: context.batch.length || 0,
          firstChunk: context.batch[0]
            ? {
                path: context.batch[0].fileInfo?.path,
                contentLength: context.batch[0].content?.length,
                hasFileInfo: !!context.batch[0].fileInfo,
              }
            : "No chunks in batch",
          errorType: error?.constructor?.name,
          errorMessage: error?.message,
        });
      } else {
        console.error(`Error indexing file ${filePath}:`, error);
      }
      context.errors?.push(filePath);
    } else {
      console.error("Fatal error during indexing:", error);
    }

    // Handle json stringify string length error consistently
    if (this.isStringLengthError(error)) {
      new Notice(
        "Vault is too large for 1 partition, please increase the number of partitions in your Copilot QA settings!",
        10000 // Show for 10 seconds
      );
      return;
    }

    // Show appropriate error notice
    if (this.isRateLimitError(error)) {
      return; // Don't show duplicate notices for rate limit errors
    }

    const message = filePath
      ? `Error indexing file ${filePath}. Check console for details.`
      : "Fatal error during indexing. Check console for details.";
    new Notice(message);
  }

  private isRateLimitError(err: any): boolean {
    return err?.message?.includes?.("rate limit") || false;
  }

  private finalizeIndexing(errors: string[]): void {
    // Flush any pending throttled count so the final value is displayed
    flushIndexingCount();

    if (this.state.isIndexingCancelled || getIndexingProgressState().isCancelled) {
      updateIndexingProgressState({
        isActive: false,
        completionStatus: "cancelled",
        errors,
      });
      return;
    }

    updateIndexingProgressState({
      isActive: false,
      completionStatus: errors.length > 0 ? "error" : "success",
      errors,
      indexedCount: this.state.indexedCount,
    });
  }

  public async reindexFile(file: TFile): Promise<void> {
    try {
      const embeddingInstance = await this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance) {
        return;
      }

      await this.indexBackend.removeByPath(file.path);

      // Check for model change
      const modelChanged =
        await this.indexBackend.checkAndHandleEmbeddingModelChange(embeddingInstance);
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
        await this.indexBackend.upsert({
          ...chunk.fileInfo,
          id: this.getDocHash(chunk.content),
          content: chunk.content,
          embedding: embeddings[i],
          created_at: Date.now(),
          nchars: chunk.content.length,
        });
      }

      // Mark that we have unsaved changes instead of saving immediately
      this.indexBackend.markUnsavedChanges();

      if (getSettings().debug) {
        console.log(`Reindexed file: ${file.path}`);
      }
    } catch (error) {
      this.handleError(error, { filePath: file.path });
    }
  }

  public async cancelIndexing(): Promise<void> {
    logInfo("Indexing cancelled by user");
    this.state.isIndexingCancelled = true;
    updateIndexingProgressState({
      isCancelled: true,
      isActive: false,
      completionStatus: "cancelled",
    });

    // Add a small delay to ensure all state updates are processed
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
