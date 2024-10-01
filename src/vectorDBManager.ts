import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { RateLimiter } from "@/rateLimiter";
import { Embeddings } from "@langchain/core/embeddings";
import { MD5 } from "crypto-js";
import { Document } from "langchain/document";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";

// TODOs
// 1. Use embeddingModel rather than embeddingProvider
// 2. embeddingModel should be on MemoryVector metadata
// 3. VectorDBManager should have a public method checking existing embeddingModel on a MemoryVector
export interface VectorStoreDocument {
  _id: string;
  _rev?: string;
  memory_vectors: string;
  file_mtime: number;
  embeddingModel: string;
  created_at: number;
}

export interface MemoryVector {
  content: string;
  embedding: number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
}

export interface NoteFile {
  path: string;
  basename: string;
  mtime: number;
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
}

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
  public static getDocumentHash(sourceDocument: string): string {
    return MD5(sourceDocument).toString();
  }

  public static async rebuildMemoryVectorStore(
    memoryVectors: MemoryVector[],
    embeddingsAPI: Embeddings
  ) {
    if (!Array.isArray(memoryVectors)) {
      throw new TypeError("Expected memoryVectors to be an array");
    }
    // Extract the embeddings and documents from the deserialized memoryVectors
    const embeddingsArray: number[][] = memoryVectors.map((memoryVector) => memoryVector.embedding);
    const documentsArray = memoryVectors.map(
      (memoryVector) =>
        new Document({
          pageContent: memoryVector.content,
          metadata: memoryVector.metadata,
        })
    );

    // Create a new MemoryVectorStore instance
    const memoryVectorStore = new MemoryVectorStore(embeddingsAPI);
    await memoryVectorStore.addVectors(embeddingsArray, documentsArray);
    return memoryVectorStore;
  }

  public static async getMemoryVectorStore(
    db: PouchDB.Database,
    embeddingsAPI: Embeddings,
    docHash?: string
  ): Promise<MemoryVectorStore> {
    if (!db) throw new Error("DB not initialized");

    let allDocsResponse;
    if (docHash) {
      // Fetch a single document by its _id
      const doc = await db.get(docHash);
      allDocsResponse = { rows: [{ doc }] };
    } else {
      // Fetch all documents
      allDocsResponse = await db.allDocs({ include_docs: true });
    }

    const embeddingModel = EmbeddingManager.getModelName(embeddingsAPI);
    if (!embeddingModel) console.error("EmbeddingManager could not determine model name!");
    const allDocs = allDocsResponse.rows
      .map((row) => row.doc as VectorStoreDocument)
      .filter((doc) => doc.embeddingModel === embeddingModel);
    const memoryVectors = allDocs
      .map((doc) => JSON.parse(doc.memory_vectors) as MemoryVector[])
      .flat();
    const embeddingsArray: number[][] = memoryVectors.map((memoryVector) => memoryVector.embedding);
    const documentsArray = memoryVectors.map(
      (memoryVector) =>
        new Document({
          pageContent: memoryVector.content,
          metadata: memoryVector.metadata,
        })
    );
    // Create a new MemoryVectorStore instance
    const memoryVectorStore = new MemoryVectorStore(embeddingsAPI);
    await memoryVectorStore.addVectors(embeddingsArray, documentsArray);
    return memoryVectorStore;
  }

  public static async setMemoryVectors(
    db: PouchDB.Database,
    memoryVectors: MemoryVector[],
    docHash: string
  ): Promise<void> {
    if (!db) throw new Error("DB not initialized");
    if (!Array.isArray(memoryVectors)) {
      throw new TypeError("Expected memoryVectors to be an array");
    }
    const serializedMemoryVectors = JSON.stringify(memoryVectors);
    try {
      // Attempt to fetch the existing document, if it exists.
      const existingDoc = await db.get(docHash).catch((err) => null);

      // Prepare the document to be saved.
      const docToSave = {
        _id: docHash,
        memory_vectors: serializedMemoryVectors,
        created_at: Date.now(),
        _rev: existingDoc?._rev, // Add the current revision if the document exists.
      };

      // Save the document.
      await db.put(docToSave);
    } catch (err) {
      console.error("Error storing vectors in VectorDB:", err);
    }
  }

  public static async indexFile(
    db: PouchDB.Database,
    embeddingsAPI: Embeddings,
    noteFile: NoteFile
  ): Promise<VectorStoreDocument | undefined> {
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
    const splitDocument = await textSplitter.createDocuments([noteFile.content], [], {
      chunkHeader: "[[" + noteFile.basename + "]]" + "\n\n---\n\n",
      appendChunkOverlapHeader: true,
    });

    // Apply rate limiting before making the API call
    await this.getRateLimiter().wait();
    const docVectors = await embeddingsAPI.embedDocuments(
      splitDocument.map((doc) => doc.pageContent)
    );

    const memoryVectors = docVectors.map((docVector, i) => ({
      content: splitDocument[i].pageContent,
      metadata: {
        ...noteFile.metadata,
        title: noteFile.basename,
        path: noteFile.path,
      },
      embedding: docVector,
    }));
    const docHash = VectorDBManager.getDocumentHash(noteFile.path);

    const serializedMemoryVectors = JSON.stringify(memoryVectors);
    try {
      // Attempt to fetch the existing document, if it exists.
      const existingDoc = await db.get(docHash).catch((err) => null);

      // Prepare the document to be saved.
      const docToSave: VectorStoreDocument = {
        _id: docHash,
        memory_vectors: serializedMemoryVectors,
        file_mtime: noteFile.mtime,
        embeddingModel: embeddingModel,
        created_at: Date.now(),
        _rev: existingDoc?._rev, // Add the current revision if the document exists.
      };

      // Save the document.
      await db.put(docToSave);
      return docToSave;
    } catch (err) {
      console.error("Error storing vectors in VectorDB:", err);
    }
  }

  public static async getNoteFiles(db: PouchDB.Database): Promise<NoteFile[]> {
    if (!db) throw new Error("DB not initialized");
    try {
      const allDocsResponse = await db.allDocs<VectorStoreDocument>({
        include_docs: true,
      });
      const allDocs = allDocsResponse.rows.map((row) => row.doc as VectorStoreDocument);
      const memoryVectors = allDocs
        .map((doc) => JSON.parse(doc.memory_vectors) as MemoryVector[])
        .filter((memoryVectors) => memoryVectors.length > 0);

      const noteFiles = memoryVectors
        .map((memoryVectors, i) => {
          const doc = allDocs[i];
          const noteFile: NoteFile = {
            path: memoryVectors[0].metadata.path,
            basename: memoryVectors[0].metadata.title,
            mtime: doc.file_mtime,
            content: memoryVectors[0].content,
            metadata: memoryVectors[0].metadata,
          };
          return noteFile;
        })
        .filter((noteFile): noteFile is NoteFile => noteFile !== undefined);
      return noteFiles;
    } catch (err) {
      console.error("Error getting note files from VectorDB:", err);
      return [];
    }
  }

  public static async removeMemoryVectors(db: PouchDB.Database, docHash: string): Promise<void> {
    if (!db) throw new Error("DB not initialized");
    try {
      const doc = await db.get(docHash);
      if (doc) {
        await db.remove(doc);
      }
    } catch (err) {
      console.error("Error removing file from VectorDB:", err);
    }
  }

  public static async getLatestFileMtime(db: PouchDB.Database): Promise<number> {
    if (!db) throw new Error("DB not initialized");

    try {
      const allDocsResponse = await db.allDocs<VectorStoreDocument>({
        include_docs: true,
      });
      const allDocs = allDocsResponse.rows.map((row) => row.doc as VectorStoreDocument);
      const newestFileMtime = allDocs.map((doc) => doc.file_mtime).sort((a, b) => b - a)[0];
      return newestFileMtime;
    } catch (err) {
      console.error("Error getting newest file mtime from VectorDB:", err);
      return 0;
    }
  }

  public static async checkEmbeddingModel(db: PouchDB.Database): Promise<string | undefined> {
    if (!db) throw new Error("DB not initialized");

    try {
      // Fetch all documents
      const allDocsResponse = await db.allDocs<VectorStoreDocument>({
        include_docs: true,
      });
      const allDocs = allDocsResponse.rows.map((row) => row.doc as VectorStoreDocument);

      // Check if there are any documents
      if (allDocs.length === 0) {
        return undefined;
      }

      // Extract the embeddingModel from all documents
      const embeddingModels = allDocs.map((doc) => doc.embeddingModel);

      // Check if all documents have the same embeddingModel
      const allSame = embeddingModels.every((model) => model === embeddingModels[0]);
      return allSame ? embeddingModels[0] : undefined;
    } catch (err) {
      console.error("Error checking last embedding model from VectorDB:", err);
      return undefined;
    }
  }

  public static async getMemoryVectors(
    db: PouchDB.Database,
    docHash: string
  ): Promise<MemoryVector[] | undefined> {
    if (!db) throw new Error("DB not initialized");
    try {
      const doc: VectorStoreDocument = await db.get(docHash);
      if (doc && doc.memory_vectors) {
        return JSON.parse(doc.memory_vectors);
      }
    } catch (err) {
      console.log("No vectors found in VectorDB for dochash:", docHash);
    }
  }
}

export default VectorDBManager;
