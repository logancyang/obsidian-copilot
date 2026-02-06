import { Embeddings } from "@langchain/core/embeddings";

/**
 * Represents a single semantic index document stored by a backend.
 */
export interface SemanticIndexDocument {
  id: string;
  title: string;
  content: string;
  embedding: number[];
  path: string;
  embeddingModel: string;
  created_at: number;
  ctime: number;
  mtime: number;
  tags: string[];
  extension: string;
  nchars: number;
  metadata: Record<string, unknown>;
}

/**
 * Defines the minimal contract for a semantic index backend.
 */
export interface SemanticIndexBackend {
  /**
   * Initialize the backend with the provided embeddings instance.
   */
  initialize(embeddingInstance: Embeddings | undefined): Promise<void>;

  /**
   * Clear all indexed data and reset the backend state.
   */
  clearIndex(embeddingInstance: Embeddings | undefined): Promise<void>;

  /**
   * Insert or update a semantic document in the backend.
   */
  upsert(doc: SemanticIndexDocument): Promise<SemanticIndexDocument | undefined>;

  /**
   * Remove all indexed documents associated with a file path.
   */
  removeByPath(path: string): Promise<void>;

  /**
   * Return the list of indexed file paths.
   */
  getIndexedFiles(): Promise<string[]>;

  /**
   * Return the latest modified time across indexed files.
   */
  getLatestFileMtime(): Promise<number>;

  /**
   * Return true when the backend has no indexed content.
   */
  isIndexEmpty(): Promise<boolean>;

  /**
   * Return true when a given file path has indexed content.
   */
  hasIndex(path: string): Promise<boolean>;

  /**
   * Check for embedding model changes and trigger required rebuilds.
   */
  checkAndHandleEmbeddingModelChange(embeddingInstance: Embeddings): Promise<boolean>;

  /**
   * Persist backend changes, if applicable.
   */
  save(): Promise<void>;

  /**
   * Validate index integrity and mark files needing reindexing.
   */
  checkIndexIntegrity(): Promise<void>;

  /**
   * Remove stale documents that no longer match vault state.
   */
  garbageCollect(): Promise<number>;

  /**
   * Track a file path that failed embedding generation.
   */
  markFileMissingEmbeddings(path: string): void;

  /**
   * Clear tracked files missing embeddings.
   */
  clearFilesMissingEmbeddings(): void;

  /**
   * Return tracked files missing embeddings.
   */
  getFilesMissingEmbeddings(): string[];

  /**
   * Mark backend data as dirty without saving immediately.
   */
  markUnsavedChanges(): void;

  /**
   * Flush or persist any pending backend work before unload.
   */
  onunload(): void;
}
