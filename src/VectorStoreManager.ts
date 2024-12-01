import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { getSettings } from "@/settings/model";
import { areEmbeddingModelsSame, getFilePathsFromPatterns } from "@/utils";
import VectorDBManager from "@/vectorDBManager";
import { Embeddings } from "@langchain/core/embeddings";
import { create, load, Orama, remove, removeMultiple, save, search } from "@orama/orama";
import { MD5 } from "crypto-js";
import { App, Notice, Platform, TAbstractFile, TFile, Vault } from "obsidian";
import { getChainType } from "./aiParams";
import { ChainType } from "./chainFactory";
import { VAULT_VECTOR_STORE_STRATEGY } from "./constants";

class VectorStoreManager {
  private app: App;
  private oramaDb: Orama<any> | undefined;
  private dbPath: string;
  private embeddingsManager: EmbeddingsManager;

  private isIndexingPaused = false;
  private isIndexingCancelled = false;
  private currentIndexingNotice: Notice | null = null;
  private indexNoticeMessage: HTMLSpanElement | null = null;
  private indexedCount = 0;
  private totalFilesToIndex = 0;
  private initializationPromise: Promise<void>;
  private isIndexLoaded = false;
  private excludedFiles: Set<string> = new Set();

  private debounceDelay = 10000; // 10 seconds
  private debounceTimer: number | null = null;
  private saveDBTimer: number | null = null;
  private saveDBDelay = 30000; // Save full DB every 30 seconds
  private hasUnsavedChanges = false;

  constructor(app: App) {
    this.app = app;

    this.dbPath = this.getDbPath();
    this.embeddingsManager = EmbeddingsManager.getInstance();

    // Initialize the database asynchronously
    this.initializationPromise = this.initializeDB()
      .then((db) => {
        this.oramaDb = db;
        if (db) {
          console.log("Copilot database initialized successfully.");
        } else {
          console.log("Copilot index is disabled on mobile devices.");
        }

        // Perform any operations that depend on the initialized database here
        this.performPostInitializationTasks();
      })
      .catch((error) => {
        console.error("Failed to initialize Copilot database:", error);
      });

    this.updateExcludedFiles();

    // Initialize periodic save
    this.initializePeriodicSave();
  }

  private initializePeriodicSave() {
    // Clear any existing timer
    if (this.saveDBTimer !== null) {
      window.clearInterval(this.saveDBTimer);
    }

    // Set up periodic save
    this.saveDBTimer = window.setInterval(() => {
      if (this.hasUnsavedChanges) {
        this.saveDB();
        this.hasUnsavedChanges = false;
      }
    }, this.saveDBDelay);
  }

  private async performPostInitializationTasks() {
    // Optionally index the vault on startup
    if (getSettings().indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_STARTUP) {
      try {
        await this.indexVaultToVectorStore();
      } catch (err) {
        console.error("Error indexing vault to Copilot index on startup:", err);
        new Notice("An error occurred while indexing vault to Copilot index.");
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

  private async initializeDB(): Promise<Orama<any> | undefined> {
    // Check if we should skip index loading on mobile
    if (Platform.isMobile && getSettings().disableIndexOnMobile) {
      console.log("Index loading disabled on mobile device");
      this.isIndexLoaded = false;
      this.oramaDb = undefined;
      return;
    }

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
        this.isIndexLoaded = true;
        return newDb;
      } else {
        // Only create new DB if not on mobile with disabled index
        return await this.createNewDb();
      }
    } catch (error) {
      console.error(`Error initializing Orama database:`, error);
      if (Platform.isMobile && getSettings().disableIndexOnMobile) {
        return;
      }
      return await this.createNewDb();
    }
  }

  public async getIsIndexLoaded(): Promise<boolean> {
    await this.initializationPromise;
    return this.isIndexLoaded;
  }

  private async createNewDb(): Promise<Orama<any>> {
    const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingInstance) {
      throw new CustomError("Embedding instance not found.");
    }

    const vectorLength = await this.getVectorLength(embeddingInstance);
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

  public getVault(): Vault {
    return this.app.vault;
  }

  private async getVectorLength(embeddingInstance: Embeddings): Promise<number> {
    try {
      const sampleText = "Sample text for embedding";
      const sampleEmbedding = await embeddingInstance.embedQuery(sampleText);

      if (!sampleEmbedding || sampleEmbedding.length === 0) {
        throw new CustomError("Failed to get valid embedding vector length");
      }

      console.log(
        `Detected vector length: ${sampleEmbedding.length} for model: ${EmbeddingsManager.getModelName(embeddingInstance)}`
      );
      return sampleEmbedding.length;
    } catch (error) {
      console.error("Error getting vector length:", error);
      throw new CustomError(
        "Failed to determine embedding vector length. Please check your embedding model settings."
      );
    }
  }

  private async ensureCorrectSchema(db: Orama<any>, embeddingInstance: Embeddings): Promise<void> {
    const currentVectorLength = await this.getVectorLength(embeddingInstance);
    const dbSchema = db.schema;

    if (dbSchema.embedding !== `vector[${currentVectorLength}]`) {
      console.log(
        `Schema mismatch detected. Rebuilding database with new vector length: ${currentVectorLength}`
      );
      await this.clearIndex();
    }
  }

  private async saveDB() {
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

      // Use requestIdleCallback if available, otherwise use setTimeout
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

  private getVaultIdentifier(): string {
    const vaultName = this.app.vault.getName();
    return MD5(vaultName).toString();
  }

  public getDb(): Orama<any> | undefined {
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

      const folders = this.extractAppIgnoreSettings();
      const filterType = getSettings().qaInclusions
        ? `Inclusions: ${getSettings().qaInclusions}`
        : `Exclusions: ${folders.join(",") + (folders.length ? ", " : "") + getSettings().qaExclusions || "None"}`;

      this.indexNoticeMessage.textContent =
        `Copilot is indexing your vault...\n` +
        `${this.indexedCount}/${this.totalFilesToIndex} files processed.${status}\n` +
        filterType;
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

  private async getFilePathsForQA(filterType: "exclusions" | "inclusions"): Promise<Set<string>> {
    const targetFiles = new Set<string>();

    if (filterType === "exclusions") {
      const exclusions: string[] = [];

      exclusions.push(...this.extractAppIgnoreSettings());

      if (getSettings().qaExclusions) {
        exclusions.push(
          ...getSettings()
            .qaExclusions.split(",")
            .map((item) => item.trim())
        );
      }

      const excludedFilePaths = await getFilePathsFromPatterns(exclusions, this.app.vault);
      excludedFilePaths.forEach((filePath) => targetFiles.add(filePath));
    } else if (filterType === "inclusions" && getSettings().qaInclusions) {
      const inclusions = getSettings()
        .qaInclusions.split(",")
        .map((item) => item.trim());
      const includedFilePaths = await getFilePathsFromPatterns(inclusions, this.app.vault);
      includedFilePaths.forEach((filePath) => targetFiles.add(filePath));
    }

    return targetFiles;
  }

  private extractAppIgnoreSettings() {
    const appIgnoreFolders: string[] = [];
    try {
      // not documented in Obsidian API, but I got this answer from Obsidian's discord
      const userIgnoreFilters: unknown = (app.vault as any).getConfig("userIgnoreFilters");

      // inherit from the Obsidian "master exclusion" settings
      if (!!userIgnoreFilters && Array.isArray(userIgnoreFilters)) {
        userIgnoreFilters.forEach((it) => {
          if (typeof it === "string") {
            appIgnoreFolders.push(it.endsWith("/") ? it.slice(0, -1) : it);
          }
        });
      }
    } catch (e) {
      console.warn("Error getting userIgnoreFilters from Obsidian config", e);
    }

    return appIgnoreFolders;
  }

  public async getAllQAMarkdownContent(): Promise<string> {
    let allContent = "";

    const includedFiles = await this.getFilePathsForQA("inclusions");
    const excludedFiles = await this.getFilePathsForQA("exclusions");

    const filteredFiles = this.app.vault.getMarkdownFiles().filter((file) => {
      if (includedFiles.size > 0) {
        return includedFiles.has(file.path);
      }
      return !excludedFiles.has(file.path);
    });

    await Promise.all(filteredFiles.map((file) => this.app.vault.cachedRead(file))).then(
      (contents) => contents.map((c) => (allContent += c + " "))
    );

    return allContent;
  }

  private async checkAndHandleEmbeddingModelChange(
    db: Orama<any>,
    embeddingInstance: Embeddings
  ): Promise<boolean> {
    const singleDoc = await search(db, {
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
        this.oramaDb = await this.createNewDb();
        await this.saveDB();
        return true;
      }
    } else {
      console.log("No previous embedding model found in the database.");
    }

    return false;
  }

  public async indexVaultToVectorStore(overwrite?: boolean): Promise<number> {
    // Add check at the start of the method
    await this.waitForInitialization();
    if ((Platform.isMobile && getSettings().disableIndexOnMobile) || !this.oramaDb) {
      new Notice("Indexing is disabled on mobile devices");
      return 0;
    }

    let rateLimitNoticeShown = false;

    try {
      const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance) {
        throw new CustomError("Embedding instance not found.");
      }
      await this.ensureCorrectSchema(this.oramaDb, embeddingInstance);

      // Check for model change
      const modelChanged = await this.checkAndHandleEmbeddingModelChange(
        this.oramaDb,
        embeddingInstance
      );
      if (modelChanged) {
        overwrite = true;
      }

      const latestMtime = await VectorDBManager.getLatestFileMtime(this.oramaDb);
      // Initialize indexing state
      this.isIndexingPaused = false;
      this.isIndexingCancelled = false;

      const includedFiles = await this.getFilePathsForQA("inclusions");
      const excludedFiles = await this.getFilePathsForQA("exclusions");

      const files = this.app.vault
        .getMarkdownFiles()
        .filter((file) => {
          if (!latestMtime || overwrite) return true;
          return file.stat.mtime > latestMtime;
        })
        .filter((file) => {
          if (includedFiles.size > 0) {
            // If inclusions are specified, only include files in the inclusion set
            return includedFiles.has(file.path);
          }
          // Otherwise, use exclusion filter
          return !excludedFiles.has(file.path);
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
          const fileToSave = {
            title: file.basename,
            path: file.path,
            content: fileContents[index],
            embeddingModel: EmbeddingsManager.getModelName(embeddingInstance),
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            tags: fileMetadatas[index]?.tags?.map((tag) => tag.tag) ?? [],
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

      // Set isIndexLoaded to true after successful indexing
      this.isIndexLoaded = true;

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
        console.error("Error indexing vault to Copilot index:", error.msg);
        new Notice(
          `Error indexing vault: ${error.msg}. Please check your embedding model settings.`
        );
      } else {
        console.error("Unexpected error indexing vault to Copilot index:", error);
        new Notice(
          "An unexpected error occurred while indexing the vault. Please check the console for details."
        );
      }
      return 0;
    }
  }

  public async clearIndex(): Promise<void> {
    try {
      // Create a new, empty database instance with fresh schema
      this.oramaDb = await this.createNewDb();

      // Delete the existing database file
      if (await this.app.vault.adapter.exists(this.dbPath)) {
        await this.app.vault.adapter.remove(this.dbPath);
      }

      // Save the new, empty database
      await this.saveDB();
      new Notice("Local Copilot index cleared successfully.");
      console.log("Local Copilot index cleared successfully, new instance created.");
    } catch (err) {
      console.error("Error clearing the local Copilot index:", err);
      new Notice("An error occurred while clearing the local Copilot index.");
      throw err;
    }
  }

  public async garbageCollectVectorStore(): Promise<void> {
    if (!this.oramaDb) {
      throw new CustomError("Orama database not found.");
    }
    try {
      const files = this.app.vault.getMarkdownFiles();
      const filePaths = new Set(files.map((file) => file.path));
      // Get all documents in the database
      const result = await search(this.oramaDb, {
        term: "",
        limit: 10000,
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

  public async removeDocs(filePath: string) {
    if (!this.oramaDb) {
      throw new CustomError("Orama database not found.");
    }
    // Handle file deletion
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
    } catch (err) {
      console.error("Error deleting document from local Copilotindex:", err);
    }
  }

  public async waitForInitialization() {
    await this.initializationPromise;
  }

  // Test query to retrieve record by id from the database
  public async getDocById(id: string): Promise<any | undefined> {
    if (!this.oramaDb) {
      throw new CustomError("Orama database not found.");
    }
    const result = await search(this.oramaDb, {
      term: id,
      properties: ["id"],
      limit: 1,
      includeVectors: true,
    });
    return result.hits[0]?.document;
  }

  public initializeEventListeners() {
    if (getSettings().debug) {
      console.log("Copilot Plus: Initializing event listeners");
    }
    this.app.vault.on("modify", this.handleFileModify);
    this.app.vault.on("delete", this.handleFileDelete);
  }

  private debouncedReindexFile = (file: TFile) => {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      if (getSettings().debug) {
        console.log("Copilot Plus: Triggering reindex for file ", file.path);
      }
      this.reindexFile(file);
      this.debounceTimer = null;
    }, this.debounceDelay);
  };

  private handleFileModify = async (file: TAbstractFile) => {
    await this.updateExcludedFiles();
    const currentChainType = getChainType();
    if (
      file instanceof TFile &&
      file.extension === "md" &&
      !this.excludedFiles.has(file.path) &&
      currentChainType === ChainType.COPILOT_PLUS_CHAIN
    ) {
      this.debouncedReindexFile(file);
    }
  };

  private handleFileDelete = async (file: TAbstractFile) => {
    if (file instanceof TFile) {
      await this.removeDocs(file.path);
    }
  };

  private updateExcludedFiles = async () => {
    this.excludedFiles = await this.getFilePathsForQA("exclusions");
  };

  private async reindexFile(file: TFile) {
    try {
      const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance || !this.oramaDb) {
        return;
      }

      await this.removeDocs(file.path);

      // Check for model change
      const modelChanged = await this.checkAndHandleEmbeddingModelChange(
        this.oramaDb,
        embeddingInstance
      );
      if (modelChanged) {
        await this.indexVaultToVectorStore(true);
        return;
      }

      // Proceed with single file reindex
      const content = await this.app.vault.cachedRead(file);
      const fileCache = this.app.metadataCache.getFileCache(file);

      const fileToSave = {
        title: file.basename,
        path: file.path,
        content: content,
        embeddingModel: EmbeddingsManager.getModelName(embeddingInstance),
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        tags: fileCache?.tags?.map((tag) => tag.tag) ?? [],
        extension: file.extension,
        metadata: fileCache?.frontmatter ?? {},
      };

      await VectorDBManager.indexFile(this.oramaDb, embeddingInstance, fileToSave);
      // Mark that we have unsaved changes instead of saving immediately
      this.hasUnsavedChanges = true;

      if (getSettings().debug) {
        console.log(`Reindexed file: ${file.path}`);
      }
    } catch (error) {
      console.error(`Error reindexing file ${file.path}:`, error);
    }
  }

  // Clean up on unload
  public onunload() {
    if (this.saveDBTimer !== null) {
      window.clearInterval(this.saveDBTimer);
    }
    if (this.hasUnsavedChanges) {
      this.saveDB();
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
}

export default VectorStoreManager;
