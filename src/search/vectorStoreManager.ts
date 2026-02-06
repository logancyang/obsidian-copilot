// DEPRECATED: v3 semantic indexing uses MemoryIndexManager (JSONL snapshots). This file remains only
// for legacy Orama-based flows and should not be referenced by new code.
import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { CopilotSettings, getSettings, subscribeToSettingsChange } from "@/settings/model";
import { Orama } from "@orama/orama";
import { Notice, Platform, TFile } from "obsidian";
import type { DBOperations } from "./dbOperations";
import { OramaIndexBackend } from "./indexBackend/OramaIndexBackend";
import type { SemanticIndexBackend } from "./indexBackend/SemanticIndexBackend";
import { IndexEventHandler } from "./indexEventHandler";
import { IndexOperations } from "./indexOperations";

export default class VectorStoreManager {
  private static instance: VectorStoreManager;
  private indexOps: IndexOperations;
  private eventHandler: IndexEventHandler;
  private initializationPromise: Promise<void>;
  private lastKnownSettings: CopilotSettings | undefined;
  private embeddingsManager: EmbeddingsManager;
  private indexBackend: SemanticIndexBackend;
  private oramaBackend: OramaIndexBackend;

  private constructor() {
    this.embeddingsManager = EmbeddingsManager.getInstance();
    this.oramaBackend = new OramaIndexBackend(app);
    this.indexBackend = this.oramaBackend;
    this.indexOps = new IndexOperations(app, this.indexBackend, this.embeddingsManager);
    this.eventHandler = new IndexEventHandler(app, this.indexOps, this.indexBackend);

    this.initializationPromise = this.initialize();
    this.setupSettingsSubscription();
  }

  static getInstance(): VectorStoreManager {
    if (!VectorStoreManager.instance) {
      VectorStoreManager.instance = new VectorStoreManager();
    }
    return VectorStoreManager.instance;
  }

  private setupSettingsSubscription() {
    // Initialize lastKnownSettings
    this.lastKnownSettings = { ...getSettings() };

    const reinitialize = async () => {
      const settings = getSettings();
      const prevSettings = this.lastKnownSettings;
      this.lastKnownSettings = { ...settings };

      // Handle path changes (enableIndexSync)
      if (settings.enableIndexSync !== prevSettings?.enableIndexSync) {
        const embeddingInstance = await this.embeddingsManager.getEmbeddingsAPI();
        await this.oramaBackend.reinitializeForIndexSyncChange(embeddingInstance);
      }
    };

    subscribeToSettingsChange(() => {
      this.initializationPromise = reinitialize();
    });
  }

  private async initialize(): Promise<void> {
    // Do not initialize or show notices if semantic search is disabled
    const settings = getSettings();
    if (!settings.enableSemanticSearchV3) {
      return;
    }
    try {
      let retries = 3;
      while (retries > 0) {
        try {
          const embeddingAPI = await this.embeddingsManager.getEmbeddingsAPI();
          await this.indexBackend.initialize(embeddingAPI);
          break;
        } catch (error) {
          if (
            error instanceof CustomError &&
            error.message.includes("Vault adapter not available")
          ) {
            retries--;
            if (retries > 0) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              continue;
            }
          }
          new Notice(
            "Failed to initialize vector store. Please make sure you have a valid API key " +
              "for your embedding model and restart the plugin."
          );
          console.error("Failed to initialize vector store:", error);
          break;
        }
      }
    } catch (error) {
      console.error("Failed to initialize vector store:", error);
    }
  }

  private async waitForInitialization(): Promise<void> {
    await this.initializationPromise;
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
    await this.indexBackend.clearIndex(await this.embeddingsManager.getEmbeddingsAPI());
  }

  public async garbageCollectVectorStore(): Promise<number> {
    await this.waitForInitialization();
    return this.indexBackend.garbageCollect();
  }

  public async getIndexedFiles(): Promise<string[]> {
    await this.waitForInitialization();
    return this.indexBackend.getIndexedFiles();
  }

  public async isIndexEmpty(): Promise<boolean> {
    await this.waitForInitialization();
    return await this.indexBackend.isIndexEmpty();
  }

  public async hasIndex(notePath: string): Promise<boolean> {
    await this.waitForInitialization();
    return this.indexBackend.hasIndex(notePath);
  }

  public onunload(): void {
    this.eventHandler.cleanup();
    this.indexBackend.onunload();
  }

  public async getDbOps(): Promise<DBOperations> {
    await this.waitForInitialization();
    return this.oramaBackend.getDbOperations();
  }

  public async getDb(): Promise<Orama<any>> {
    await this.waitForInitialization();
    const db = this.oramaBackend.getDb();
    if (!db) {
      throw new Error("Database is not loaded. Please restart the plugin.");
    }
    return db;
  }

  public async reindexFile(file: TFile): Promise<void> {
    await this.waitForInitialization();
    await this.indexOps.reindexFile(file);
  }
}
