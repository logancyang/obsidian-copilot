import { CHUNK_SIZE } from "@/constants";
import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { RateLimiter } from "@/rateLimiter";
import { getSettings } from "@/settings/model";
import { Embeddings } from "@langchain/core/embeddings";
import { insert, Orama, remove, search } from "@orama/orama";
import { MD5 } from "crypto-js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Notice } from "obsidian";

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

class VectorDBManager {
  private static rateLimiter: RateLimiter;
  private static errorMessageShown: Set<string> = new Set<string>();

  private static getRateLimiter(): RateLimiter {
    const requestsPerSecond = getSettings().embeddingRequestsPerSecond;
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

    const embeddingModel = EmbeddingManager.getModelName(embeddingsAPI);
    if (!embeddingModel) console.error("EmbeddingManager could not determine model name!");

    // Markdown splitter: https://js.langchain.com/docs/modules/data_connection/document_transformers/code_splitter#markdown
    const textSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: CHUNK_SIZE,
    });
    // Add note title as contextual chunk headers
    // https://js.langchain.com/docs/modules/data_connection/document_transformers/contextual_chunk_headers
    const chunks = await textSplitter.createDocuments([fileToSave.content], [], {
      chunkHeader: "\n\nNOTE TITLE: [[" + fileToSave.title + "]]" + "\n\nNOTE BLOCK CONTENT:\n\n",
      appendChunkOverlapHeader: true,
    });

    const docVectors: number[][] = [];
    let hasEmbeddingError = false;

    try {
      for (let i = 0; i < chunks.length; i++) {
        try {
          await this.getRateLimiter().wait();
          const embedding = await embeddingsAPI.embedDocuments([chunks[i].pageContent]);

          if (embedding.length > 0 && embedding[0].length > 0) {
            docVectors.push(embedding[0]);
          } else {
            throw new Error("Received empty embedding vector");
          }
        } catch (error) {
          hasEmbeddingError = true;

          // Show notice for all types of errors, but only once per unique error message
          if (!this.errorMessageShown.has(error.message)) {
            new Notice(
              `Indexing failed for "${fileToSave.title}". Check the console for more details. If this persists, try reducing requests per second in settings.`,
              10000
            );
            this.errorMessageShown.add(error.message);
          }

          console.error("indexFile - Error during embeddings API call for chunk:", {
            file: fileToSave.title,
            index: i,
            length: chunks[i].pageContent.length,
            error: error,
          });
        }
      }

      // Only proceed with saving if we have valid vectors
      if (docVectors.length > 0) {
        const chunkWithVectors = chunks.slice(0, docVectors.length).map((chunk, i) => ({
          id: VectorDBManager.getDocHash(chunk.pageContent),
          content: chunk.pageContent,
          embedding: docVectors[i],
        }));

        for (const chunkWithVector of chunkWithVectors) {
          try {
            // Prepare and save document as before
            const docToSave: OramaDocument = {
              id: chunkWithVector.id,
              title: fileToSave.title,
              content: chunkWithVector.content,
              embedding: chunkWithVector.embedding,
              path: fileToSave.path,
              embeddingModel: embeddingModel,
              created_at: Date.now(),
              ctime: fileToSave.ctime,
              mtime: fileToSave.mtime,
              tags: Array.isArray(fileToSave.tags) ? fileToSave.tags : [],
              extension: fileToSave.extension,
              nchars: chunkWithVector.content.length,
              metadata: fileToSave.metadata,
            };

            docToSave.tags = docToSave.tags.map((tag: any) => String(tag));
            await this.upsert(db, docToSave);
          } catch (err) {
            console.error("Error storing vectors in VectorDB:", err);
            // Continue with next chunk even if one fails
          }
        }
      }

      // Return undefined if we had embedding errors, otherwise return fileToSave
      return hasEmbeddingError ? undefined : fileToSave;
    } catch (error) {
      console.error("indexFile - Unexpected error during embedding process:", error);
      new Notice(`indexFile - Unexpected error during embedding process: ${error}`);
      return undefined;
    }
  }

  public static async upsert(db: Orama<any>, docToSave: any): Promise<any | undefined> {
    if (!db) throw new Error("DB not initialized");

    try {
      // Check if the document already exists
      const existingDoc = await search(db, {
        term: docToSave.id,
        properties: ["id"],
        limit: 1,
      });

      if (existingDoc.hits.length > 0) {
        // First remove the existing document
        await remove(db, existingDoc.hits[0].id);
        // Then insert the new version
        await insert(db, docToSave);

        if (getSettings().debug) {
          console.log(`Updated document ${docToSave.id} in VectorDB with path: ${docToSave.path}`);
        }
      } else {
        // Document doesn't exist, insert it
        await insert(db, docToSave);
        if (getSettings().debug) {
          console.log(`Inserted document ${docToSave.id} in VectorDB with path: ${docToSave.path}`);
        }
      }
    } catch (err) {
      console.error(`Error upserting document ${docToSave.id} in VectorDB:`, err);
      // Instead of throwing, we'll return undefined to indicate failure
      return undefined;
    }

    return docToSave;
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
}

export default VectorDBManager;
