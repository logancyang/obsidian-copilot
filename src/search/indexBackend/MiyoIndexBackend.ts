import { Embeddings } from "@langchain/core/embeddings";
import { App, Notice } from "obsidian";
import { areEmbeddingModelsSame } from "@/utils";
import { logError, logInfo, logWarn } from "@/logger";
import { MiyoClient, MiyoUpsertDocument } from "@/miyo/MiyoClient";
import { getMiyoSourceId } from "@/miyo/miyoUtils";
import type {
  SemanticIndexBackend,
  SemanticIndexDocument,
} from "@/search/indexBackend/SemanticIndexBackend";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { getSettings } from "@/settings/model";

/**
 * Miyo-backed implementation of the semantic index backend.
 */
export class MiyoIndexBackend implements SemanticIndexBackend {
  private client: MiyoClient;
  private filesMissingEmbeddings: Set<string> = new Set();

  /**
   * Create a new Miyo backend tied to the current Obsidian app instance.
   *
   * @param app - Obsidian application instance.
   */
  constructor(private app: App) {
    this.client = new MiyoClient();
  }

  /**
   * Initialize the Miyo backend by ensuring the service is reachable.
   *
   * @param _embeddingInstance - Embeddings instance (unused for Miyo initialization).
   */
  public async initialize(_embeddingInstance: Embeddings | undefined): Promise<void> {
    try {
      const baseUrl = await this.getBaseUrl();
      await this.client.getStats(baseUrl, this.getSourceId());
    } catch (error) {
      logWarn(`Miyo backend initialization failed: ${error}`);
      new Notice("Failed to initialize Miyo backend. Check Miyo service discovery or URL.");
    }
  }

  /**
   * Clear all indexed data for the current vault.
   *
   * @param _embeddingInstance - Embeddings instance (unused for Miyo clear).
   */
  public async clearIndex(_embeddingInstance: Embeddings | undefined): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    await this.client.clearIndex(baseUrl, this.getSourceId());
  }

  /**
   * Insert or update a single document.
   *
   * @param doc - Document to upsert.
   * @returns The document when upsert succeeds.
   */
  public async upsert(doc: SemanticIndexDocument): Promise<SemanticIndexDocument | undefined> {
    const count = await this.upsertBatch([doc]);
    return count > 0 ? doc : undefined;
  }

  /**
   * Insert or update multiple documents in a batch.
   *
   * @param docs - Documents to upsert.
   * @returns Number of documents upserted.
   */
  public async upsertBatch(docs: SemanticIndexDocument[]): Promise<number> {
    if (docs.length === 0) {
      return 0;
    }
    const baseUrl = await this.getBaseUrl();
    const sourceId = this.getSourceId();
    this.logUpsertBatchRequested(docs, baseUrl, sourceId);
    const payloadDocs = docs.map((doc) => this.toMiyoDocument(doc));
    const upserted = await this.client.upsertDocuments(baseUrl, sourceId, payloadDocs);
    this.logUpsertBatchResult(docs.length, upserted);
    return upserted;
  }

  /**
   * Remove all documents associated with a file path.
   *
   * @param path - File path to delete.
   */
  public async removeByPath(path: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    await this.client.deleteByPath(baseUrl, this.getSourceId(), path);
  }

  /**
   * Return all indexed file paths.
   */
  public async getIndexedFiles(): Promise<string[]> {
    const baseUrl = await this.getBaseUrl();
    const sourceId = this.getSourceId();
    const limit = 200;
    let offset = 0;
    let total = 0;
    const paths = new Set<string>();

    do {
      const response = await this.client.listFiles(baseUrl, sourceId, offset, limit);
      const files = response.files ?? [];
      files.forEach((file) => paths.add(file.path));
      total = response.total ?? paths.size;
      offset += files.length;
      if (files.length === 0) {
        break;
      }
    } while (offset < total);

    return Array.from(paths).sort();
  }

  /**
   * Return the latest modified time across indexed files.
   */
  public async getLatestFileMtime(): Promise<number> {
    const stats = await this.getStatsSafely();
    return stats?.latest_mtime ?? 0;
  }

  /**
   * Return true when the index has no documents.
   */
  public async isIndexEmpty(): Promise<boolean> {
    const stats = await this.getStatsSafely();
    if (!stats) {
      return true;
    }
    return (stats.total_chunks ?? 0) === 0;
  }

  /**
   * Return true when the specified file path has indexed documents.
   *
   * @param path - File path to check.
   */
  public async hasIndex(path: string): Promise<boolean> {
    const docs = await this.getDocumentsByPath(path);
    return docs.length > 0;
  }

  /**
   * Return all indexed documents for a given file path.
   *
   * @param path - File path to look up.
   */
  public async getDocumentsByPath(path: string): Promise<SemanticIndexDocument[]> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.client.getDocumentsByPath(baseUrl, this.getSourceId(), path);
    const docs = response.documents ?? [];
    return docs.map((doc) => this.fromMiyoDocument(path, doc));
  }

  /**
   * Detect embedding model changes and indicate whether a rebuild is needed.
   *
   * @param embeddingInstance - Current embeddings instance.
   * @returns True when a rebuild should occur.
   */
  public async checkAndHandleEmbeddingModelChange(embeddingInstance: Embeddings): Promise<boolean> {
    const stats = await this.getStatsSafely();
    if (!stats || (stats.total_chunks ?? 0) === 0) {
      return false;
    }

    const previousModel = stats.embedding_model;
    if (!previousModel) {
      logInfo("Miyo index has no recorded embedding model.");
      return false;
    }

    const currentModel = EmbeddingsManager.getModelName(embeddingInstance);
    if (!areEmbeddingModelsSame(previousModel, currentModel)) {
      new Notice("New embedding model detected. Rebuilding Copilot index from scratch.");
      logInfo(
        `Detected change in embedding model from "${previousModel}" to "${currentModel}". Rebuild required.`
      );
      return true;
    }

    return false;
  }

  /**
   * Persist backend changes (no-op for Miyo).
   */
  public async save(): Promise<void> {
    return;
  }

  /**
   * Validate index integrity (no-op for Miyo).
   */
  public async checkIndexIntegrity(): Promise<void> {
    return;
  }

  /**
   * Remove stale documents (no-op for Miyo).
   */
  public async garbageCollect(): Promise<number> {
    return 0;
  }

  /**
   * Mark a file as missing embeddings.
   *
   * @param path - File path to track.
   */
  public markFileMissingEmbeddings(path: string): void {
    this.filesMissingEmbeddings.add(path);
  }

  /**
   * Clear tracked files missing embeddings.
   */
  public clearFilesMissingEmbeddings(): void {
    this.filesMissingEmbeddings.clear();
  }

  /**
   * Return tracked files missing embeddings.
   */
  public getFilesMissingEmbeddings(): string[] {
    return Array.from(this.filesMissingEmbeddings);
  }

  /**
   * Mark index state as dirty (no-op for Miyo).
   */
  public markUnsavedChanges(): void {
    return;
  }

  /**
   * Flush pending changes on unload (no-op for Miyo).
   */
  public onunload(): void {
    return;
  }

  /**
   * Resolve the Miyo base URL using settings and discovery.
   *
   * @returns Base URL string.
   */
  private async getBaseUrl(): Promise<string> {
    const overrideUrl = getSettings().selfHostUrl;
    return this.client.resolveBaseUrl(overrideUrl);
  }

  /**
   * Compute a stable source ID for the current vault.
   *
   * @returns MD5 hash of the vault name.
   */
  private getSourceId(): string {
    return getMiyoSourceId(this.app);
  }

  /**
   * Log details about the pending upsert batch for debugging parity with Orama.
   *
   * @param docs - Documents being upserted.
   * @param baseUrl - Miyo base URL.
   * @param sourceId - Vault source ID.
   */
  private logUpsertBatchRequested(
    docs: SemanticIndexDocument[],
    baseUrl: string,
    sourceId: string
  ): void {
    logInfo(`Miyo upsert batch: ${docs.length} documents`, { baseUrl, sourceId });
    docs.forEach((doc) => {
      const chunkId = doc.metadata?.chunkId;
      const chunkSuffix =
        typeof chunkId === "string" && chunkId.length > 0 ? ` (chunkId: ${chunkId})` : "";
      logInfo(`Miyo upsert document ${doc.id} @ ${doc.path}${chunkSuffix}`);
    });
  }

  /**
   * Log the result of a Miyo upsert batch.
   *
   * @param requested - Number of documents requested for upsert.
   * @param upserted - Number of documents reported by Miyo.
   */
  private logUpsertBatchResult(requested: number, upserted: number): void {
    if (upserted === requested) {
      logInfo(`Miyo upsert batch completed: ${upserted}/${requested} documents`);
      return;
    }
    logWarn(`Miyo upsert batch returned ${upserted}/${requested} documents`);
  }

  /**
   * Safely fetch index stats without throwing.
   *
   * @returns Stats response or null when unavailable.
   */
  private async getStatsSafely() {
    try {
      const baseUrl = await this.getBaseUrl();
      return await this.client.getStats(baseUrl, this.getSourceId());
    } catch (error) {
      logError(`Failed to fetch Miyo index stats: ${error}`);
      return null;
    }
  }

  /**
   * Convert a Copilot document to a Miyo upsert payload.
   *
   * @param doc - Copilot document.
   * @returns Miyo upsert document payload.
   */
  private toMiyoDocument(doc: SemanticIndexDocument): MiyoUpsertDocument {
    return {
      id: doc.id,
      path: doc.path,
      title: doc.title,
      content: doc.content,
      embedding: doc.embedding,
      embedding_model: doc.embeddingModel,
      created_at: doc.created_at,
      ctime: doc.ctime,
      mtime: doc.mtime,
      tags: doc.tags,
      extension: doc.extension,
      nchars: doc.nchars,
      metadata: doc.metadata ?? {},
    };
  }

  /**
   * Convert a Miyo document response to a Copilot document shape.
   *
   * @param fallbackPath - Path used when payload omits it.
   * @param doc - Miyo response document.
   * @returns Copilot document shape.
   */
  private fromMiyoDocument(
    fallbackPath: string,
    doc: {
      id: string;
      path?: string;
      title?: string;
      chunk_index?: number;
      chunk_text?: string;
      metadata?: Record<string, unknown>;
      embedding_model?: string;
      ctime?: number;
      mtime?: number;
      tags?: string[];
      extension?: string;
      created_at?: number;
      nchars?: number;
    }
  ): SemanticIndexDocument {
    const content = doc.chunk_text ?? "";
    const metadata = doc.metadata ?? {};
    if (!metadata.chunkId && doc.chunk_index !== undefined) {
      metadata.chunkId = `${doc.path || fallbackPath}#${doc.chunk_index}`;
    }
    if (doc.chunk_index !== undefined && metadata.chunkIndex === undefined) {
      metadata.chunkIndex = doc.chunk_index;
    }

    return {
      id: doc.id,
      title: doc.title ?? "",
      content,
      embedding: [],
      path: doc.path ?? fallbackPath,
      embeddingModel: doc.embedding_model ?? "",
      created_at: doc.created_at ?? 0,
      ctime: doc.ctime ?? 0,
      mtime: doc.mtime ?? 0,
      tags: doc.tags ?? [],
      extension: doc.extension ?? "",
      nchars: doc.nchars ?? content.length,
      metadata,
    };
  }
}
