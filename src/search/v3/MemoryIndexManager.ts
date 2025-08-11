import { CHUNK_SIZE } from "@/constants";
import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { logError, logInfo, logWarn } from "@/logger";
import { RateLimiter } from "@/rateLimiter";
import {
  extractAppIgnoreSettings,
  getDecodedPatterns,
  getMatchingPatterns,
  shouldIndexFile,
} from "@/search/searchUtils";
import { getSettings } from "@/settings/model";
import { Document as LCDocument } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { App, Notice } from "obsidian";

interface JsonlChunkRecord {
  id: string; // stable chunk id (hashable)
  path: string; // note path
  title: string;
  mtime: number;
  ctime: number;
  embedding: number[]; // precomputed embedding
}

/**
 * In-memory vector index with JSONL persistence (prefix: copilot-index-v3).
 * - Build: Chunk notes, embed chunks in batches, write one JSON line per chunk
 * - Load: Read JSONL into memory at startup or on first use
 * - Search: Linear cosine scan over precomputed vectors; aggregate per note via max
 */
export class MemoryIndexManager {
  private static instance: MemoryIndexManager;
  private loaded = false;
  private records: JsonlChunkRecord[] = [];
  private vectorStore: MemoryVectorStore | null = null;
  private currentIndexingNotice: Notice | null = null;
  private indexNoticeMessage: HTMLDivElement | null = null;
  private isIndexingPaused: boolean = false;
  private isIndexingCancelled: boolean = false;
  private indexedCount: number = 0;
  private totalFilesToIndex: number = 0;
  private rateLimiter: RateLimiter;

  private constructor(private app: App) {
    const settings = getSettings();
    this.rateLimiter = new RateLimiter(settings.embeddingRequestsPerMin);
  }

  static getInstance(app: App): MemoryIndexManager {
    if (!MemoryIndexManager.instance) {
      MemoryIndexManager.instance = new MemoryIndexManager(app);
    }
    // Update rate limiter if settings changed
    const settings = getSettings();
    MemoryIndexManager.instance.rateLimiter.setRequestsPerMin(settings.embeddingRequestsPerMin);
    return MemoryIndexManager.instance;
  }

  /**
   * Testing utility to clear the singleton and state between tests.
   */
  static __resetForTests(): void {
    MemoryIndexManager.instance = undefined as unknown as MemoryIndexManager;
  }

  private async getIndexBase(): Promise<string> {
    const baseDir = getSettings().enableIndexSync
      ? this.app.vault.configDir // sync via .obsidian
      : ".copilot"; // store at vault root under .copilot
    // When not syncing, ensure folder exists at vault root
    try {
      // @ts-ignore
      const exists = await this.app.vault.adapter.exists(baseDir);
      if (!exists) {
        // @ts-ignore
        await this.app.vault.adapter.mkdir(baseDir);
      }
    } catch {
      // ignore
    }
    return `${baseDir}/copilot-index-v3`;
  }

  private async getLegacyIndexPath(): Promise<string> {
    const baseDir = this.app.vault.configDir;
    return `${baseDir}/copilot-index-v3.jsonl`;
  }

  private async getPartitionPath(index: number): Promise<string> {
    const base = await this.getIndexBase();
    const suffix = index.toString().padStart(3, "0");
    return `${base}-${suffix}.jsonl`;
  }

  private async getExistingPartitionPaths(): Promise<string[]> {
    const paths: string[] = [];
    // Scan 0..999 for existing partitions
    for (let i = 0; i < 1000; i++) {
      const p = await this.getPartitionPath(i);
      // @ts-ignore
      // Obsidian adapter.exists returns boolean
      if (await this.app.vault.adapter.exists(p)) {
        paths.push(p);
      } else {
        break;
      }
    }
    // Fallback to legacy single-file path
    if (paths.length === 0) {
      const legacy = await this.getLegacyIndexPath();
      if (await this.app.vault.adapter.exists(legacy)) {
        paths.push(legacy);
      }
    }
    return paths;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const paths = await this.getExistingPartitionPaths();
      if (paths.length === 0) {
        logInfo(
          "MemoryIndex: No JSONL index found; semantic retrieval will be empty until indexed."
        );
        this.loaded = true;
        return;
      }
      const allLines: string[] = [];
      for (const p of paths) {
        const content = await this.app.vault.adapter.read(p);
        const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        allLines.push(...lines);
      }
      this.records = allLines.map((l) => JSON.parse(l) as JsonlChunkRecord);
      await this.buildVectorStore();
      this.loaded = true;
      logInfo(`MemoryIndex: Loaded ${this.records.length} chunks from JSONL.`);
    } catch (error) {
      logError("MemoryIndex: Failed to load index", error);
      this.loaded = true;
    }
  }

  /**
   * Attempt to load the JSONL index without logging warnings when it doesn't exist.
   * Returns true if index was found and loaded, false otherwise.
   */
  async loadIfExists(): Promise<boolean> {
    if (this.loaded && this.records.length > 0) return true;
    try {
      const paths = await this.getExistingPartitionPaths();
      if (paths.length === 0) {
        this.loaded = true;
        return false;
      }
      const allLines: string[] = [];
      for (const p of paths) {
        const content = await this.app.vault.adapter.read(p);
        const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        allLines.push(...lines);
      }
      this.records = allLines.map((l) => JSON.parse(l) as JsonlChunkRecord);
      await this.buildVectorStore();
      this.loaded = true;
      return true;
    } catch {
      // On errors, mark loaded to avoid repeated attempts and return false
      this.loaded = true;
      return false;
    }
  }

  /**
   * Whether an index is available in memory (non-empty records array).
   */
  isAvailable(): boolean {
    return this.records.length > 0;
  }

  private async buildVectorStore(): Promise<void> {
    try {
      const embeddings = await EmbeddingManager.getInstance().getEmbeddingsAPI();
      const docs: LCDocument[] = this.records.map(
        (rec) =>
          new LCDocument({ pageContent: rec.title || "", metadata: { id: rec.id, path: rec.path } })
      );
      const vectors = this.records.map((rec) => rec.embedding);
      const store = new MemoryVectorStore(embeddings);
      await store.addVectors(vectors, docs);
      this.vectorStore = store;
    } catch (error) {
      logWarn("MemoryIndex: Failed to build vector store from JSONL; semantic disabled", error);
      this.vectorStore = null;
    }
  }

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
        // Apply rate limiting before each query embedding
        await this.rateLimiter.wait();
        variantVectors.push(await embeddings.embedQuery(q));
      } catch (error) {
        logWarn("MemoryIndex: query embedding failed", error);
      }
    }
    if (variantVectors.length === 0) return [];

    const noteToScores = new Map<string, number[]>();
    const candidateSet = candidates && candidates.length > 0 ? new Set(candidates) : null;
    const kPerQuery = Math.min(this.records.length, Math.max(maxK * 3, 100));
    for (const qv of variantVectors) {
      const results = await this.vectorStore.similaritySearchVectorWithScore(qv, kPerQuery);
      for (const [doc, score] of results) {
        const path = (doc.metadata as any)?.path as string;
        if (candidateSet && !candidateSet.has(path)) continue;
        // MemoryVectorStore returns cosine similarity in [0,1] where higher is better
        const normalized = Math.max(0, Math.min(1, typeof score === "number" ? score : 0));
        const arr = noteToScores.get(path) ?? [];
        arr.push(normalized);
        noteToScores.set(path, arr);
      }
    }

    // Aggregate per note: average of top 3 scores to reduce single-chunk spikes
    const aggregated: Array<{ id: string; score: number }> = [];
    for (const [id, arr] of noteToScores.entries()) {
      arr.sort((a, b) => b - a);
      const top = arr.slice(0, Math.min(3, arr.length));
      const avg = top.reduce((s, v) => s + v, 0) / top.length;
      aggregated.push({ id, score: avg });
    }

    // Optional per-query min-max scaling to spread scores away from 1.0
    if (aggregated.length > 1) {
      let min = Infinity;
      let max = -Infinity;
      for (const a of aggregated) {
        if (a.score < min) min = a.score;
        if (a.score > max) max = a.score;
      }
      const range = max - min;
      if (range > 1e-6) {
        for (const a of aggregated) {
          a.score = (a.score - min) / range;
        }
      }
    }

    return aggregated.sort((a, b) => b.score - a.score).slice(0, maxK);
  }

  /**
   * Rebuild the JSONL index using existing chunking logic and EmbeddingManager.
   * Writes one JSON object per line with precomputed embeddings.
   */
  async indexVault(): Promise<number> {
    try {
      const { inclusions, exclusions } = getMatchingPatterns();
      const files = this.app.vault
        .getMarkdownFiles()
        .filter((f) => shouldIndexFile(f, inclusions, exclusions));

      if (files.length === 0) return 0;

      this.totalFilesToIndex = files.length;
      this.indexedCount = 0;
      this.isIndexingPaused = false;
      this.isIndexingCancelled = false;
      this.createIndexingNotice(files.length);

      const embeddings = await EmbeddingManager.getInstance().getEmbeddingsAPI();
      const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
        chunkSize: CHUNK_SIZE,
      });

      // Step 1: Prepare ALL chunks first (like old implementation)
      interface ChunkInfo {
        text: string;
        path: string;
        title: string;
        mtime: number;
        ctime: number;
        chunkIndex: number;
      }

      const allChunks: ChunkInfo[] = [];
      const processedFiles = new Set<string>();

      for (const file of files) {
        if (this.isIndexingCancelled) break;
        const content = await this.app.vault.cachedRead(file);
        if (!content?.trim()) continue;

        const title = file.basename;
        const header = `\n\nNOTE TITLE: [[${title}]]\n\nNOTE BLOCK CONTENT:\n\n`;
        const chunks = await splitter.createDocuments([content], [], {
          chunkHeader: header,
          appendChunkOverlapHeader: true,
        });

        chunks.forEach((chunk, index) => {
          allChunks.push({
            text: chunk.pageContent,
            path: file.path,
            title,
            mtime: file.stat.mtime,
            ctime: file.stat.ctime,
            chunkIndex: index,
          });
        });

        processedFiles.add(file.path);
      }

      if (allChunks.length === 0) {
        this.finalizeIndexingNotice(0);
        return 0;
      }

      // Step 2: Process chunks in batches with rate limiting
      const lines: string[] = [];
      const batchSize = Math.max(1, getSettings().embeddingBatchSize || 16);
      let processedChunks = 0;

      for (let i = 0; i < allChunks.length; i += batchSize) {
        if (this.isIndexingCancelled) break;
        await this.handlePause();

        const batch = allChunks.slice(i, i + batchSize);
        const texts = batch.map((chunk) => chunk.text);

        // Apply rate limiting ONCE per batch (not per file)
        await this.rateLimiter.wait();
        const vecs = await embeddings.embedDocuments(texts);

        vecs.forEach((embedding, j) => {
          const chunk = batch[j];
          const rec: JsonlChunkRecord = {
            id: `${chunk.path}#${chunk.chunkIndex}`,
            path: chunk.path,
            title: chunk.title,
            mtime: chunk.mtime,
            ctime: chunk.ctime,
            embedding,
          };
          lines.push(JSON.stringify(rec));
        });

        processedChunks += batch.length;
        // Update progress based on chunks processed but show file count
        this.indexedCount = Math.floor((processedChunks / allChunks.length) * processedFiles.size);
        this.updateIndexingNoticeMessage();
      }

      await this.writePartitions(lines);
      this.loaded = false; // force reload on next ensureLoaded()
      logInfo(`MemoryIndex: Indexed ${lines.length} chunks from ${processedFiles.size} files`);
      this.finalizeIndexingNotice(processedFiles.size);
      return processedFiles.size; // Return file count, not chunk count
    } catch (error) {
      logError("MemoryIndex: indexVault failed", error);
      this.hideIndexingNotice();
      return 0;
    }
  }

  /**
   * Incrementally update the JSONL index by re-indexing only new/modified files
   * and removing deleted/excluded files. If no prior index exists, performs a
   * full index build.
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

      // Build set of allowed paths and current indexed paths
      const allowedPaths = new Set(files.map((f) => f.path));
      const indexedPaths = new Set(this.records.map((r) => r.path));

      // Map path -> max mtime recorded in index
      const pathToIndexedMtime = new Map<string, number>();
      for (const rec of this.records) {
        const prev = pathToIndexedMtime.get(rec.path) ?? 0;
        if (rec.mtime > prev) pathToIndexedMtime.set(rec.path, rec.mtime);
      }

      // Compute work sets
      const toRemove = new Set<string>();
      for (const p of indexedPaths) {
        if (!allowedPaths.has(p)) toRemove.add(p);
      }

      const toUpdate: { file: any; reason: "new" | "modified" }[] = [];
      for (const file of files) {
        const indexedMtime = pathToIndexedMtime.get(file.path);
        if (indexedMtime == null) {
          toUpdate.push({ file, reason: "new" });
        } else if (file.stat.mtime > indexedMtime) {
          toUpdate.push({ file, reason: "modified" });
        }
      }

      if (toRemove.size === 0 && toUpdate.length === 0) {
        logInfo("MemoryIndex: Incremental index up-to-date; no changes");
        return 0;
      }

      // Prepare embedding and splitter
      const embeddings = await EmbeddingManager.getInstance().getEmbeddingsAPI();
      const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
        chunkSize: CHUNK_SIZE,
      });
      {
        this.totalFilesToIndex = toUpdate.length;
        this.indexedCount = 0;
        this.isIndexingPaused = false;
        this.isIndexingCancelled = false;
        this.createIndexingNotice(toUpdate.length);
      }

      // Helper to prepare chunks for a file (without embedding)
      interface ChunkInfo {
        text: string;
        path: string;
        title: string;
        mtime: number;
        ctime: number;
        chunkIndex: number;
      }

      const prepareChunksForFile = async (file: any): Promise<ChunkInfo[]> => {
        const content = await this.app.vault.cachedRead(file);
        if (!content?.trim()) return [];
        const title = file.basename;
        const header = `\n\nNOTE TITLE: [[${title}]]\n\nNOTE BLOCK CONTENT:\n\n`;
        const chunks = await splitter.createDocuments([content], [], {
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
      };

      // Build set of paths to remove for efficient lookup
      const removedOrUpdated = new Set<string>([...toRemove, ...toUpdate.map((u) => u.file.path)]);

      // Filter existing records more efficiently
      const keptRecords: JsonlChunkRecord[] = [];
      for (const record of this.records) {
        if (!removedOrUpdated.has(record.path)) {
          keptRecords.push(record);
        }
      }

      // Step 1: Prepare all chunks for files that need updating
      const allNewChunks: ChunkInfo[] = [];
      const processedFiles = new Set<string>();

      for (const { file } of toUpdate) {
        if (this.isIndexingCancelled) break;
        const chunks = await prepareChunksForFile(file);
        if (chunks.length > 0) {
          allNewChunks.push(...chunks);
          processedFiles.add(file.path);
        }
      }

      // Step 2: Process all new chunks in batches with rate limiting
      const newRecords: JsonlChunkRecord[] = [];
      const batchSize = Math.max(1, getSettings().embeddingBatchSize || 16);
      let processedChunks = 0;

      for (let i = 0; i < allNewChunks.length; i += batchSize) {
        if (this.isIndexingCancelled) break;
        await this.handlePause();

        const batch = allNewChunks.slice(i, i + batchSize);
        const texts = batch.map((chunk) => chunk.text);

        // Apply rate limiting ONCE per batch
        await this.rateLimiter.wait();
        const vecs = await embeddings.embedDocuments(texts);

        vecs.forEach((embedding, j) => {
          const chunk = batch[j];
          newRecords.push({
            id: `${chunk.path}#${chunk.chunkIndex}`,
            path: chunk.path,
            title: chunk.title,
            mtime: chunk.mtime,
            ctime: chunk.ctime,
            embedding,
          });
        });

        processedChunks += batch.length;
        // Update progress based on chunks processed but show file count
        this.indexedCount = Math.floor(
          (processedChunks / allNewChunks.length) * processedFiles.size
        );
        this.updateIndexingNoticeMessage();
      }

      // Write combined records
      const combined = [...keptRecords, ...newRecords];
      const lines = combined.map((r) => JSON.stringify(r));
      await this.writePartitions(lines);

      // Reset to force reload/build of vector store next search/use
      this.loaded = false;
      this.records = combined;
      logInfo(
        `MemoryIndex: Incremental index complete; removed ${toRemove.size} files, updated ${processedFiles.size} files, total chunks: ${combined.length}`
      );
      this.finalizeIndexingNotice(processedFiles.size);
      return processedFiles.size; // Return file count, not chunk count
    } catch (error) {
      logError("MemoryIndex: incremental index failed", error);
      this.hideIndexingNotice();
      return 0;
    }
  }

  /**
   * Reindex a single modified file if its mtime increased compared to existing index records.
   * Falls back to full incremental build if index is not yet loaded or file isn't tracked.
   */
  async reindexSingleFileIfModified(file: any, previousMtime: number | null): Promise<void> {
    const existed = await this.loadIfExists();
    if (!existed) {
      // No index yet; do nothing here to avoid full build implicitly
      return;
    }

    try {
      if (!file || file.extension !== "md") return;
      const indexedMtime = Math.max(
        0,
        ...this.records.filter((r) => r.path === file.path).map((r) => r.mtime)
      );
      const prev = previousMtime ?? indexedMtime;
      if (!file.stat?.mtime || file.stat.mtime <= prev) {
        return; // not modified since last seen
      }

      const embeddings = await EmbeddingManager.getInstance().getEmbeddingsAPI();
      const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
        chunkSize: CHUNK_SIZE,
      });

      const content = await this.app.vault.cachedRead(file);
      if (!content?.trim()) return;
      const title = file.basename;
      const header = `\n\nNOTE TITLE: [[${title}]]\n\nNOTE BLOCK CONTENT:\n\n`;
      const chunks = await splitter.createDocuments([content], [], {
        chunkHeader: header,
        appendChunkOverlapHeader: true,
      });
      const texts = chunks.map((c) => c.pageContent);
      const batchSize = Math.max(1, getSettings().embeddingBatchSize || 16);
      const newRecords: JsonlChunkRecord[] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        // Apply rate limiting before each batch
        await this.rateLimiter.wait();
        const vecs = await embeddings.embedDocuments(batch);
        vecs.forEach((embedding, j) => {
          newRecords.push({
            id: `${file.path}#${i + j}`,
            path: file.path,
            title,
            mtime: file.stat.mtime,
            ctime: file.stat.ctime,
            embedding,
          });
        });
      }

      // Remove old records in-place for better performance
      for (let i = this.records.length - 1; i >= 0; i--) {
        if (this.records[i].path === file.path) {
          this.records.splice(i, 1);
        }
      }
      // Append new records
      this.records.push(...newRecords);
      await this.writePartitions(this.records.map((r) => JSON.stringify(r)));
      this.loaded = false; // force rebuild of vector store on next ensureLoaded
      logInfo(`MemoryIndex: Reindexed modified file ${file.path} with ${newRecords.length} chunks`);
    } catch (error) {
      logWarn("MemoryIndex: reindexSingleFileIfModified failed", error);
    }
  }

  private createIndexingNotice(totalFiles: number) {
    const container = document.createElement("div");
    container.className = "copilot-notice-container";
    const msg = document.createElement("div");
    msg.className = "copilot-notice-message";
    msg.textContent = "";
    container.appendChild(msg);
    this.indexNoticeMessage = msg;
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "copilot-notice-buttons";
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Pause";
    pauseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (this.isIndexingPaused) {
        this.isIndexingPaused = false;
        pauseButton.textContent = "Pause";
      } else {
        this.isIndexingPaused = true;
        pauseButton.textContent = "Resume";
      }
    });
    buttonContainer.appendChild(pauseButton);
    const stopButton = document.createElement("button");
    stopButton.textContent = "Stop";
    stopButton.style.marginLeft = "8px";
    stopButton.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.isIndexingCancelled = true;
      this.hideIndexingNotice();
    });
    buttonContainer.appendChild(stopButton);
    container.appendChild(buttonContainer);
    const frag = document.createDocumentFragment();
    frag.appendChild(container);
    this.currentIndexingNotice = new Notice(frag, 0);
    this.updateIndexingNoticeMessage();
  }

  private updateIndexingNoticeMessage(): void {
    if (!this.indexNoticeMessage) return;
    const status = this.isIndexingPaused ? " (Paused)" : "";
    const messages: string[] = [
      `Copilot is indexing your vault...`,
      `${this.indexedCount}/${this.totalFilesToIndex} files processed${status}`,
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
    this.indexNoticeMessage.textContent = messages.join("\n");
  }

  private finalizeIndexingNotice(fileCount?: number) {
    if (this.currentIndexingNotice) {
      this.currentIndexingNotice.hide();
    }
    this.currentIndexingNotice = null;
    this.indexNoticeMessage = null;

    // Show completion notice
    if (this.isIndexingCancelled) {
      new Notice("Indexing cancelled");
    } else if (fileCount !== undefined) {
      new Notice(`Indexing completed successfully! Indexed ${fileCount} files.`);
    } else {
      new Notice("Indexing completed successfully!");
    }
  }

  private hideIndexingNotice() {
    if (this.currentIndexingNotice) this.currentIndexingNotice.hide();
    this.currentIndexingNotice = null;
    this.indexNoticeMessage = null;
  }

  private async handlePause(): Promise<void> {
    if (!this.isIndexingPaused) return;
    while (this.isIndexingPaused && !this.isIndexingCancelled) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Partitioned write: roll files at ~150MB to avoid JSON stringify RangeError on large strings
  private async writePartitions(lines: string[]): Promise<void> {
    const MAX_BYTES = 150 * 1024 * 1024; // 150MB target per partition
    // First, remove legacy single file if exists to avoid confusion
    const legacy = await this.getLegacyIndexPath();
    if (await this.app.vault.adapter.exists(legacy)) {
      try {
        // @ts-ignore
        await this.app.vault.adapter.remove(legacy);
      } catch {
        // ignore
      }
    }

    let part = 0;
    let buffer: string[] = [];
    let bytes = 0;
    const flush = async () => {
      const path = await this.getPartitionPath(part);
      await this.app.vault.adapter.write(path, buffer.join("\n") + "\n");
      part++;
      buffer = [];
      bytes = 0;
    };

    for (const line of lines) {
      const additional = line.length + 1; // include newline
      if (bytes + additional > MAX_BYTES && buffer.length > 0) {
        await flush();
      }
      buffer.push(line);
      bytes += additional;
    }
    if (buffer.length > 0) {
      await flush();
    }

    // Remove any tail partitions beyond the last written one
    for (let i = part; i < 1000; i++) {
      const p = await this.getPartitionPath(i);
      // @ts-ignore
      if (await this.app.vault.adapter.exists(p)) {
        try {
          // @ts-ignore
          await this.app.vault.adapter.remove(p);
        } catch {
          // ignore
        }
      } else {
        break;
      }
    }
  }

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
   * Clear the index (for resetting)
   * Used when clearing the index from commands
   */
  public clearIndex(): void {
    this.loaded = false;
    this.records = [];
    this.vectorStore = null;
  }

  /**
   * Get the underlying vector store for similarity search
   * @returns The vector store or null if not loaded
   */
  public getVectorStore(): MemoryVectorStore | null {
    return this.vectorStore;
  }
}
