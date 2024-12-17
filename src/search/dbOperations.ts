import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { CustomError } from "@/error";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { areEmbeddingModelsSame } from "@/utils";
import { Embeddings } from "@langchain/core/embeddings";
import { create, insert, load, Orama, remove, removeMultiple, save, search } from "@orama/orama";
import { MD5 } from "crypto-js";
import { App, Notice, Platform } from "obsidian";
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
  private dbPath: string;
  private initializationPromise: Promise<void>;
  private isIndexLoaded = false;
  private saveDBTimer: number | null = null;
  private saveDBDelay = 120000; // Save full DB every 120 seconds
  private hasUnsavedChanges = false;

  constructor(private app: App) {
    this.initializePeriodicSave();

    // Subscribe to settings changes
    subscribeToSettingsChange(async () => {
      const settings = getSettings();

      // Handle mobile index loading setting change
      if (Platform.isMobile && settings.disableIndexOnMobile) {
        this.isIndexLoaded = false;
        this.oramaDb = undefined;
        console.log("Copilot index disabled on mobile device due to settings change");
      } else if (Platform.isMobile && !settings.disableIndexOnMobile && !this.oramaDb) {
        // Re-initialize DB if mobile setting is enabled
        await this.initializeDB(EmbeddingsManager.getInstance().getEmbeddingsAPI());
        console.log("Copilot index re-enabled on mobile device due to settings change");
      }
    });
  }

  private initializePeriodicSave() {
    if (this.saveDBTimer !== null) {
      window.clearInterval(this.saveDBTimer);
    }

    this.saveDBTimer = window.setInterval(() => {
      if (this.hasUnsavedChanges) {
        this.saveDB();
        this.hasUnsavedChanges = false;
      }
    }, this.saveDBDelay);
  }

  async initializeDB(embeddingInstance: Embeddings | undefined): Promise<Orama<any> | undefined> {
    if (Platform.isMobile && getSettings().disableIndexOnMobile) {
      console.log("Index loading disabled on mobile device");
      this.isIndexLoaded = false;
      this.oramaDb = undefined;
      return;
    }

    this.dbPath = await this.getDbPath();
    const configDir = this.app.vault.configDir;
    if (!(await this.app.vault.adapter.exists(configDir))) {
      console.log(`Config directory does not exist. Creating: ${configDir}`);
      await this.app.vault.adapter.mkdir(configDir);
    }

    try {
      if (await this.app.vault.adapter.exists(this.dbPath)) {
        const savedDb = await this.app.vault.adapter.read(this.dbPath);
        const parsedDb = JSON.parse(savedDb);
        const schema = parsedDb.schema;
        const newDb = await create({ schema });
        await load(newDb, parsedDb);
        console.log(`Loaded existing Orama database for ${this.dbPath} from disk.`);
        this.isIndexLoaded = true;
        this.oramaDb = newDb;
        return newDb;
      } else {
        const newDb = await this.createNewDb(embeddingInstance);
        this.oramaDb = newDb;
        return newDb;
      }
    } catch (error) {
      console.error(`Error initializing Orama database:`, error);
      if (Platform.isMobile && getSettings().disableIndexOnMobile) {
        return;
      }
      const newDb = await this.createNewDb(embeddingInstance);
      this.oramaDb = newDb;
      return newDb;
    }
  }

  async saveDB() {
    if (Platform.isMobile && getSettings().disableIndexOnMobile) {
      return;
    }

    try {
      if (!this.oramaDb) {
        throw new CustomError("Orama database not found.");
      }
      const rawData = await save(this.oramaDb);
      const dataToSave = {
        schema: this.oramaDb.schema,
        ...rawData,
      };

      const dbDir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
      if (!(await this.app.vault.adapter.exists(dbDir))) {
        await this.app.vault.adapter.mkdir(dbDir);
      }

      const saveOperation = async () => {
        try {
          await this.app.vault.adapter.write(this.dbPath, JSON.stringify(dataToSave));
          if (getSettings().debug) {
            console.log(`Saved Orama database to ${this.dbPath}.`);
          }
        } catch (error) {
          console.error(`Error saving Orama database to ${this.dbPath}:`, error);
        }
      };

      if (typeof window.requestIdleCallback !== "undefined") {
        window.requestIdleCallback(() => saveOperation(), { timeout: 2000 });
      } else {
        setTimeout(saveOperation, 0);
      }
    } catch (error) {
      console.error(`Error preparing Orama database save:`, error);
    }
  }

  public async clearIndex(embeddingInstance: Embeddings | undefined): Promise<void> {
    try {
      this.oramaDb = await this.createNewDb(embeddingInstance);
      if (await this.app.vault.adapter.exists(this.dbPath)) {
        await this.app.vault.adapter.remove(this.dbPath);
      }
      await this.saveDB();
      new Notice("Local Copilot index cleared successfully.");
      console.log("Local Copilot index cleared successfully, new instance created.");
    } catch (err) {
      console.error("Error clearing the local Copilot index:", err);
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
          console.log(`Deleted document from local Copilot index: ${filePath}`);
        }
      }
      this.markUnsavedChanges();
    } catch (err) {
      console.error("Error deleting document from local Copilotindex:", err);
    }
  }

  public getDb(): Orama<any> | undefined {
    return this.oramaDb;
  }

  public async getIsIndexLoaded(): Promise<boolean> {
    return this.isIndexLoaded;
  }

  public async waitForInitialization() {
    await this.initializationPromise;
  }

  public onunload() {
    if (this.saveDBTimer !== null) {
      window.clearInterval(this.saveDBTimer);
    }
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
    if (getSettings().enableIndexSync) {
      return `${this.app.vault.configDir}/copilot-index-${this.getVaultIdentifier()}.json`;
    }

    const vaultRoot = this.app.vault.getRoot().path;
    const indexDir = `${vaultRoot}/.copilot-index`;

    if (!(await this.app.vault.adapter.exists(indexDir))) {
      await this.app.vault.adapter.mkdir(indexDir);
    }

    return `${indexDir}/copilot-index-${this.getVaultIdentifier()}.json`;
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
    console.log(
      `Created new Orama database for ${this.dbPath}. ` +
        `Embedding model: ${EmbeddingsManager.getModelName(embeddingInstance)} with vector length ${vectorLength}.`
    );
    this.isIndexLoaded = true;
    return db;
  }

  public static async getDocsByPath(db: Orama<any>, path: string): Promise<any | undefined> {
    if (!db) throw new Error("DB not initialized");
    if (!path) return;
    const result = await search(db, {
      term: path,
      properties: ["path"],
      exact: true,
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
      console.error("Error getting latest file mtime from VectorDB:", err);
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

    try {
      // Check if the document already exists
      const existingDoc = await search(this.oramaDb, {
        term: docToSave.id,
        properties: ["id"],
        limit: 1,
      });

      if (existingDoc.hits.length > 0) {
        // First remove the existing document
        await remove(this.oramaDb, existingDoc.hits[0].id);
      }

      // Try to insert the new document
      try {
        await insert(this.oramaDb, docToSave);
        if (getSettings().debug) {
          console.log(
            `${existingDoc.hits.length > 0 ? "Updated" : "Inserted"} document ${docToSave.id} in VectorDB with path: ${docToSave.path}`
          );
        }
        this.markUnsavedChanges();
        return docToSave;
      } catch (insertErr) {
        console.error(
          `Failed to ${existingDoc.hits.length > 0 ? "update" : "insert"} document ${docToSave.id}:`,
          insertErr
        );
        // If we removed an existing document but failed to insert the new one,
        // we should try to restore the old document
        if (existingDoc.hits.length > 0) {
          try {
            await insert(this.oramaDb, existingDoc.hits[0].document);
          } catch (restoreErr) {
            console.error("Failed to restore previous document version:", restoreErr);
          }
        }
        return undefined;
      }
    } catch (err) {
      console.error(`Error upserting document ${docToSave.id} in VectorDB:`, err);
      return undefined;
    }
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
      console.error("Error getting latest file mtime from VectorDB:", err);
      return 0;
    }
  }

  async checkAndHandleEmbeddingModelChange(embeddingInstance: Embeddings): Promise<boolean> {
    if (!this.oramaDb) {
      console.error(
        "Orama database not found. Please make sure you have a working embedding model."
      );
      return false;
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
        console.log("Detected change in embedding model. Rebuilding Copilot index from scratch.");

        // Create new DB with new model
        this.oramaDb = await this.createNewDb(embeddingInstance);
        await this.saveDB();
        return true;
      }
    } else {
      console.log("No previous embedding model found in the database.");
    }

    return false;
  }

  public async garbageCollect(): Promise<void> {
    if (!this.oramaDb) {
      throw new CustomError("Orama database not found.");
    }
    try {
      const files = this.app.vault.getMarkdownFiles();
      const filePaths = new Set(files.map((file) => file.path));
      // Get all documents in the database
      const result = await search(this.oramaDb, {
        term: "",
        limit: 100000,
      });

      // Identify docs to remove
      const docsToRemove = result.hits.filter((hit) => !filePaths.has(hit.document.path));

      if (docsToRemove.length === 0) {
        new Notice("No documents to remove during garbage collection.");
        return;
      }

      console.log(
        "Copilot index: Docs to remove during garbage collection:",
        Array.from(new Set(docsToRemove.map((hit) => hit.document.path))).join(", ")
      );

      if (docsToRemove.length === 1) {
        await remove(this.oramaDb, docsToRemove[0].id);
      } else {
        await removeMultiple(
          this.oramaDb,
          docsToRemove.map((hit) => hit.id),
          500
        );
        new Notice(`Removed stale documents during garbage collection.`);
      }

      await this.saveDB();

      new Notice("Local Copilot index garbage collected successfully.");
      console.log("Local Copilot index garbage collected successfully.");
    } catch (err) {
      console.error("Error garbage collecting the Copilot index:", err);
      new Notice("An error occurred while garbage collecting the Copilot index.");
    }
  }

  public async getIndexedFiles(): Promise<string[]> {
    if (!this.oramaDb) {
      throw new CustomError("Orama database not found.");
    }

    try {
      // Search all documents and get unique file paths
      const result = await search(this.oramaDb, {
        term: "",
        limit: 100000,
      });

      // Use a Set to get unique file paths since multiple chunks can belong to the same file
      const uniquePaths = new Set<string>();
      result.hits.forEach((hit) => {
        uniquePaths.add(hit.document.path);
      });

      // Convert Set to sorted array
      return Array.from(uniquePaths).sort();
    } catch (err) {
      console.error("Error getting indexed files:", err);
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
      console.error("Error checking if database is empty:", err);
      throw new CustomError("Failed to check if database is empty.");
    }
  }
}
