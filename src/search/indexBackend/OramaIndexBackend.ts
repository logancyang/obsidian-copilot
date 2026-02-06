import { Embeddings } from "@langchain/core/embeddings";
import { Orama } from "@orama/orama";
import { App } from "obsidian";
import { DBOperations } from "@/search/dbOperations";
import type {
  SemanticIndexBackend,
  SemanticIndexDocument,
} from "@/search/indexBackend/SemanticIndexBackend";

/**
 * Orama-backed implementation of the semantic index backend.
 */
export class OramaIndexBackend implements SemanticIndexBackend {
  private dbOps: DBOperations;

  /**
   * Create a new Orama backend tied to the current Obsidian app instance.
   */
  constructor(app: App) {
    this.dbOps = new DBOperations(app);
  }

  /**
   * Initialize the underlying Orama database.
   */
  public async initialize(embeddingInstance: Embeddings | undefined): Promise<void> {
    await this.dbOps.initializeDB(embeddingInstance);
  }

  /**
   * Clear the Orama index and reset storage.
   */
  public async clearIndex(embeddingInstance: Embeddings | undefined): Promise<void> {
    await this.dbOps.clearIndex(embeddingInstance);
  }

  /**
   * Insert or update a document in Orama.
   */
  public async upsert(doc: SemanticIndexDocument): Promise<SemanticIndexDocument | undefined> {
    return this.dbOps.upsert(doc);
  }

  /**
   * Remove all documents associated with a file path.
   */
  public async removeByPath(path: string): Promise<void> {
    await this.dbOps.removeDocs(path);
  }

  /**
   * Return all indexed file paths.
   */
  public async getIndexedFiles(): Promise<string[]> {
    return this.dbOps.getIndexedFiles();
  }

  /**
   * Return the latest modified time across indexed files.
   */
  public async getLatestFileMtime(): Promise<number> {
    return this.dbOps.getLatestFileMtime();
  }

  /**
   * Return true when the index has no documents.
   */
  public async isIndexEmpty(): Promise<boolean> {
    return this.dbOps.isIndexEmpty();
  }

  /**
   * Return true when the specified file path has indexed documents.
   */
  public async hasIndex(path: string): Promise<boolean> {
    return this.dbOps.hasIndex(path);
  }

  /**
   * Detect embedding model changes and rebuild as needed.
   */
  public async checkAndHandleEmbeddingModelChange(embeddingInstance: Embeddings): Promise<boolean> {
    return this.dbOps.checkAndHandleEmbeddingModelChange(embeddingInstance);
  }

  /**
   * Persist the Orama index to disk.
   */
  public async save(): Promise<void> {
    await this.dbOps.saveDB();
  }

  /**
   * Validate index integrity and track missing embeddings.
   */
  public async checkIndexIntegrity(): Promise<void> {
    await this.dbOps.checkIndexIntegrity();
  }

  /**
   * Remove stale documents that no longer belong in the index.
   */
  public async garbageCollect(): Promise<number> {
    return this.dbOps.garbageCollect();
  }

  /**
   * Mark a file as missing embeddings.
   */
  public markFileMissingEmbeddings(path: string): void {
    this.dbOps.markFileMissingEmbeddings(path);
  }

  /**
   * Clear tracked files missing embeddings.
   */
  public clearFilesMissingEmbeddings(): void {
    this.dbOps.clearFilesMissingEmbeddings();
  }

  /**
   * Return tracked files missing embeddings.
   */
  public getFilesMissingEmbeddings(): string[] {
    return this.dbOps.getFilesMissingEmbeddings();
  }

  /**
   * Mark index state as dirty without forcing a save.
   */
  public markUnsavedChanges(): void {
    this.dbOps.markUnsavedChanges();
  }

  /**
   * Ensure pending changes are flushed on unload.
   */
  public onunload(): void {
    this.dbOps.onunload();
  }

  /**
   * Return the underlying Orama database instance when available.
   */
  public getDb(): Orama<any> | undefined {
    return this.dbOps.getDb();
  }

  /**
   * Reinitialize the Orama DB when index sync settings change the storage path.
   */
  public async reinitializeForIndexSyncChange(
    embeddingInstance: Embeddings | undefined
  ): Promise<void> {
    const newPath = await this.dbOps.getDbPath();
    const oldPath = this.dbOps.getCurrentDbPath();

    if (oldPath !== newPath) {
      await this.dbOps.initializeDB(embeddingInstance);
    }
  }

  /**
   * Return the underlying DBOperations instance (legacy access).
   */
  public getDbOperations(): DBOperations {
    return this.dbOps;
  }
}
