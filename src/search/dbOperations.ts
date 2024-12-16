import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { CustomError } from "@/error";
import { getSettings } from "@/settings/model";
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

  public async clearIndex(embeddingInstance: Embeddings): Promise<void> {
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

  private async getDbPath(): Promise<string> {
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
        // Then insert the new version
        await insert(this.oramaDb, docToSave);

        if (getSettings().debug) {
          console.log(`Updated document ${docToSave.id} in VectorDB with path: ${docToSave.path}`);
        }
      } else {
        // Document doesn't exist, insert it
        await insert(this.oramaDb, docToSave);
        if (getSettings().debug) {
          console.log(`Inserted document ${docToSave.id} in VectorDB with path: ${docToSave.path}`);
        }
      }
      this.markUnsavedChanges();
      return docToSave;
    } catch (err) {
      console.error(`Error upserting document ${docToSave.id} in VectorDB:`, err);
      // Instead of throwing, we'll return undefined to indicate failure
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
}
