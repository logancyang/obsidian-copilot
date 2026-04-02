import { Embeddings } from "@langchain/core/embeddings";
import { App, Notice } from "obsidian";
import { logInfo, logWarn } from "@/logger";
import { MiyoClient, MiyoIndexedFileEntry } from "@/miyo/MiyoClient";
import {
  getMiyoAbsolutePath,
  getMiyoCustomUrl,
  getMiyoFolderPath,
  getVaultRelativeMiyoPath,
} from "@/miyo/miyoUtils";
import type {
  SemanticIndexBackend,
  SemanticIndexDocument,
} from "@/search/indexBackend/SemanticIndexBackend";
import { getSettings } from "@/settings/model";

/**
 * Miyo-backed implementation of the semantic index backend.
 *
 * Miyo owns folder registration, chunking, indexing, and file-change tracking.
 * Copilot only requests scans and reads indexed results.
 */
export class MiyoIndexBackend implements SemanticIndexBackend {
  private client: MiyoClient;

  /**
   * Create a new Miyo backend tied to the current Obsidian app instance.
   *
   * @param app - Obsidian application instance.
   */
  constructor(private app: App) {
    this.client = new MiyoClient();
  }

  /**
   * Initialize the Miyo backend by validating connectivity and folder access.
   *
   * @param _embeddingInstance - Embeddings instance (unused for Miyo initialization).
   */
  public async initialize(_embeddingInstance: Embeddings | undefined): Promise<void> {
    try {
      const baseUrl = await this.getBaseUrl();
      await this.client.getFolder(baseUrl, this.getFolderPath());
    } catch (error) {
      logWarn(`Miyo backend initialization failed: ${error}`);
      new Notice(
        "Failed to initialize Miyo backend. Check Miyo service discovery or folder setup."
      );
    }
  }

  /**
   * Clearing the index is managed directly in Miyo, not by Copilot.
   *
   * @param _embeddingInstance - Embeddings instance (unused for Miyo).
   */
  public async clearIndex(_embeddingInstance: Embeddings | undefined): Promise<void> {
    logWarn("Miyo clearIndex requested from Copilot, but folder lifecycle is managed in Miyo.");
  }

  /**
   * Miyo handles embeddings internally.
   *
   * @returns False because Miyo does not require client-side embeddings.
   */
  public requiresEmbeddings(): boolean {
    return false;
  }

  /**
   * Copilot no longer upserts individual Miyo documents.
   *
   * @param doc - Document to upsert.
   * @returns Undefined because the write is handled by Miyo scans.
   */
  public async upsert(doc: SemanticIndexDocument): Promise<SemanticIndexDocument | undefined> {
    logInfo(`Skipping direct Miyo upsert for ${doc.path}; Miyo manages indexing itself.`);
    return undefined;
  }

  /**
   * Copilot no longer batches document upserts into Miyo.
   *
   * @param docs - Documents to upsert.
   * @returns Zero because direct upserts are no longer used.
   */
  public async upsertBatch(docs: SemanticIndexDocument[]): Promise<number> {
    if (docs.length > 0) {
      logInfo(`Skipping direct Miyo batch upsert for ${docs.length} documents.`);
    }
    return 0;
  }

  /**
   * File removal is managed by Miyo's folder watcher and scanner.
   *
   * @param path - File path to delete.
   */
  public async removeByPath(path: string): Promise<void> {
    logInfo(`Skipping direct Miyo delete for ${path}; Miyo manages file lifecycle itself.`);
  }

  /**
   * Return all indexed file paths for the current vault folder.
   */
  public async getIndexedFiles(): Promise<string[]> {
    const files = await this.getAllIndexedFiles();
    return Array.from(new Set(files.map((file) => this.toVaultPath(file.path)))).sort();
  }

  /**
   * Return the latest modified time across indexed files.
   */
  public async getLatestFileMtime(): Promise<number> {
    const files = await this.getAllIndexedFiles();
    return files.reduce((latest, file) => Math.max(latest, file.mtime ?? 0), 0);
  }

  /**
   * Return true when the index has no documents.
   */
  public async isIndexEmpty(): Promise<boolean> {
    const files = await this.getAllIndexedFiles();
    return files.length === 0;
  }

  /**
   * Return true when the specified file path has indexed documents.
   *
   * @param path - Vault-relative file path to check.
   */
  public async hasIndex(path: string): Promise<boolean> {
    const docs = await this.getDocumentsByPath(path);
    return docs.length > 0;
  }

  /**
   * Return all indexed documents for a given vault-relative file path.
   *
   * @param path - Vault-relative file path to look up.
   */
  public async getDocumentsByPath(path: string): Promise<SemanticIndexDocument[]> {
    const baseUrl = await this.getBaseUrl();
    const absolutePath = getMiyoAbsolutePath(this.app, path);
    const response = await this.client.getDocumentsByPath(
      baseUrl,
      this.getFolderPath(),
      absolutePath
    );
    const docs = response.documents ?? [];
    return docs.map((doc) => this.fromMiyoDocument(path, doc));
  }

  /**
   * Detect embedding model changes and indicate whether a rebuild is needed.
   *
   * @param _embeddingInstance - Current embeddings instance (unused for Miyo).
   * @returns False because Miyo controls embeddings.
   */
  public async checkAndHandleEmbeddingModelChange(
    _embeddingInstance?: Embeddings
  ): Promise<boolean> {
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
   * Garbage collection is managed directly in Miyo.
   *
   * @returns Zero because Copilot does not delete Miyo records directly anymore.
   */
  public async garbageCollect(): Promise<number> {
    logInfo("Skipping Miyo garbage collection; folder lifecycle is managed in Miyo.");
    return 0;
  }

  /**
   * Track missing embeddings (unused for Miyo).
   *
   * @param _path - File path to track.
   */
  public markFileMissingEmbeddings(_path: string): void {
    return;
  }

  /**
   * Clear tracked files missing embeddings (unused for Miyo).
   */
  public clearFilesMissingEmbeddings(): void {
    return;
  }

  /**
   * Return tracked files missing embeddings (unused for Miyo).
   *
   * @returns Empty array.
   */
  public getFilesMissingEmbeddings(): string[] {
    return [];
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
   * Miyo is a remote HTTP backend with no local index.
   *
   * @returns True because Miyo sends data to a remote service.
   */
  public isRemoteBackend(): boolean {
    return true;
  }

  /**
   * Trigger a folder scan in Miyo.
   *
   * @param force - Whether to request a forced re-scan.
   */
  public async requestIndexRefresh(force = false): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    await this.client.scanFolder(baseUrl, this.getFolderPath(), force);
  }

  /**
   * Resolve the Miyo base URL using settings and discovery.
   *
   * @returns Base URL string.
   */
  private async getBaseUrl(): Promise<string> {
    const overrideUrl = getMiyoCustomUrl(getSettings());
    return this.client.resolveBaseUrl(overrideUrl);
  }

  /**
   * Return the Miyo folder path for the current vault.
   *
   * @returns Folder path string.
   */
  private getFolderPath(): string {
    return getMiyoFolderPath(this.app, getSettings());
  }

  /**
   * Fetch every indexed file entry from Miyo for the current folder.
   *
   * @returns Indexed file entries.
   */
  private async getAllIndexedFiles(): Promise<MiyoIndexedFileEntry[]> {
    const baseUrl = await this.getBaseUrl();
    const limit = 200;
    let offset = 0;
    let total: number | null = null;
    const files: MiyoIndexedFileEntry[] = [];

    do {
      const response = await this.client.listFolderFiles(baseUrl, {
        folderPath: this.getFolderPath(),
        offset,
        limit,
      });
      const batch = response.files ?? [];
      files.push(...batch);
      if (total === null) {
        total = response.total ?? batch.length;
      }
      offset += batch.length;
      if (batch.length === 0) {
        break;
      }
    } while (offset < total);

    return files;
  }

  /**
   * Convert a Miyo path to a vault-relative path when possible.
   *
   * @param path - Miyo path value.
   * @returns Vault-relative path when the file is inside the current vault.
   */
  private toVaultPath(path: string): string {
    return getVaultRelativeMiyoPath(this.app, path);
  }

  /**
   * Convert a Miyo document response to a Copilot document shape.
   *
   * @param fallbackPath - Vault-relative fallback path used when payload omits it.
   * @param doc - Miyo response document.
   * @returns Copilot document shape.
   */
  private fromMiyoDocument(
    fallbackPath: string,
    doc: {
      id: string;
      path?: string;
      title?: string | null;
      chunk_index?: number;
      chunk_text?: string | null;
      metadata?: Record<string, unknown>;
      embedding_model?: string | null;
      ctime?: number;
      mtime?: number;
      tags?: string[];
      extension?: string;
      created_at?: string | number | null;
      nchars?: number;
    }
  ): SemanticIndexDocument {
    const resolvedPath = doc.path ? this.toVaultPath(doc.path) : fallbackPath;
    const content = doc.chunk_text ?? "";
    const metadata = { ...(doc.metadata ?? {}) };
    if (!metadata.chunkId && doc.chunk_index !== undefined) {
      metadata.chunkId = `${resolvedPath}#${doc.chunk_index}`;
    }
    if (doc.chunk_index !== undefined && metadata.chunkIndex === undefined) {
      metadata.chunkIndex = doc.chunk_index;
    }

    return {
      id: doc.id,
      title: doc.title ?? "",
      content,
      embedding: [],
      path: resolvedPath,
      embeddingModel: doc.embedding_model ?? "",
      created_at: typeof doc.created_at === "number" ? doc.created_at : 0,
      ctime: doc.ctime ?? 0,
      mtime: doc.mtime ?? 0,
      tags: doc.tags ?? [],
      extension: doc.extension ?? "",
      nchars: doc.nchars ?? content.length,
      metadata,
    };
  }
}
