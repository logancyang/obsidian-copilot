import { LangChainParams } from "@/aiParams";
import EncryptionService from "@/encryptionService";
import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { CopilotSettings } from "@/settings/SettingsPage";
import { areEmbeddingModelsSame, getNotesFromTags, isPathInList } from "@/utils";
import VectorDBManager from "@/vectorDBManager";
import { Embeddings } from "@langchain/core/embeddings";
import { create, load, Orama, remove, removeMultiple, save, search } from "@orama/orama";
import { MD5 } from "crypto-js";
import { App, Notice } from "obsidian";
import { VAULT_VECTOR_STORE_STRATEGY } from "./constants";

class VectorStoreManager {
  private app: App;
  private settings: CopilotSettings;
  private encryptionService: EncryptionService;
  private oramaDb: Orama<any>;
  private dbPath: string;
  private embeddingsManager: EmbeddingsManager;
  private getLangChainParams: () => LangChainParams;

  private isIndexingPaused = false;
  private isIndexingCancelled = false;
  private currentIndexingNotice: Notice | null = null;
  private indexNoticeMessage: HTMLSpanElement | null = null;
  private indexedCount = 0;
  private totalFilesToIndex = 0;
  private initializationPromise: Promise<void>;
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

    this.dbPath = this.getDbPath();
    this.embeddingsManager = EmbeddingsManager.getInstance(
      this.getLangChainParams,
      this.encryptionService,
      this.settings.activeEmbeddingModels
    );

    // Initialize the database asynchronously
    this.initializationPromise = this.initializeDB()
      .then((db) => {
        this.oramaDb = db;
        console.log("Copilot database initialized successfully.");

        // Perform any operations that depend on the initialized database here
        this.performPostInitializationTasks();
      })
      .catch((error) => {
        console.error("Failed to initialize Copilot database:", error);
      });

    // Initialize the rate limiter
    VectorDBManager.initialize({
      getEmbeddingRequestsPerSecond: () => this.settings.embeddingRequestsPerSecond,
      debug: this.settings.debug,
    });
  }

  private async performPostInitializationTasks() {
    // Optionally index the vault on startup
    if (this.settings.indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_STARTUP) {
      try {
        await this.indexVaultToVectorStore();
      } catch (err) {
        console.error("Error indexing vault to vector store on startup:", err);
        new Notice("An error occurred while indexing vault to vector store.");
      }
    }
  }

  private getDbPath(): string {
    return `${this.app.vault.configDir}/copilot-index-${this.getVaultIdentifier()}.json`;
  }

  private createDynamicSchema(vectorLength: number) {
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

  private async initializeDB(): Promise<Orama<any>> {
    this.dbPath = this.getDbPath();
    // Ensure the config directory exists
    const configDir = this.app.vault.configDir;
    if (!(await this.app.vault.adapter.exists(configDir))) {
      console.log(`Config directory does not exist. Creating: ${configDir}`);
      await this.app.vault.adapter.mkdir(configDir);
    }

    try {
      if (await this.app.vault.adapter.exists(this.dbPath)) {
        // Load existing database
        const savedDb = await this.app.vault.adapter.read(this.dbPath);
        const parsedDb = JSON.parse(savedDb);

        // Create a new database with the same schema as the saved one
        const schema = parsedDb.schema;
        const newDb = await create({ schema });

        // Load the data into the new database
        await load(newDb, parsedDb);

        console.log(`Loaded existing Orama database for ${this.dbPath} from disk.`);
        return newDb;
      } else {
        // Create new database
        return await this.createNewDb();
      }
    } catch (error) {
      console.error(`Error initializing Orama database:`, error);
      return await this.createNewDb();
    }
  }

  private async createNewDb(): Promise<Orama<any>> {
    const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingInstance) {
      throw new CustomError("Embedding instance not found.");
    }

    const vectorLength = await this.getVectorLength(embeddingInstance);
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
    return db;
  }

  private async getVectorLength(embeddingInstance: Embeddings): Promise<number> {
    const sampleText = "Sample text for embedding";
    const sampleEmbedding = await embeddingInstance.embedQuery(sampleText);
    return sampleEmbedding.length;
  }

  private async ensureCorrectSchema(db: Orama<any>, embeddingInstance: Embeddings): Promise<void> {
    const currentVectorLength = await this.getVectorLength(embeddingInstance);
    const dbSchema = db.schema;

    if (dbSchema.embedding !== `vector[${currentVectorLength}]`) {
      console.log(
        `Schema mismatch detected. Rebuilding database with new vector length: ${currentVectorLength}`
      );
      await this.clearVectorStore();
    }
  }

  private async saveDB() {
    try {
      const rawData = await save(this.oramaDb);
      const dataToSave = {
        schema: this.oramaDb.schema,
        ...rawData,
      };
      await this.app.vault.adapter.write(this.dbPath, JSON.stringify(dataToSave));
      console.log(`Saved Orama database to ${this.dbPath}.`);
    } catch (error) {
      console.error(`Error saving Orama database to ${this.dbPath}:`, error);
    }
  }

  private getVaultIdentifier(): string {
    const vaultName = this.app.vault.getName();
    return MD5(vaultName).toString();
  }

  public getDb(): Orama<any> {
    return this.oramaDb;
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
      this.indexNoticeMessage.textContent = `Copilot is indexing your vault...\n${this.indexedCount}/${this.totalFilesToIndex} files processed.${status}\nExclusions: ${
        this.settings.qaExclusions ? this.settings.qaExclusions : "None"
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

  private async getExcludedFiles(): Promise<Set<string>> {
    const excludedFiles = new Set<string>();

    if (this.settings.qaExclusions) {
      const exclusions = this.settings.qaExclusions.split(",").map((item) => item.trim());

      for (const exclusion of exclusions) {
        if (exclusion.startsWith("#")) {
          // Tag-based exclusion
          const tagName = exclusion.slice(1);
          const taggedFiles = await getNotesFromTags(this.app.vault, [tagName]);
          taggedFiles.forEach((file) => excludedFiles.add(file.path));
        } else if (exclusion.startsWith("*")) {
          // File-extension-based exclusion
          const extensionName = exclusion.slice(1);
          this.app.vault.getFiles().forEach((file) => {
            if (file.name.toLowerCase().contains(extensionName.toLowerCase())) {
              excludedFiles.add(file.path);
            }
          });
        } else {
          // Path-based exclusion
          this.app.vault.getFiles().forEach((file) => {
            if (isPathInList(file.path, exclusion)) {
              excludedFiles.add(file.path);
            }
          });
        }
      }
    }

    return excludedFiles;
  }

  public async indexVaultToVectorStore(overwrite?: boolean): Promise<number> {
    await this.waitForInitialization();
    let rateLimitNoticeShown = false;

    try {
      const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance) {
        throw new CustomError("Embedding instance not found.");
      }
      await this.ensureCorrectSchema(this.oramaDb, embeddingInstance);

      const singleDoc = await search(this.getDb(), {
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
          // Model has changed, reinitialize DB
          await this.initializeDB();
          overwrite = true;
          new Notice("Detected change in embedding model. Rebuilding vector store from scratch.");
          console.log("Detected change in embedding model. Rebuilding vector store from scratch.");
        }
      } else {
        console.log("No previous embedding model found in the database.");
      }

      const latestMtime = await VectorDBManager.getLatestFileMtime(this.oramaDb);
      // Initialize indexing state
      this.isIndexingPaused = false;
      this.isIndexingCancelled = false;

      const excludedFiles = await this.getExcludedFiles();

      const files = this.app.vault
        .getMarkdownFiles()
        .filter((file) => {
          if (!latestMtime || overwrite) return true;
          return file.stat.mtime > latestMtime;
        })
        .filter((file) => !excludedFiles.has(file.path));

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
          const fileToSave = {
            title: file.basename,
            path: file.path,
            content: fileContents[index],
            embeddingModel: EmbeddingsManager.getModelName(embeddingInstance),
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            tags: fileMetadatas[index]?.tags ?? [], // Assuming tags are in the metadata
            extension: file.extension,
            metadata: fileMetadatas[index]?.frontmatter ?? {},
          };
          await VectorDBManager.indexFile(this.oramaDb, embeddingInstance, fileToSave);

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
            new Notice(errorMessage, 8000);
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
        this.saveDB();
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
      // Create a new, empty database instance
      this.oramaDb = await this.createNewDb();

      // Save the new, empty database
      await this.saveDB();
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
      const filePaths = new Set(files.map((file) => file.path));

      // Search for all documents in the database
      const result = await search(this.oramaDb, {
        term: "",
        properties: ["path"],
        limit: Infinity,
      });

      const docsToRemove = result.hits
        .filter((hit) => !filePaths.has(hit.document.path))
        .map((hit) => hit.id);

      if (docsToRemove.length === 0) {
        console.log("No documents to remove during garbage collection.");
        return;
      }

      if (docsToRemove.length === 1) {
        await remove(this.oramaDb, docsToRemove[0]);
      } else {
        const removedCount = await removeMultiple(this.oramaDb, docsToRemove, 500);
        console.log(`Removed ${removedCount} documents during garbage collection.`);
      }

      await this.saveDB();

      new Notice("Local vector store garbage collected successfully.");
      console.log("Local vector store garbage collected successfully.");
    } catch (err) {
      console.error("Error garbage collecting the vector store:", err);
      new Notice("An error occurred while garbage collecting the vector store.");
    }
  }

  public async removeDocs(filePath: string) {
    // Handle file deletion
    try {
      const searchResult = await search(this.oramaDb, {
        term: filePath,
        properties: ["path"],
        tolerance: 1,
      });
      if (searchResult.hits.length > 0) {
        await removeMultiple(
          this.oramaDb,
          searchResult.hits.map((hit) => hit.id),
          500
        );
      }
    } catch (err) {
      console.error("Error deleting document from local Copilotindex:", err);
    }
  }

  public async waitForInitialization() {
    await this.initializationPromise;
  }

  // Test query to retrieve record by id from the database
  public async getDocById(id: string): Promise<any | undefined> {
    const result = await search(this.oramaDb, {
      term: id,
      properties: ["id"],
      limit: 1,
      includeVectors: true,
    });
    return result.hits[0]?.document;
  }
}

export default VectorStoreManager;
