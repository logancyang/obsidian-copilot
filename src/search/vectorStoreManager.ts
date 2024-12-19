import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { CopilotSettings, getSettings, subscribeToSettingsChange } from "@/settings/model";
import { Embeddings } from "@langchain/core/embeddings";
import { Orama } from "@orama/orama";
import { App, Notice, Platform } from "obsidian";
import { DBOperations } from "./dbOperations";
import { IndexEventHandler } from "./indexEventHandler";
import { IndexOperations } from "./indexOperations";

export default class VectorStoreManager {
  private indexOps: IndexOperations;
  private eventHandler: IndexEventHandler;
  private initializationPromise: Promise<void>;
  private lastKnownSettings: CopilotSettings | undefined;
  public dbOps: DBOperations;
  public embeddingsManager: EmbeddingsManager;

  constructor(private app: App) {
    this.embeddingsManager = EmbeddingsManager.getInstance();
    this.dbOps = new DBOperations(app);
    this.indexOps = new IndexOperations(app, this.dbOps, this.embeddingsManager);
    this.eventHandler = new IndexEventHandler(app, this.indexOps, this.dbOps);

    this.initializationPromise = this.initialize();
    this.setupSettingsSubscription();
  }

  private setupSettingsSubscription() {
    // Initialize lastKnownSettings
    this.lastKnownSettings = { ...getSettings() };

    subscribeToSettingsChange(async () => {
      const settings = getSettings();
      const prevSettings = this.lastKnownSettings;
      this.lastKnownSettings = { ...settings };

      // Handle path changes (enableIndexSync)
      if (settings.enableIndexSync !== prevSettings?.enableIndexSync) {
        const newPath = await this.dbOps.getDbPath();
        const oldPath = this.dbOps.getCurrentDbPath();

        if (oldPath !== newPath) {
          await this.dbOps.initializeDB(this.embeddingsManager.getEmbeddingsAPI());
        }
      }

      // Handle inclusion/exclusion changes
      if (
        settings.qaExclusions !== prevSettings?.qaExclusions ||
        settings.qaInclusions !== prevSettings?.qaInclusions
      ) {
        await this.eventHandler.updateExcludedFiles();
      }
    });
  }

  private async initialize(): Promise<void> {
    try {
      // Add retry logic for initialization
      let retries = 3;
      while (retries > 0) {
        try {
          await this.dbOps.initializeDB(this.embeddingsManager.getEmbeddingsAPI());
          break;
        } catch (error) {
          if (
            error instanceof CustomError &&
            error.message.includes("Vault adapter not available")
          ) {
            retries--;
            if (retries > 0) {
              await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 0.1 second before retry
              continue;
            }
          }
          throw error;
        }
      }
      this.eventHandler.initializeEventListeners();
    } catch (error) {
      console.error("Failed to initialize vector store:", error);
      throw error;
    }
  }

  public async indexVaultToVectorStore(overwrite?: boolean): Promise<number> {
    await this.waitForInitialization();
    if (Platform.isMobile && getSettings().disableIndexOnMobile) {
      new Notice("Indexing is disabled on mobile devices");
      return 0;
    }
    return this.indexOps.indexVaultToVectorStore(overwrite);
  }

  public async clearIndex(): Promise<void> {
    await this.waitForInitialization();
    await this.dbOps.clearIndex(this.embeddingsManager.getEmbeddingsAPI());
  }

  public async garbageCollectVectorStore(): Promise<number> {
    await this.waitForInitialization();
    return this.dbOps.garbageCollect();
  }

  public async getIndexedFiles(): Promise<string[]> {
    await this.waitForInitialization();
    return this.dbOps.getIndexedFiles();
  }

  public async isIndexEmpty(): Promise<boolean> {
    await this.waitForInitialization();
    return this.dbOps.isIndexEmpty();
  }

  public async waitForInitialization(): Promise<void> {
    await this.initializationPromise;
  }

  public onunload(): void {
    this.eventHandler.cleanup();
    this.dbOps.onunload();
  }

  public async getOrInitializeDb(embeddingsAPI: Embeddings): Promise<Orama<any>> {
    let db = this.dbOps.getDb();
    if (!db) {
      console.warn("Copilot index is not loaded. Reinitializing...");
      db = await this.dbOps.initializeDB(embeddingsAPI);

      if (!db) {
        throw new Error("Database failed to initialize. Please check your settings.");
      }
    }
    return db;
  }
}
