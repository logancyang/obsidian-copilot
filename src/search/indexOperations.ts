import { CHUNK_SIZE } from "@/constants";
import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { RateLimiter } from "@/rateLimiter";
import { getSettings } from "@/settings/model";
import { Embeddings } from "@langchain/core/embeddings";
import { Orama } from "@orama/orama";
import { MD5 } from "crypto-js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { App, Notice, TFile } from "obsidian";
import { DBOperations } from "./dbOperations";

export interface IndexingState {
  isIndexingPaused: boolean;
  isIndexingCancelled: boolean;
  indexedCount: number;
  totalFilesToIndex: number;
  currentIndexingNotice: Notice | null;
  indexNoticeMessage: HTMLSpanElement | null;
}

export class IndexOperations {
  private rateLimiter: RateLimiter;
  private state: IndexingState = {
    isIndexingPaused: false,
    isIndexingCancelled: false,
    indexedCount: 0,
    totalFilesToIndex: 0,
    currentIndexingNotice: null,
    indexNoticeMessage: null,
  };

  constructor(
    private app: App,
    private dbOps: DBOperations,
    private embeddingsManager: EmbeddingsManager
  ) {
    this.rateLimiter = new RateLimiter(getSettings().embeddingRequestsPerSecond);
  }

  public async indexFile(db: Orama<any>, file: TFile): Promise<void> {
    const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingInstance) {
      throw new CustomError("Embedding instance not found.");
    }

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

    await this.indexDocument(embeddingInstance, fileToSave);
  }

  private async indexDocument(
    embeddingsAPI: Embeddings,
    fileToSave: any
  ): Promise<any | undefined> {
    const textSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: CHUNK_SIZE,
    });

    // Add note title as contextual chunk headers
    // https://js.langchain.com/docs/modules/data_connection/document_transformers/contextual_chunk_headers
    const chunks = await textSplitter.createDocuments([fileToSave.content], [], {
      chunkHeader: `\n\nNOTE TITLE: [[${fileToSave.title}]]\n\nNOTE BLOCK CONTENT:\n\n`,
      appendChunkOverlapHeader: true,
    });

    const docVectors: number[][] = [];
    let hasEmbeddingError = false;

    for (let i = 0; i < chunks.length; i++) {
      try {
        await this.rateLimiter.wait();
        const embedding = await embeddingsAPI.embedDocuments([chunks[i].pageContent]);

        if (embedding.length > 0 && embedding[0].length > 0) {
          docVectors.push(embedding[0]);
        } else {
          throw new Error("Received empty embedding vector");
        }
      } catch (error) {
        hasEmbeddingError = true;
        console.error("Error during embeddings API call for chunk:", error);
        throw error;
      }
    }

    // Only proceed with saving if we have valid vectors
    if (docVectors.length > 0) {
      const chunkWithVectors = chunks.slice(0, docVectors.length).map((chunk, i) => ({
        id: this.getDocHash(chunk.pageContent),
        content: chunk.pageContent,
        embedding: docVectors[i],
      }));

      for (const chunkWithVector of chunkWithVectors) {
        await this.dbOps.upsert({
          ...fileToSave,
          id: chunkWithVector.id,
          content: chunkWithVector.content,
          embedding: chunkWithVector.embedding,
          created_at: Date.now(),
          nchars: chunkWithVector.content.length,
        });
      }
    }

    return hasEmbeddingError ? undefined : fileToSave;
  }

  public async indexVaultToVectorStore(db: Orama<any>, overwrite?: boolean): Promise<number> {
    let rateLimitNoticeShown = false;

    try {
      const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
      if (!embeddingInstance) {
        throw new CustomError("Embedding instance not found.");
      }

      const files = await this.getFilesToIndex(overwrite);
      if (files.length === 0) {
        new Notice("Copilot vault index is up-to-date.");
        return 0;
      }

      this.initializeIndexingState(files.length);
      this.createIndexingNotice();

      const CHECKPOINT_INTERVAL = 50;
      const errors: string[] = [];

      for (let index = 0; index < files.length; index++) {
        if (this.state.isIndexingCancelled) break;
        await this.handlePause();

        try {
          await this.indexFile(db, files[index]);
          this.updateIndexingNoticeMessage();

          if (this.state.indexedCount % CHECKPOINT_INTERVAL === 0) {
            await this.dbOps.saveDB();
          }
        } catch (err) {
          this.handleIndexingError(err, files[index], errors, rateLimitNoticeShown);
          if (this.isRateLimitError(err)) {
            rateLimitNoticeShown = true;
            break;
          }
        }
      }

      this.finalizeIndexing(errors);
      return files.length;
    } catch (error) {
      this.handleFatalError(error);
      return 0;
    }
  }

  private getDocHash(sourceDocument: string): string {
    return MD5(sourceDocument).toString();
  }

  // TODO: Files to index should include 1. modified files, 2. new files, 3. files that are in the inclusions, or 4. files that are previously excluded but now included
  private async getFilesToIndex(overwrite?: boolean): Promise<TFile[]> {
    const latestMtime = overwrite ? 0 : await this.dbOps.getLatestFileMtime();
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => !latestMtime || overwrite || file.stat.mtime > latestMtime);
  }

  private initializeIndexingState(totalFiles: number) {
    this.state = {
      isIndexingPaused: false,
      isIndexingCancelled: false,
      indexedCount: 0,
      totalFilesToIndex: totalFiles,
      currentIndexingNotice: null,
      indexNoticeMessage: null,
    };
  }

  private createIndexingNotice(): Notice {
    const frag = document.createDocumentFragment();
    const container = frag.createEl("div", { cls: "copilot-notice-container" });

    this.state.indexNoticeMessage = container.createEl("div", { cls: "copilot-notice-message" });
    this.updateIndexingNoticeMessage();

    const pauseButton = frag.createEl("button");
    pauseButton.textContent = "Pause";
    pauseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (this.state.isIndexingPaused) {
        this.resumeIndexing();
        pauseButton.textContent = "Pause";
      } else {
        this.pauseIndexing();
        pauseButton.textContent = "Resume";
      }
    });

    frag.appendChild(this.state.indexNoticeMessage);
    frag.appendChild(pauseButton);

    return new Notice(frag, 0);
  }

  private async handlePause(): Promise<void> {
    while (this.state.isIndexingPaused && !this.state.isIndexingCancelled) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private pauseIndexing(): void {
    this.state.isIndexingPaused = true;
  }

  private resumeIndexing(): void {
    this.state.isIndexingPaused = false;
  }

  private updateIndexingNoticeMessage(): void {
    if (this.state.indexNoticeMessage) {
      this.state.indexNoticeMessage.textContent = `Indexing vault: ${this.state.indexedCount}/${this.state.totalFilesToIndex} files processed`;
    }
    this.state.indexedCount++;
  }

  private handleIndexingError(
    err: any,
    file: TFile,
    errors: string[],
    rateLimitNoticeShown: boolean
  ): void {
    console.error(`Error indexing file ${file.path}:`, err);
    errors.push(file.path);
    if (!rateLimitNoticeShown) {
      new Notice(`Error indexing file ${file.path}. Check console for details.`);
    }
  }

  private isRateLimitError(err: any): boolean {
    return err?.message?.includes?.("rate limit") || false;
  }

  private finalizeIndexing(errors: string[]): void {
    if (this.state.currentIndexingNotice) {
      this.state.currentIndexingNotice.hide();
    }

    if (errors.length > 0) {
      new Notice(`Indexing completed with ${errors.length} errors. Check console for details.`);
    } else {
      new Notice("Indexing completed successfully!");
    }
  }

  private handleFatalError(error: any): void {
    console.error("Fatal error during indexing:", error);
    if (this.state.currentIndexingNotice) {
      this.state.currentIndexingNotice.hide();
    }
    new Notice("Fatal error during indexing. Check console for details.");
  }
}
