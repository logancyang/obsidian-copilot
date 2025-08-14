import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { logError, logInfo, logWarn } from "@/logger";
import { RateLimiter } from "@/rateLimiter";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";
import { Document as LCDocument } from "@langchain/core/documents";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { App } from "obsidian";

import { IndexingNotificationManager } from "./IndexingNotificationManager";
import { IndexingPipeline } from "./IndexingPipeline";
import { IndexingProgressTracker } from "./IndexingProgressTracker";
import { IndexPersistenceManager, JsonlChunkRecord } from "./IndexPersistenceManager";

/**
 * MemoryIndexManager with separated concerns
 * - Persistence handled by IndexPersistenceManager
 * - UI notifications handled by IndexingNotificationManager
 * - Progress tracking handled by IndexingProgressTracker
 * - Shared indexing logic handled by IndexingPipeline
 */
export class MemoryIndexManager {
  // Constants
  private static readonly VECTOR_STORE_BATCH_SIZE = 1000; // Process vectors in batches to reduce memory
  private static readonly SEARCH_K_MULTIPLIER = 3; // Multiplier for initial search results
  private static readonly SEARCH_MIN_K = 100; // Minimum k for similarity search
  private static readonly SCORE_AGGREGATION_TOP_K = 3; // Number of top scores to average per note
  private static readonly SCORE_NORMALIZATION_EPSILON = 1e-6; // Epsilon for score normalization

  private static instance: MemoryIndexManager;
  private loaded = false;
  private records: JsonlChunkRecord[] = [];
  private vectorStore: MemoryVectorStore | null = null;
  private rateLimiter: RateLimiter;

  // Helper managers
  private persistenceManager: IndexPersistenceManager;
  private notificationManager: IndexingNotificationManager;
  private indexingPipeline: IndexingPipeline;

  private constructor(private app: App) {
    const settings = getSettings();
    this.rateLimiter = new RateLimiter(settings.embeddingRequestsPerMin);

    // Initialize helper managers
    this.persistenceManager = new IndexPersistenceManager(app);
    this.notificationManager = new IndexingNotificationManager(app);
    this.indexingPipeline = new IndexingPipeline(app, this.notificationManager);
  }

  static getInstance(app: App): MemoryIndexManager {
    if (!MemoryIndexManager.instance) {
      MemoryIndexManager.instance = new MemoryIndexManager(app);
    }
    // Update rate limiter if settings changed
    const settings = getSettings();
    MemoryIndexManager.instance.rateLimiter.setRequestsPerMin(settings.embeddingRequestsPerMin);
    MemoryIndexManager.instance.indexingPipeline.updateRateLimiter(
      settings.embeddingRequestsPerMin
    );
    return MemoryIndexManager.instance;
  }

  /**
   * Testing utility to clear the singleton and state between tests
   */
  static __resetForTests(): void {
    MemoryIndexManager.instance = undefined as unknown as MemoryIndexManager;
  }

  /**
   * Load index from persistence
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      this.records = await this.persistenceManager.readRecords();
      if (this.records.length === 0) {
        logInfo(
          "MemoryIndex: No JSONL index found; semantic retrieval will be empty until indexed."
        );
      } else {
        await this.buildVectorStore();
        logInfo(`MemoryIndex: Loaded ${this.records.length} chunks from JSONL.`);
      }
      this.loaded = true;
    } catch (error) {
      logError("MemoryIndex: Failed to load index", error);
      this.loaded = true;
    }
  }

  /**
   * Attempt to load the JSONL index without logging warnings when it doesn't exist
   */
  async loadIfExists(): Promise<boolean> {
    if (this.loaded && this.records.length > 0) return true;
    try {
      const hasIndex = await this.persistenceManager.hasIndex();
      if (!hasIndex) {
        this.loaded = true;
        return false;
      }

      this.records = await this.persistenceManager.readRecords();
      if (this.records.length > 0) {
        await this.buildVectorStore();
      }
      this.loaded = true;
      return true;
    } catch {
      this.loaded = true;
      return false;
    }
  }

  /**
   * Whether an index is available in memory
   */
  isAvailable(): boolean {
    return this.records.length > 0;
  }

  /**
   * Build vector store from loaded records
   */
  private async buildVectorStore(): Promise<void> {
    try {
      const embeddings = await EmbeddingManager.getInstance().getEmbeddingsAPI();
      const store = new MemoryVectorStore(embeddings);

      // Process in batches to reduce memory footprint
      const batchSize = MemoryIndexManager.VECTOR_STORE_BATCH_SIZE;
      for (let i = 0; i < this.records.length; i += batchSize) {
        const batch = this.records.slice(i, i + batchSize);
        const docs = batch.map(
          (rec) =>
            new LCDocument({
              pageContent: rec.title || "",
              metadata: { id: rec.id, path: rec.path },
            })
        );
        const vectors = batch.map((rec) => rec.embedding);
        await store.addVectors(vectors, docs);
      }

      this.vectorStore = store;
    } catch (error) {
      logWarn("MemoryIndex: Failed to build vector store from JSONL; semantic disabled", error);
      this.vectorStore = null;
    }
  }

  /**
   * Search for similar documents
   */
  async search(
    queryVariants: string[],
    maxK: number,
    candidates?: string[]
  ): Promise<Array<{ id: string; score: number }>> {
    await this.ensureLoaded();
    if (this.records.length === 0 || queryVariants.length === 0 || !this.vectorStore) return [];

    const embeddings = await EmbeddingManager.getInstance().getEmbeddingsAPI();
    const variantVectors: number[][] = [];

    for (const q of queryVariants) {
      try {
        await this.rateLimiter.wait();
        variantVectors.push(await embeddings.embedQuery(q));
      } catch (error) {
        logWarn("MemoryIndex: query embedding failed", error);
      }
    }

    if (variantVectors.length === 0) return [];

    const noteToScores = new Map<string, number[]>();
    const candidateSet = candidates && candidates.length > 0 ? new Set(candidates) : null;

    // Log candidate restriction for verification
    if (candidateSet) {
      logInfo(`MemoryIndex: Restricting semantic search to ${candidateSet.size} candidates`);
    } else {
      logInfo("MemoryIndex: No candidate restriction (searching entire index)");
    }

    const kPerQuery = Math.min(
      this.records.length,
      Math.max(maxK * MemoryIndexManager.SEARCH_K_MULTIPLIER, MemoryIndexManager.SEARCH_MIN_K)
    );

    let totalSkipped = 0;
    let totalIncluded = 0;

    for (const qv of variantVectors) {
      const results = await this.vectorStore.similaritySearchVectorWithScore(qv, kPerQuery);
      for (const [doc, score] of results) {
        const path = (doc.metadata as any)?.path as string;
        if (candidateSet && !candidateSet.has(path)) {
          totalSkipped++;
          continue;
        }
        totalIncluded++;
        const normalized = Math.max(0, Math.min(1, typeof score === "number" ? score : 0));
        const arr = noteToScores.get(path) ?? [];
        arr.push(normalized);
        noteToScores.set(path, arr);
      }
    }

    // Log filtering statistics
    if (candidateSet) {
      logInfo(
        `MemoryIndex: Included ${totalIncluded} results, filtered out ${totalSkipped} non-candidates`
      );
    }

    // Aggregate scores per note
    const aggregated = this.aggregateScores(noteToScores);

    // Optional score normalization
    if (aggregated.length > 1) {
      this.normalizeScores(aggregated);
    }

    return aggregated.sort((a, b) => b.score - a.score).slice(0, maxK);
  }

  /**
   * Aggregate multiple scores per note
   */
  private aggregateScores(
    noteToScores: Map<string, number[]>
  ): Array<{ id: string; score: number }> {
    const aggregated: Array<{ id: string; score: number }> = [];

    for (const [id, arr] of noteToScores.entries()) {
      arr.sort((a, b) => b - a);
      const top = arr.slice(0, Math.min(MemoryIndexManager.SCORE_AGGREGATION_TOP_K, arr.length));
      const avg = top.reduce((s, v) => s + v, 0) / top.length;
      aggregated.push({ id, score: avg });
    }

    return aggregated;
  }

  /**
   * Normalize scores to spread them out
   */
  private normalizeScores(scores: Array<{ id: string; score: number }>): void {
    let min = Infinity;
    let max = -Infinity;

    for (const s of scores) {
      if (s.score < min) min = s.score;
      if (s.score > max) max = s.score;
    }

    const range = max - min;
    if (range > MemoryIndexManager.SCORE_NORMALIZATION_EPSILON) {
      for (const s of scores) {
        s.score = (s.score - min) / range;
      }
    }
  }

  /**
   * Full vault indexing
   */
  async indexVault(): Promise<number> {
    try {
      const { inclusions, exclusions } = getMatchingPatterns();
      const files = this.app.vault
        .getMarkdownFiles()
        .filter((f) => shouldIndexFile(f, inclusions, exclusions));

      if (files.length === 0) return 0;

      // Show notification
      this.notificationManager.show(files.length);

      // Create progress tracker
      const progressTracker = new IndexingProgressTracker(files.length);

      // Prepare chunks
      const { chunks, fileChunkMap } = await this.indexingPipeline.prepareFileChunks(files);

      if (chunks.length === 0 || this.notificationManager.shouldCancel) {
        this.notificationManager.finalize(0);
        return 0;
      }

      // Process chunks
      const records = await this.indexingPipeline.processChunksBatched(
        chunks,
        fileChunkMap,
        progressTracker
      );

      if (this.notificationManager.shouldCancel) {
        this.notificationManager.finalize(0);
        return 0;
      }

      // Persist
      await this.persistenceManager.writeRecords(records);
      this.loaded = false; // force reload

      const processedCount = fileChunkMap.size;
      logInfo(`MemoryIndex: Indexed ${records.length} chunks from ${processedCount} files`);
      this.notificationManager.finalize(processedCount);

      return processedCount;
    } catch (error) {
      logError("MemoryIndex: indexVault failed", error);
      this.notificationManager.hide();
      return 0;
    }
  }

  /**
   * Incremental vault indexing
   */
  async indexVaultIncremental(): Promise<number> {
    // If no existing index, do a full build
    const existed = await this.loadIfExists();
    if (!existed) {
      return this.indexVault();
    }

    try {
      const { inclusions, exclusions } = getMatchingPatterns();
      const files = this.app.vault
        .getMarkdownFiles()
        .filter((f) => shouldIndexFile(f, inclusions, exclusions));

      // Compute what needs updating
      const { toUpdate, toRemove } = this.computeIncrementalWork(files);

      if (toRemove.size === 0 && toUpdate.length === 0) {
        logInfo("MemoryIndex: Incremental index up-to-date; no changes");
        return 0;
      }

      // Show notification
      this.notificationManager.show(toUpdate.length);

      // Create progress tracker
      const progressTracker = new IndexingProgressTracker(toUpdate.length);

      // Keep records that don't need updating
      const keptRecords = this.records.filter(
        (r) => !toRemove.has(r.path) && !toUpdate.some((u) => u.file.path === r.path)
      );

      // Prepare chunks for files to update
      const filesToUpdate = toUpdate.map((u) => u.file);
      const { chunks, fileChunkMap } = await this.indexingPipeline.prepareFileChunks(filesToUpdate);

      if (this.notificationManager.shouldCancel) {
        this.notificationManager.finalize(0);
        return 0;
      }

      // Process new chunks
      const newRecords = await this.indexingPipeline.processChunksBatched(
        chunks,
        fileChunkMap,
        progressTracker
      );

      if (this.notificationManager.shouldCancel) {
        this.notificationManager.finalize(0);
        return 0;
      }

      // Combine and persist
      const combined = [...keptRecords, ...newRecords];
      await this.persistenceManager.writeRecords(combined);

      this.loaded = false;
      this.records = combined;

      const processedCount = fileChunkMap.size;
      logInfo(
        `MemoryIndex: Incremental complete; removed ${toRemove.size}, updated ${processedCount}, total chunks: ${combined.length}`
      );
      this.notificationManager.finalize(processedCount);

      return processedCount;
    } catch (error) {
      logError("MemoryIndex: incremental index failed", error);
      this.notificationManager.hide();
      return 0;
    }
  }

  /**
   * Compute what needs to be updated in incremental indexing
   */
  private computeIncrementalWork(files: any[]): {
    toUpdate: Array<{ file: any; reason: "new" | "modified" }>;
    toRemove: Set<string>;
  } {
    const allowedPaths = new Set(files.map((f) => f.path));
    const indexedPaths = new Set(this.records.map((r) => r.path));

    // Map path -> max mtime in index
    const pathToIndexedMtime = new Map<string, number>();
    for (const rec of this.records) {
      const prev = pathToIndexedMtime.get(rec.path) ?? 0;
      if (rec.mtime > prev) pathToIndexedMtime.set(rec.path, rec.mtime);
    }

    // Files to remove
    const toRemove = new Set<string>();
    for (const p of indexedPaths) {
      if (!allowedPaths.has(p)) toRemove.add(p);
    }

    // Files to update
    const toUpdate: Array<{ file: any; reason: "new" | "modified" }> = [];
    for (const file of files) {
      const indexedMtime = pathToIndexedMtime.get(file.path);
      if (indexedMtime == null) {
        toUpdate.push({ file, reason: "new" });
      } else if (file.stat.mtime > indexedMtime) {
        toUpdate.push({ file, reason: "modified" });
      }
    }

    return { toUpdate, toRemove };
  }

  /**
   * Reindex a single modified file
   */
  async reindexSingleFileIfModified(file: any, previousMtime: number | null): Promise<void> {
    const existed = await this.loadIfExists();
    if (!existed) return;

    try {
      if (!file || file.extension !== "md") return;

      const indexedMtime = Math.max(
        0,
        ...this.records.filter((r) => r.path === file.path).map((r) => r.mtime)
      );

      const prev = previousMtime ?? indexedMtime;
      if (!file.stat?.mtime || file.stat.mtime <= prev) {
        return; // not modified
      }

      // Prepare and process chunks for single file
      const chunks = await this.indexingPipeline.prepareFileChunksForSingle(file);
      const newRecords = await this.indexingPipeline.processSingleFileChunks(chunks);

      // Remove old records for this file
      this.records = this.records.filter((r) => r.path !== file.path);

      // Add new records
      this.records.push(...newRecords);

      // Persist
      await this.persistenceManager.writeRecords(this.records);
      this.loaded = false; // force rebuild of vector store

      logInfo(`MemoryIndex: Reindexed modified file ${file.path} with ${newRecords.length} chunks`);
    } catch (error) {
      logWarn("MemoryIndex: reindexSingleFileIfModified failed", error);
    }
  }

  // Public API methods

  /**
   * Get all indexed file paths
   * @returns Array of file paths that are currently indexed
   */
  public getIndexedPaths(): string[] {
    const paths = new Set<string>();
    for (const record of this.records) {
      if (record?.path) {
        paths.add(record.path);
      }
    }
    return Array.from(paths);
  }

  /**
   * Check if a specific file is indexed
   * @param path The file path to check
   * @returns true if the file is indexed
   */
  public hasFile(path: string): boolean {
    return this.records.some((r) => r?.path === path);
  }

  /**
   * Get embeddings for a specific file
   * @param path The file path
   * @returns Array of embeddings for the file's chunks
   */
  public getFileEmbeddings(path: string): number[][] {
    return this.records.filter((r) => r?.path === path).map((r) => r.embedding);
  }

  /**
   * Clear the index
   */
  public clearIndex(): void {
    this.loaded = false;
    this.records = [];
    this.vectorStore = null;
    this.notificationManager.reset();
  }

  /**
   * Get the underlying vector store for similarity search
   * @returns The vector store or null if not loaded
   */
  public getVectorStore(): MemoryVectorStore | null {
    return this.vectorStore;
  }
}
