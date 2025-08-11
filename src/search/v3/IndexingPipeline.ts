import { CHUNK_SIZE } from "@/constants";
import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { getSettings } from "@/settings/model";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { TFile, App } from "obsidian";
import { RateLimiter } from "@/rateLimiter";
import { JsonlChunkRecord } from "./IndexPersistenceManager";
import { IndexingProgressTracker } from "./IndexingProgressTracker";
import { IndexingNotificationManager } from "./IndexingNotificationManager";

export interface ChunkInfo {
  text: string;
  path: string;
  title: string;
  mtime: number;
  ctime: number;
  chunkIndex: number;
}

/**
 * Shared indexing pipeline for processing files into embeddings
 */
export class IndexingPipeline {
  private static readonly DEFAULT_BATCH_SIZE = 16; // Default embedding batch size
  private static readonly MIN_BATCH_SIZE = 1; // Minimum batch size

  private splitter: RecursiveCharacterTextSplitter;
  private rateLimiter: RateLimiter;

  constructor(
    private app: App,
    private notificationManager: IndexingNotificationManager
  ) {
    this.splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: CHUNK_SIZE,
    });
    const settings = getSettings();
    this.rateLimiter = new RateLimiter(settings.embeddingRequestsPerMin);
  }

  /**
   * Process a single file into chunks
   */
  private async processFileIntoChunks(file: TFile): Promise<ChunkInfo[]> {
    const content = await this.app.vault.cachedRead(file);
    if (!content?.trim()) return [];

    const title = file.basename;
    const header = `\n\nNOTE TITLE: [[${title}]]\n\nNOTE BLOCK CONTENT:\n\n`;
    const chunks = await this.splitter.createDocuments([content], [], {
      chunkHeader: header,
      appendChunkOverlapHeader: true,
    });

    return chunks.map((chunk, index) => ({
      text: chunk.pageContent,
      path: file.path,
      title,
      mtime: file.stat.mtime,
      ctime: file.stat.ctime,
      chunkIndex: index,
    }));
  }

  /**
   * Prepare chunks for a set of files
   */
  async prepareFileChunks(
    files: TFile[]
  ): Promise<{ chunks: ChunkInfo[]; fileChunkMap: Map<string, ChunkInfo[]> }> {
    const allChunks: ChunkInfo[] = [];
    const fileChunkMap = new Map<string, ChunkInfo[]>();

    for (const file of files) {
      if (this.notificationManager.shouldCancel) break;

      const fileChunks = await this.processFileIntoChunks(file);
      if (fileChunks.length > 0) {
        allChunks.push(...fileChunks);
        fileChunkMap.set(file.path, fileChunks);
      }
    }

    return { chunks: allChunks, fileChunkMap };
  }

  /**
   * Prepare chunks for a single file
   */
  async prepareFileChunksForSingle(file: TFile): Promise<ChunkInfo[]> {
    return this.processFileIntoChunks(file);
  }

  /**
   * Process chunks in batches with embeddings
   */
  async processChunksBatched(
    chunks: ChunkInfo[],
    fileChunkMap: Map<string, ChunkInfo[]>,
    progressTracker: IndexingProgressTracker
  ): Promise<JsonlChunkRecord[]> {
    if (chunks.length === 0) return [];

    const embeddings = await EmbeddingManager.getInstance().getEmbeddingsAPI();
    const batchSize = Math.max(
      IndexingPipeline.MIN_BATCH_SIZE,
      getSettings().embeddingBatchSize || IndexingPipeline.DEFAULT_BATCH_SIZE
    );
    const records: JsonlChunkRecord[] = [];

    // Initialize progress tracking
    for (const [path, fileChunks] of fileChunkMap.entries()) {
      progressTracker.initializeFile(path, fileChunks.length);
    }

    // Process in batches
    for (let i = 0; i < chunks.length; i += batchSize) {
      if (this.notificationManager.shouldCancel) break;
      await this.notificationManager.waitIfPaused();

      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((chunk) => chunk.text);

      // Apply rate limiting
      await this.rateLimiter.wait();
      const vecs = await embeddings.embedDocuments(texts);

      vecs.forEach((embedding, j) => {
        const chunk = batch[j];
        records.push({
          id: `${chunk.path}#${chunk.chunkIndex}`,
          path: chunk.path,
          title: chunk.title,
          mtime: chunk.mtime,
          ctime: chunk.ctime,
          embedding,
        });

        // Track progress
        progressTracker.recordChunkProcessed(chunk.path);
      });

      // Update notification
      this.notificationManager.update({
        completed: progressTracker.completedCount,
        total: progressTracker.total,
      });
    }

    return records;
  }

  /**
   * Process chunks for a single file (used for incremental updates)
   */
  async processSingleFileChunks(chunks: ChunkInfo[]): Promise<JsonlChunkRecord[]> {
    if (chunks.length === 0) return [];

    const embeddings = await EmbeddingManager.getInstance().getEmbeddingsAPI();
    const batchSize = Math.max(
      IndexingPipeline.MIN_BATCH_SIZE,
      getSettings().embeddingBatchSize || IndexingPipeline.DEFAULT_BATCH_SIZE
    );
    const records: JsonlChunkRecord[] = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((chunk) => chunk.text);

      await this.rateLimiter.wait();
      const vecs = await embeddings.embedDocuments(texts);

      vecs.forEach((embedding, j) => {
        const chunk = batch[j];
        records.push({
          id: `${chunk.path}#${chunk.chunkIndex}`,
          path: chunk.path,
          title: chunk.title,
          mtime: chunk.mtime,
          ctime: chunk.ctime,
          embedding,
        });
      });
    }

    return records;
  }

  /**
   * Update rate limiter settings
   */
  updateRateLimiter(requestsPerMin: number): void {
    this.rateLimiter.setRequestsPerMin(requestsPerMin);
  }
}
