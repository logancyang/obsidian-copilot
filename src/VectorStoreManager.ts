// src/VectorStoreManager.ts

import { LangChainParams } from "@/aiParams";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import EncryptionService from "@/encryptionService";
import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { CopilotSettings } from "@/settings/SettingsPage";
import { areEmbeddingModelsSame, isPathInList } from "@/utils";
import VectorDBManager, { VectorStoreDocument } from "@/vectorDBManager";
import { MD5 } from "crypto-js";
import { App, Notice } from "obsidian";
import PouchDB from "pouchdb-browser";

class VectorStoreManager {
  private app: App;
  private settings: CopilotSettings;
  private encryptionService: EncryptionService;
  private dbVectorStores: PouchDB.Database<VectorStoreDocument>;
  private embeddingsManager: EmbeddingsManager;
  private getLangChainParams: () => LangChainParams;

  private isIndexingPaused = false;
  private isIndexingCancelled = false;
  private currentIndexingNotice: Notice | null = null;
  private indexNoticeMessage: HTMLSpanElement | null = null;
  private indexedCount = 0;
  private totalFilesToIndex = 0;

  constructor(
    app: App,
    settings: CopilotSettings,
    encryptionService: EncryptionService,
    getLangChainParams: () => LangChainParams
  ) {
    this.app = app;
    this.settings = settings;
    this.encryptionService = encryptionService;
    this.getLangChainParams = getLangChainParams;

    this.initializeDB();
    this.embeddingsManager = EmbeddingsManager.getInstance(
      this.getLangChainParams,
      this.encryptionService,
      this.settings.activeEmbeddingModels
    );

    // Initialize the rate limiter
    VectorDBManager.initialize({
      getEmbeddingRequestsPerSecond: () => this.settings.embeddingRequestsPerSecond,
      debug: this.settings.debug,
    });

    // Optionally index the vault on startup
    if (this.settings.indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_STARTUP) {
      this.indexVaultToVectorStore().catch((err) => {
        console.error("Error indexing vault to vector store on startup:", err);
        new Notice("An error occurred while indexing vault to vector store.");
      });
    }
  }

  private initializeDB() {
    this.dbVectorStores = new PouchDB<VectorStoreDocument>(
      `copilot_vector_stores_${this.getVaultIdentifier()}`
    );
  }

  private getVaultIdentifier(): string {
    const vaultName = this.app.vault.getName();
    return MD5(vaultName).toString();
  }

  public getDbVectorStores(): PouchDB.Database<VectorStoreDocument> {
    return this.dbVectorStores;
  }

  public getEmbeddingsManager(): EmbeddingsManager {
    return this.embeddingsManager;
  }

  public pauseIndexing() {
    this.isIndexingPaused = true;
    this.updateIndexingNoticeMessage();
  }

  public resumeIndexing() {
    this.isIndexingPaused = false;
    this.updateIndexingNoticeMessage();
  }

  private updateIndexingNoticeMessage() {
    if (this.indexNoticeMessage) {
      const status = this.isIndexingPaused ? " (Paused)" : "";
      this.indexNoticeMessage.textContent = `Copilot is indexing your vault...\n${this.indexedCount}/${this.totalFilesToIndex} files processed.${status}\nExclusion paths: ${
        this.settings.qaExclusionPaths ? this.settings.qaExclusionPaths : "None"
      }`;
    }
  }

  private createIndexingNotice(): Notice {
    const frag = document.createDocumentFragment();
    const container = frag.createEl("div", { cls: "copilot-notice-container" });

    this.indexNoticeMessage = container.createEl("div", { cls: "copilot-notice-message" });
    this.updateIndexingNoticeMessage();

    const pauseButton = frag.createEl("button");
    pauseButton.textContent = "Pause";
    pauseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (this.isIndexingPaused) {
        this.resumeIndexing();
        pauseButton.textContent = "Pause";
      } else {
        this.pauseIndexing();
        pauseButton.textContent = "Resume";
      }
    });

    frag.appendChild(this.indexNoticeMessage);
    frag.appendChild(pauseButton);

    return new Notice(frag, 0);
  }

  public async indexVaultToVectorStore(overwrite?: boolean): Promise<number> {
    let rateLimitNoticeShown = false;

    try {
      const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance) {
        throw new CustomError("Embedding instance not found.");
      }

      // Check if embedding model has changed
      const prevEmbeddingModel = await VectorDBManager.checkEmbeddingModel(this.dbVectorStores);
      // TODO: Remove this when Ollama model is dynamically set
      const currEmbeddingModel = EmbeddingsManager.getModelName(embeddingInstance);

      if (this.settings.debug) {
        console.log(
          `\nVault QA exclusion paths: ${this.settings.qaExclusionPaths ? this.settings.qaExclusionPaths : "None"}`
        );
        console.log("Prev vs Current embedding models:", prevEmbeddingModel, currEmbeddingModel);
      }

      if (!areEmbeddingModelsSame(prevEmbeddingModel, currEmbeddingModel)) {
        // Model has changed, clear DB and reindex from scratch
        overwrite = true;
        // Clear the current vector store with mixed embeddings
        try {
          // Clear the vectorstore db
          await this.dbVectorStores.destroy();
          // Reinitialize the database
          this.dbVectorStores = new PouchDB<VectorStoreDocument>(
            `copilot_vector_stores_${this.getVaultIdentifier()}`
          );
          new Notice("Detected change in embedding model. Rebuild vector store from scratch.");
          console.log("Detected change in embedding model. Rebuild vector store from scratch.");
        } catch (err) {
          console.error("Error clearing vector store for reindexing:", err);
          new Notice("Error clearing vector store for reindexing.");
        }
      }

      const latestMtime = await VectorDBManager.getLatestFileMtime(this.dbVectorStores);
      // Initialize indexing state
      this.isIndexingPaused = false;
      this.isIndexingCancelled = false;

      const files = this.app.vault
        .getMarkdownFiles()
        .filter((file) => {
          if (!latestMtime || overwrite) return true;
          return file.stat.mtime > latestMtime;
        })
        // file not in qaExclusionPaths
        .filter((file) => {
          if (!this.settings.qaExclusionPaths) return true;
          return !isPathInList(file.path, this.settings.qaExclusionPaths);
        });

      const fileContents: string[] = await Promise.all(
        files.map((file) => this.app.vault.cachedRead(file))
      );
      const fileMetadatas = files.map((file) => this.app.metadataCache.getFileCache(file));

      const totalFiles = files.length;
      if (totalFiles === 0) {
        new Notice("Copilot vault index is up-to-date.");
        return 0;
      }

      this.indexedCount = 0;
      this.totalFilesToIndex = totalFiles;

      this.currentIndexingNotice = this.createIndexingNotice();

      const errors: string[] = [];
      for (let index = 0; index < files.length; index++) {
        if (this.isIndexingCancelled) {
          // Handle cancellation if required
          break;
        }

        // Wait if indexing is paused
        while (this.isIndexingPaused) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const file = files[index];

        try {
          const noteFile = {
            basename: file.basename,
            path: file.path,
            mtime: file.stat.mtime,
            content: fileContents[index],
            metadata: fileMetadatas[index]?.frontmatter ?? {},
          };
          await VectorDBManager.indexFile(this.dbVectorStores, embeddingInstance, noteFile);

          this.indexedCount++;
          this.updateIndexingNoticeMessage();
        } catch (err) {
          console.error("Error indexing file:", err);
          errors.push(`Error indexing file: ${file.basename}`);

          // Check if the error is a 429 (Too Many Requests) error
          if (
            err instanceof Error &&
            err.message.includes("Status code: 429") &&
            !rateLimitNoticeShown
          ) {
            // Extract and display the error message from the API response
            const match = err.message.match(/Body: ({.*})/);
            let errorMessage =
              "Embedding API rate limit exceeded. Please try decreasing the requests per second in settings, or wait for the rate limit to reset with your provider.";
            if (match && match[1]) {
              try {
                const errorBody = JSON.parse(match[1]);
                if (errorBody.message) {
                  errorMessage = errorBody.message;
                }
              } catch (parseError) {
                console.error("Error parsing API error message:", parseError);
              }
            }

            // Display the error message as a notice
            new Notice(errorMessage, 5000);
            rateLimitNoticeShown = true;
            // Break the loop to stop further indexing attempts
            break;
          }
        }
      }

      // Hide the notice after completion
      setTimeout(() => {
        this.currentIndexingNotice?.hide();
        this.currentIndexingNotice = null;
        this.indexNoticeMessage = null;
        this.isIndexingPaused = false;
        this.isIndexingCancelled = false;
      }, 3000);

      if (errors.length > 0) {
        new Notice(`Indexing completed with errors. Check the console for details.`);
        console.log("Indexing Errors:", errors.join("\n"));
      }
      return files.length;
    } catch (error) {
      if (error instanceof CustomError) {
        console.error("Error indexing vault to vector store:", error.msg);
        new Notice(
          `Error indexing vault: ${error.msg}. Please check your embedding model settings.`
        );
      } else {
        console.error("Unexpected error indexing vault to vector store:", error);
        new Notice(
          "An unexpected error occurred while indexing the vault. Please check the console for details."
        );
      }
      return 0;
    }
  }

  public async clearVectorStore(): Promise<void> {
    try {
      await this.dbVectorStores.destroy();
      this.initializeDB();
      new Notice("Local vector store cleared successfully.");
      console.log("Local vector store cleared successfully, new instance created.");
    } catch (err) {
      console.error("Error clearing the local vector store:", err);
      new Notice("An error occurred while clearing the local vector store.");
      throw err;
    }
  }

  public async garbageCollectVectorStore(): Promise<void> {
    try {
      const files = this.app.vault.getMarkdownFiles();
      const filePaths = files.map((file) => file.path);
      const indexedFiles = await VectorDBManager.getNoteFiles(this.dbVectorStores);
      const indexedFilePaths = indexedFiles.map((file) => file.path);
      const filesToDelete = indexedFilePaths.filter((filePath) => !filePaths.includes(filePath));

      const deletePromises = filesToDelete.map(async (filePath) => {
        VectorDBManager.removeMemoryVectors(
          this.dbVectorStores,
          VectorDBManager.getDocumentHash(filePath)
        );
      });

      await Promise.all(deletePromises);

      new Notice("Local vector store garbage collected successfully.");
      console.log("Local vector store garbage collected successfully.");
    } catch (err) {
      console.error("Error garbage collecting the vector store:", err);
      new Notice("An error occurred while garbage collecting the vector store.");
    }
  }

  public registerEventHandlers() {
    // Handle file deletion
    this.app.vault.on("delete", (file) => {
      const docHash = VectorDBManager.getDocumentHash(file.path);
      VectorDBManager.removeMemoryVectors(this.dbVectorStores, docHash);
    });
  }

  // Add other methods as needed...
}

export default VectorStoreManager;
