import { CHUNK_SIZE } from "@/constants";
import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { logError, logInfo, logWarn } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";
import { Document as LCDocument } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { App } from "obsidian";

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

  private constructor(private app: App) {}

  static getInstance(app: App): MemoryIndexManager {
    if (!MemoryIndexManager.instance) {
      MemoryIndexManager.instance = new MemoryIndexManager(app);
    }
    return MemoryIndexManager.instance;
  }

  /**
   * Testing utility to clear the singleton and state between tests.
   */
  static __resetForTests(): void {
    MemoryIndexManager.instance = undefined as unknown as MemoryIndexManager;
  }

  private async getIndexPath(): Promise<string> {
    const baseDir = this.app.vault.configDir;
    return `${baseDir}/copilot-index-v3.jsonl`;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const path = await this.getIndexPath();
      if (!(await this.app.vault.adapter.exists(path))) {
        logInfo(
          "MemoryIndex: No JSONL index found; semantic retrieval will be empty until indexed."
        );
        this.loaded = true;
        return;
      }
      const content = await this.app.vault.adapter.read(path);
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      this.records = lines.map((l) => JSON.parse(l) as JsonlChunkRecord);
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
      const path = await this.getIndexPath();
      const exists = await this.app.vault.adapter.exists(path);
      if (!exists) {
        this.loaded = true;
        return false;
      }
      const content = await this.app.vault.adapter.read(path);
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      this.records = lines.map((l) => JSON.parse(l) as JsonlChunkRecord);
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
        variantVectors.push(await embeddings.embedQuery(q));
      } catch (error) {
        logWarn("MemoryIndex: query embedding failed", error);
      }
    }
    if (variantVectors.length === 0) return [];

    const noteToScore = new Map<string, number>();
    const candidateSet = candidates && candidates.length > 0 ? new Set(candidates) : null;
    const kPerQuery = Math.min(this.records.length, Math.max(maxK * 3, 100));
    for (const qv of variantVectors) {
      const results = await this.vectorStore.similaritySearchVectorWithScore(qv, kPerQuery);
      for (const [doc, score] of results) {
        const path = (doc.metadata as any)?.path as string;
        if (candidateSet && !candidateSet.has(path)) continue;
        // MemoryVectorStore returns cosine similarity in [0,1] where higher is better
        const normalized = Math.max(0, Math.min(1, typeof score === "number" ? score : 0));
        const prev = noteToScore.get(path) ?? 0;
        if (normalized > prev) noteToScore.set(path, normalized);
      }
    }

    return Array.from(noteToScore.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxK);
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
      const embeddings = await EmbeddingManager.getInstance().getEmbeddingsAPI();
      const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
        chunkSize: CHUNK_SIZE,
      });
      const lines: string[] = [];

      for (const file of files) {
        const content = await this.app.vault.cachedRead(file);
        if (!content?.trim()) continue;
        const title = file.basename;
        const header = `\n\nNOTE TITLE: [[${title}]]\n\nNOTE BLOCK CONTENT:\n\n`;
        const chunks = await splitter.createDocuments([content], [], {
          chunkHeader: header,
          appendChunkOverlapHeader: true,
        });

        const texts = chunks.map((c) => c.pageContent);
        // Embed in small batches to respect provider rate limits
        const batchSize = Math.max(1, getSettings().embeddingBatchSize || 16);
        for (let i = 0; i < texts.length; i += batchSize) {
          const batch = texts.slice(i, i + batchSize);
          const vecs = await embeddings.embedDocuments(batch);
          vecs.forEach((embedding, j) => {
            const id = `${file.path}#${i + j}`;
            const rec: JsonlChunkRecord = {
              id,
              path: file.path,
              title,
              mtime: file.stat.mtime,
              ctime: file.stat.ctime,
              embedding,
            };
            lines.push(JSON.stringify(rec));
          });
        }
      }

      const path = await this.getIndexPath();
      await this.app.vault.adapter.write(path, lines.join("\n") + "\n");
      this.loaded = false; // force reload on next ensureLoaded()
      logInfo(`MemoryIndex: Indexed ${lines.length} chunks -> ${path}`);
      return lines.length;
    } catch (error) {
      logError("MemoryIndex: indexVault failed", error);
      return 0;
    }
  }
}
