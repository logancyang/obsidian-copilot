import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { CustomError } from "@/error";
import { logError, logInfo } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { areEmbeddingModelsSame } from "@/utils";
import { Embeddings } from "@langchain/core/embeddings";
import { create, insert, Orama, remove, removeMultiple, search } from "@orama/orama";
import { Mutex } from "async-mutex";
import { MD5 } from "crypto-js";
import { App, Notice, Platform } from "obsidian";
import { ChunkedStorage } from "./chunkedStorage";
import { getVectorLength } from "./searchUtils";

export interface OramaDocument {
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
  metadata: Record<string, any>;
}

export class DBOperations {
  private oramaDb: Orama<any> | undefined;
  private chunkedStorage: ChunkedStorage | undefined;
  private isInitialized = false;
  private dbPath: string;
  private initializationPromise: Promise<void>;
  private isIndexLoaded = false;
  private hasUnsavedChanges = false;
  private filesWithoutEmbeddings: Set<string> = new Set();
  private upsertMutex = new Mutex();

  constructor(private app: App) {
    // Subscribe to settings changes
    subscribeToSettingsChange(async () => {
      const settings = getSettings();

      // Handle mobile index loading setting change
      if (Platform.isMobile && settings.disableIndexOnMobile) {
        this.isIndexLoaded = false;
        this.oramaDb = undefined;
      } else if (Platform.isMobile && !settings.disableIndexOnMobile && !this.oramaDb) {
        // Re-initialize DB if mobile setting is enabled
        await this.initializeDB(await EmbeddingsManager.getInstance().getEmbeddingsAPI());
      }

      // Handle index sync setting change
      const newPath = await this.getDbPath();

      if (this.dbPath && newPath !== this.dbPath) {
        logInfo("Path change detected, reinitializing database...");
        this.dbPath = newPath;
        await this.initializeChunkedStorage();
        await this.initializeDB(await EmbeddingsManager.getInstance().getEmbeddingsAPI());
        logInfo("Database reinitialized with new path:", newPath);
      }
    });
  }

  private async initializeChunkedStorage() {
    if (!this.app.vault.adapter) {
      throw new CustomError("Vault adapter not available. Please try again later.");
    }
    const baseDir = await this.getDbPath();
    this.chunkedStorage = new ChunkedStorage(this.app, baseDir, this.getVaultIdentifier());
    this.isInitialized = true;
  }

  async initializeDB(embeddingInstance: Embeddings | undefined): Promise<Orama<any> | undefined> {
    try {
      if (!this.isInitialized) {
        this.dbPath = await this.getDbPath();
        await this.initializeChunkedStorage();
      }

      if (Platform.isMobile && getSettings().disableIndexOnMobile) {
        this.isIndexLoaded = false;
        this.oramaDb = undefined;
        return;
      }

      if (!this.chunkedStorage) {
        throw new CustomError("Storage not initialized properly");
      }

      try {
        if (await this.chunkedStorage.exists()) {
          this.oramaDb = await this.chunkedStorage.loadDatabase();
          logInfo("Loaded existing chunked Orama database from disk.");
          return this.oramaDb;
        }
      } catch (error) {
        // If loading fails, we'll create a new database
        logError("Failed to load existing database, creating new one:", error);
      }

      // Create new database if none exists or loading failed
      const newDb = await this.createNewDb(embeddingInstance);
      this.oramaDb = newDb;
      return newDb;
    } catch (error) {
      logError(`Error initializing Orama database:`, error);
      new Notice("Failed to initialize Copilot database. Some features may be limited.");
      return undefined;
    }
  }

  async saveDB() {
    if (Platform.isMobile && getSettings().disableIndexOnMobile) {
      return;
    }

    if (!this.oramaDb || !this.chunkedStorage) {
      // Instead of throwing immediately, try to initialize.
      // Crucial for new user onboarding.
      try {
        await this.initializeDB(await EmbeddingsManager.getInstance().getEmbeddingsAPI());
        // If still not initialized after attempt, then throw
        if (!this.oramaDb || !this.chunkedStorage) {
          throw new CustomError("Orama database not found.");
        }
      } catch (error) {
        logError("Failed to initialize database during save:", error);
        throw new CustomError("Failed to initialize and save database.");
      }
    }

    try {
      await this.chunkedStorage.saveDatabase(this.oramaDb);
      this.hasUnsavedChanges = false;

      if (getSettings().debug) {
        logInfo("Orama database saved successfully at:", this.dbPath);
      }
    } catch (error) {
      logError(`Error saving Orama database:`, error);
      throw error;
    }
  }

  async clearIndex(embeddingInstance: Embeddings | undefined): Promise<void> {
    try {
      // Ensure database is initialized first
      if (!this.oramaDb) {
        await this.initializeDB(embeddingInstance);
      }

      // Clear existing storage first
      await this.chunkedStorage?.clearStorage();

      // Wait a moment to ensure file system operations complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create new database instance
      this.oramaDb = await this.createNewDb(embeddingInstance);

      // Save the empty database
      await this.saveDB();

      new Notice("Local Copilot index cleared successfully.");
      logInfo("Local Copilot index cleared successfully, new instance created.");
    } catch (err) {
      logError("Error clearing the local Copilot index:", err);
      new Notice("An error occurred while clearing the local Copilot index.");
      throw err;
    }
  }

  public async removeDocs(filePath: string) {
    if (!this.oramaDb) {
      throw new CustomError("Orama database not found.");
    }
    try {
      const searchResult = await search(this.oramaDb, {
        term: filePath,
        properties: ["path"],
      });
      if (searchResult.hits.length > 0) {
        await removeMultiple(
          this.oramaDb,
          searchResult.hits.map((hit) => hit.id),
          500
        );
        if (getSettings().debug) {
          logInfo(`Deleted document from local Copilot index: ${filePath}`);
        }
      }
      this.markUnsavedChanges();
    } catch (err) {
      logError("Error deleting document from local Copilotindex:", err);
    }
  }

  public getDb(): Orama<any> | undefined {
    if (!this.oramaDb) {
      console.warn("Database not initialized. Some features may be limited.");
    }
    return this.oramaDb;
  }

  public async getIsIndexLoaded(): Promise<boolean> {
    return this.isIndexLoaded;
  }

  public async waitForInitialization() {
    await this.initializationPromise;
  }

  public onunload() {
    if (this.hasUnsavedChanges) {
      this.saveDB();
    }
  }

  public getCurrentDbPath(): string {
    // This is the old path before any setting changes, used for comparison
    return this.dbPath;
  }

  // This is the path according to the setting's enableIndexSync
  public async getDbPath(): Promise<string> {
    const vaultRoot = this.app.vault.getRoot().path;
    let baseDir: string;

    if (getSettings().enableIndexSync) {
      baseDir = this.app.vault.configDir;
    } else {
      // If vaultRoot is just "/", treat it as empty
      const effectiveRoot = vaultRoot === "/" ? "" : vaultRoot;
      const prefix = effectiveRoot === "" || effectiveRoot.startsWith("/") ? "" : "/";
      baseDir = `${prefix}${effectiveRoot}/.copilot-index`;

      // Ensure the directory exists
      if (!(await this.app.vault.adapter.exists(baseDir))) {
        await this.app.vault.adapter.mkdir(baseDir);
        logInfo("Created directory:", baseDir);
      }
    }

    return baseDir;
  }

  private getVaultIdentifier(): string {
    const vaultName = this.app.vault.getName();
    return MD5(vaultName).toString();
  }

  public markUnsavedChanges() {
    this.hasUnsavedChanges = true;
  }

  private async createNewDb(embeddingInstance: Embeddings | undefined): Promise<Orama<any>> {
    if (!embeddingInstance) {
      throw new CustomError("Embedding instance not found.");
    }

    const vectorLength = await getVectorLength(embeddingInstance);
    if (!vectorLength || vectorLength === 0) {
      throw new CustomError(
        "Invalid vector length detected. Please check if your embedding model is working."
      );
    }

    const schema = this.createDynamicSchema(vectorLength);

    const db = await create({
      schema,
      components: {
        tokenizer: {
          stemmer: undefined,
          stopWords: undefined,
        },
      },
    });
    logInfo(
      `Created new Orama database for ${this.dbPath}. ` +
        `Embedding model: ${EmbeddingsManager.getModelName(embeddingInstance)} with vector length ${vectorLength}.`
    );
    this.isIndexLoaded = true;
    return db;
  }

  public static async getDocsByPath(db: Orama<any>, path: string) {
    if (!db) throw new Error("DB not initialized");
    if (!path) return;
    const result = await search(db, {
      term: path,
      properties: ["path"],
      exact: true,
      includeVectors: true,
    });
    return result.hits;
  }

  public static async getDocsByEmbedding(
    db: Orama<any>,
    embedding: number[],
    options: {
      limit: number;
      similarity: number;
    }
  ) {
    const result = await search(db, {
      mode: "vector",
      vector: { value: embedding, property: "embedding" },
      limit: options.limit,
      similarity: options.similarity,
      includeVectors: true,
    });
    return result.hits;
  }

  public static async getLatestFileMtime(db: Orama<any> | undefined): Promise<number> {
    if (!db) throw new Error("DB not initialized");

    try {
      const result = await search(db, {
        term: "",
        limit: 1,
        sortBy: {
          property: "mtime",
          order: "DESC",
        },
      });

      if (result.hits.length > 0) {
        const latestDoc = result.hits[0].document as any;
        return latestDoc.mtime;
      }

      return 0; // Return 0 if no documents found
    } catch (err) {
      logError("Error getting latest file mtime from VectorDB:", err);
      return 0;
    }
  }

  createDynamicSchema(vectorLength: number) {
    return {
      id: "string",
      title: "string", // basename of the TFile
      path: "string", // path of the TFile
      content: "string",
      embedding: `vector[${vectorLength}]`,
      embeddingModel: "string",
      created_at: "number",
      ctime: "number",
      mtime: "number",
      tags: "string[]",
      extension: "string",
    };
  }

  async upsert(docToSave: any): Promise<any | undefined> {
    if (!this.oramaDb) throw new Error("DB not initialized");
    const db = this.oramaDb;

    // Use mutex to make the operation atomic
    return await this.upsertMutex.runExclusive(async () => {
      try {
        // Calculate partition first
        const partition = this.chunkedStorage?.assignDocumentToPartition(
          docToSave.id,
          getSettings().numPartitions
        );

        // Check if document exists
        const existingDoc = await search(db, {
          term: docToSave.id,
          properties: ["id"],
          limit: 1,
        });

        if (existingDoc.hits.length > 0) {
          await remove(db, existingDoc.hits[0].id);
        }

        // Insert into the assigned partition
        try {
          await insert(db, docToSave);
          logInfo(
            `${existingDoc.hits.length > 0 ? "Updated" : "Inserted"} document ${docToSave.id} in partition ${partition}`
          );

          this.markUnsavedChanges();
          return docToSave;
        } catch (insertErr) {
          logError(
            `Failed to ${existingDoc.hits.length > 0 ? "update" : "insert"} document ${docToSave.id}:`,
            insertErr
          );
          // If we removed an existing document but failed to insert the new one,
          // we should try to restore the old document
          if (existingDoc.hits.length > 0) {
            try {
              await insert(db, existingDoc.hits[0].document);
            } catch (restoreErr) {
              logError("Failed to restore previous document version:", restoreErr);
            }
          }
          return undefined;
        }
      } catch (err) {
        logError(`Error upserting document ${docToSave.id}:`, err);
        return undefined;
      }
    });
  }

  async getLatestFileMtime(): Promise<number> {
    if (!this.oramaDb) throw new Error("DB not initialized");

    try {
      const result = await search(this.oramaDb, {
        term: "",
        limit: 1,
        sortBy: {
          property: "mtime",
          order: "DESC",
        },
      });

      if (result.hits.length > 0) {
        const latestDoc = result.hits[0].document as any;
        return latestDoc.mtime;
      }

      return 0; // Return 0 if no documents found
    } catch (err) {
      logError("Error getting latest file mtime from VectorDB:", err);
      return 0;
    }
  }

  async checkAndHandleEmbeddingModelChange(embeddingInstance: Embeddings): Promise<boolean> {
    if (!this.oramaDb) {
      logInfo(
        "Embedding model change detected. Orama database not found. Initializing new database..."
      );
      try {
        await this.initializeDB(embeddingInstance);
        return true;
      } catch (error) {
        logError("Failed to initialize database:", error);
        throw new CustomError(
          "Failed to initialize Orama database. Please check your embedding model settings."
        );
      }
    }

    const singleDoc = await search(this.oramaDb, {
      term: "",
      limit: 1,
    });

    let prevEmbeddingModel: string | undefined;

    if (singleDoc.hits.length > 0) {
      const oramaDocSample = singleDoc.hits[0];
      if (
        typeof oramaDocSample === "object" &&
        oramaDocSample !== null &&
        "document" in oramaDocSample
      ) {
        const document = oramaDocSample.document as { embeddingModel?: string };
        prevEmbeddingModel = document.embeddingModel;
      }
    }

    if (prevEmbeddingModel) {
      const currEmbeddingModel = EmbeddingsManager.getModelName(embeddingInstance);

      if (!areEmbeddingModelsSame(prevEmbeddingModel, currEmbeddingModel)) {
        // Model has changed, notify user and rebuild DB
        new Notice("New embedding model detected. Rebuilding Copilot index from scratch.");
        logInfo(
          `Detected change in embedding model from "${prevEmbeddingModel}" to "${currEmbeddingModel}". Rebuilding Copilot index from scratch.`
        );

        // Create new DB with new model
        this.oramaDb = await this.createNewDb(embeddingInstance);
        await this.saveDB();
        return true;
      }
    } else {
      logInfo("No previous embedding model found in the database.");
    }

    return false;
  }

  public static async getAllDocuments(db: Orama<any>): Promise<any[]> {
    const result = await search(db, {
      term: "",
      limit: 100000,
      includeVectors: true,
    });
    return result.hits.map((hit) => hit.document);
  }

  public async garbageCollect(): Promise<number> {
    if (!this.oramaDb) {
      logInfo("Orama database not found during garbage collection. Attempting to initialize...");
      try {
        const embeddingInstance = await EmbeddingsManager.getInstance().getEmbeddingsAPI();
        if (!embeddingInstance) {
          throw new CustomError("No embedding model available.");
        }
        await this.initializeDB(embeddingInstance);
        if (!this.oramaDb) {
          throw new CustomError("Failed to initialize database after attempt.");
        }
      } catch (error) {
        logError("Failed to initialize database during garbage collection:", error);
        throw new CustomError(
          "Failed to initialize database. Please check your embedding model settings."
        );
      }
    }

    try {
      const files = this.app.vault.getMarkdownFiles();
      const filePaths = new Set(files.map((file) => file.path));
      // Get all documents in the database
      const docs = await DBOperations.getAllDocuments(this.oramaDb);

      // Identify docs to remove
      const docsToRemove = docs.filter((doc) => !filePaths.has(doc.path));

      if (docsToRemove.length === 0) {
        return 0;
      }

      logInfo(
        "Copilot index: Docs to remove during garbage collection:",
        Array.from(new Set(docsToRemove.map((doc) => doc.path))).join(", ")
      );

      if (docsToRemove.length === 1) {
        await remove(this.oramaDb, docsToRemove[0].id);
      } else {
        await removeMultiple(
          this.oramaDb,
          docsToRemove.map((hit) => hit.id),
          500
        );
      }

      await this.saveDB();
      return docsToRemove.length;
    } catch (err) {
      logError("Error garbage collecting the Copilot index:", err);
      throw new CustomError("Failed to garbage collect the Copilot index.");
    }
  }

  public async getIndexedFiles(): Promise<string[]> {
    if (!this.oramaDb) {
      throw new CustomError("Orama database not found.");
    }

    try {
      // Search all documents and get unique file paths
      const docs = await DBOperations.getAllDocuments(this.oramaDb);

      // Use a Set to get unique file paths since multiple chunks can belong to the same file
      const uniquePaths = new Set<string>();
      docs.forEach((doc) => {
        uniquePaths.add(doc.path);
      });

      // Convert Set to sorted array
      return Array.from(uniquePaths).sort();
    } catch (err) {
      logError("Error getting indexed files:", err);
      throw new CustomError("Failed to retrieve indexed files.");
    }
  }

  public async isIndexEmpty(): Promise<boolean> {
    if (!this.oramaDb) {
      return true;
    }

    try {
      const result = await search(this.oramaDb, {
        term: "",
        limit: 1,
      });
      return result.hits.length === 0;
    } catch (err) {
      logError("Error checking if database is empty:", err);
      throw new CustomError("Failed to check if database is empty.");
    }
  }

  public async hasIndex(notePath: string): Promise<boolean> {
    if (!this.oramaDb) {
      return false;
    }
    const docs = await DBOperations.getDocsByPath(this.oramaDb, notePath);
    return docs !== undefined && docs.length > 0;
  }

  async hasEmbeddings(notePath: string): Promise<boolean> {
    if (!this.oramaDb) {
      return false;
    }
    const docs = await DBOperations.getDocsByPath(this.oramaDb, notePath);
    if (!docs || docs.length === 0) {
      return false;
    }
    // Check if ALL documents for this path have embeddings
    return docs.every((doc) => {
      return (
        doc?.document?.embedding &&
        Array.isArray(doc.document.embedding) &&
        doc.document.embedding.length > 0
      );
    });
  }

  async getDocsJsonByPaths(paths: string[]): Promise<Record<string, any[]>> {
    if (!this.oramaDb) {
      throw new CustomError("Orama database not found.");
    }

    const result: Record<string, any[]> = {};

    for (const path of paths) {
      const docs = await DBOperations.getDocsByPath(this.oramaDb, path);
      if (docs && docs.length > 0) {
        result[path] = docs.map((hit) => ({
          id: hit.document.id,
          title: hit.document.title,
          path: hit.document.path,
          content: hit.document.content,
          metadata: hit.document.metadata,
          embedding: hit.document.embedding,
          embeddingModel: hit.document.embeddingModel,
          tags: hit.document.tags,
          extension: hit.document.extension,
          nchars: hit.document.nchars,
        }));
      }
    }

    return result;
  }

  /**
   * Mark a file as missing embeddings
   */
  public markFileMissingEmbeddings(filePath: string): void {
    this.filesWithoutEmbeddings.add(filePath);
  }

  /**
   * Clear the list of files missing embeddings
   */
  public clearFilesMissingEmbeddings(): void {
    this.filesWithoutEmbeddings.clear();
  }

  /**
   * Get the list of files missing embeddings
   */
  public getFilesMissingEmbeddings(): string[] {
    return Array.from(this.filesWithoutEmbeddings);
  }

  /**
   * Check if a file is missing embeddings
   */
  public isFileMissingEmbeddings(filePath: string): boolean {
    return this.filesWithoutEmbeddings.has(filePath);
  }

  /**
   * Check the integrity of the index by verifying all documents have proper embeddings.
   * Any documents found to be missing embeddings will be marked for reindexing.
   */
  public async checkIndexIntegrity(): Promise<void> {
    if (!this.oramaDb) {
      throw new CustomError("Orama database not found.");
    }

    try {
      // Get all indexed files
      const indexedFiles = await this.getIndexedFiles();

      // Check each file for embeddings
      for (const filePath of indexedFiles) {
        const hasEmbeddings = await this.hasEmbeddings(filePath);
        if (!hasEmbeddings) {
          this.markFileMissingEmbeddings(filePath);
        }
      }

      const missingEmbeddings = this.getFilesMissingEmbeddings();
      if (missingEmbeddings.length > 0) {
        logInfo("Files missing embeddings after integrity check:", missingEmbeddings.join(", "));
      } else {
        logInfo("Index integrity check completed. All documents have embeddings.");
      }
    } catch (err) {
      logError("Error checking index integrity:", err);
      throw new CustomError("Failed to check index integrity.");
    }
  }
}
