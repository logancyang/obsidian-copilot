import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { RateLimiter } from "@/rateLimiter";
import { Embeddings } from "@langchain/core/embeddings";
import { Orama, search, update } from "@orama/orama";
import { MD5 } from "crypto-js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

interface VectorDBConfig {
  getEmbeddingRequestsPerSecond: () => number;
  debug: boolean;
}

class VectorDBManager {
  private static rateLimiter: RateLimiter;
  private static config: VectorDBConfig;

  public static initialize(config: VectorDBConfig) {
    this.config = config;
  }

  private static getRateLimiter(): RateLimiter {
    if (!this.config) {
      throw new Error("VectorDBManager not initialized. Call initialize() first.");
    }
    const requestsPerSecond = this.config.getEmbeddingRequestsPerSecond();
    if (!this.rateLimiter || this.rateLimiter.getRequestsPerSecond() !== requestsPerSecond) {
      this.rateLimiter = new RateLimiter(requestsPerSecond);
    }
    return this.rateLimiter;
  }

  public static getDocHash(sourceDocument: string): string {
    return MD5(sourceDocument).toString();
  }

  public static async indexFile(
    db: Orama<any>,
    embeddingsAPI: Embeddings,
    fileToSave: any
  ): Promise<any | undefined> {
    if (!db) throw new Error("DB not initialized");
    if (!this.config) throw new Error("VectorDBManager not initialized");

    const embeddingModel = EmbeddingManager.getModelName(embeddingsAPI);
    if (!embeddingModel) console.error("EmbeddingManager could not determine model name!");

    // Markdown splitter: https://js.langchain.com/docs/modules/data_connection/document_transformers/code_splitter#markdown
    const textSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: 5000,
    });
    // Add note title as contextual chunk headers
    // https://js.langchain.com/docs/modules/data_connection/document_transformers/contextual_chunk_headers
    const chunks = await textSplitter.createDocuments([fileToSave.content], [], {
      chunkHeader: "[[" + fileToSave.basename + "]]" + "\n\n---\n\n",
      appendChunkOverlapHeader: true,
    });

    // Apply rate limiting before making the API call
    await this.getRateLimiter().wait();
    const docVectors = await embeddingsAPI.embedDocuments(chunks.map((chunk) => chunk.pageContent));

    const chunkWithVectors = docVectors.map((docVector, i) => ({
      content: chunks[i].pageContent,
      embedding: docVector,
    }));

    for (const chunkWithVector of chunkWithVectors) {
      const docHash = VectorDBManager.getDocHash(chunkWithVector.content);
      try {
        // Prepare the document to be saved.
        const docToSave: any = {
          id: docHash,
          title: fileToSave.title,
          content: chunkWithVector.content,
          embedding: chunkWithVector.embedding,
          path: fileToSave.path,
          embeddingModel: fileToSave.embeddingModel,
          created_at: Date.now(),
          ctime: fileToSave.ctime,
          mtime: fileToSave.mtime,
          tags: fileToSave.tags,
          extension: fileToSave.extension,
          metadata: fileToSave.metadata,
        };

        // Save the document.
        await this.upsert(db, docToSave);
      } catch (err) {
        console.error("Error storing vectors in VectorDB:", err);
      }
    }
  }

  public static async upsert(db: Orama<any>, docToSave: any): Promise<any | undefined> {
    if (!db) throw new Error("DB not initialized");
    if (!this.config) throw new Error("VectorDBManager not initialized");

    // If the document already exists, update it.
    // Otherwise, insert it.
    await update(db, docToSave, {
      id: docToSave.id,
    });
  }

  public static async getDocsByPath(db: Orama<any>, path: string): Promise<any | undefined> {
    if (!db) throw new Error("DB not initialized");
    if (!this.config) throw new Error("VectorDBManager not initialized");

    const result = await search(db, {
      term: path,
      properties: ["path"],
      limit: 1,
    });

    return result.hits;
  }

  public static async getLatestFileMtime(db: Orama<any>): Promise<number> {
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
}

export default VectorDBManager;
