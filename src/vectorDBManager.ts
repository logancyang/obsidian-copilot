import { MD5 } from 'crypto-js';
import { Document } from "langchain/document";
import { Embeddings } from 'langchain/embeddings/base';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { MemoryVectorStore } from "langchain/vectorstores/memory";

export interface VectorStoreDocument {
  _id: string;
  _rev?: string;
  memory_vectors: string;
  file_mtime: number;
  embeddingProvider: string;
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

class VectorDBManager {
  public static db: PouchDB.Database | null = null;
  public static embeddingProvider: string | null = null;

  public static initializeDB(db: PouchDB.Database): void {
    this.db = db;
  }

  public static updateDBInstance(newDb: PouchDB.Database): void {
    this.db = newDb;
  }

  public static setEmbeddingProvider(embeddingProvider: string): void {
    this.embeddingProvider = embeddingProvider;
  }

  public static getDocumentHash(sourceDocument: string): string {
    return MD5(sourceDocument).toString();
  }

  public static async rebuildMemoryVectorStore(
    memoryVectors: MemoryVector[], embeddingsAPI: Embeddings
  ) {
    if (!Array.isArray(memoryVectors)) {
      throw new TypeError("Expected memoryVectors to be an array");
    }
    // Extract the embeddings and documents from the deserialized memoryVectors
    const embeddingsArray: number[][] = memoryVectors.map(
      memoryVector => memoryVector.embedding
    );
    const documentsArray = memoryVectors.map(
      memoryVector => new Document({
        pageContent: memoryVector.content,
        metadata: memoryVector.metadata
      })
    );

    // Create a new MemoryVectorStore instance
    const memoryVectorStore = new MemoryVectorStore(embeddingsAPI);
    await memoryVectorStore.addVectors(embeddingsArray, documentsArray);
    return memoryVectorStore;
  }

  public static async getMemoryVectorStore(
    embeddingsAPI: Embeddings,
    docHash?: string,
  ): Promise<MemoryVectorStore> {
    if (!this.db) throw new Error("DB not initialized");
    if (!this.embeddingProvider) throw new Error("Embedding provider not set");

    let allDocsResponse;
    if (docHash) {
      // Fetch a single document by its _id
      const doc = await this.db.get(docHash);
      allDocsResponse = { rows: [{ doc }] };
    } else {
      // Fetch all documents
      allDocsResponse = await this.db.allDocs({ include_docs: true });
    }

    const allDocs = allDocsResponse.rows.map(row => row.doc as VectorStoreDocument)
      .filter(doc => doc.embeddingProvider === this.embeddingProvider);
    const memoryVectors = allDocs.map(doc => JSON.parse(doc.memory_vectors) as MemoryVector[]).flat();
    const embeddingsArray: number[][] = memoryVectors.map(
      memoryVector => memoryVector.embedding
    );
    const documentsArray = memoryVectors.map(
      memoryVector => new Document({
        pageContent: memoryVector.content,
        metadata: memoryVector.metadata
      })
    );
    // Create a new MemoryVectorStore instance
    const memoryVectorStore = new MemoryVectorStore(embeddingsAPI);
    await memoryVectorStore.addVectors(embeddingsArray, documentsArray);
    return memoryVectorStore;
  }

  public static async setMemoryVectors(memoryVectors: MemoryVector[], docHash: string): Promise<void> {
    if (!this.db) throw new Error("DB not initialized");
    if (!Array.isArray(memoryVectors)) {
      throw new TypeError("Expected memoryVectors to be an array");
    }
    const serializedMemoryVectors = JSON.stringify(memoryVectors);
    try {
      // Attempt to fetch the existing document, if it exists.
      const existingDoc = await this.db.get(docHash).catch(err => null);

      // Prepare the document to be saved.
      const docToSave = {
        _id: docHash,
        memory_vectors: serializedMemoryVectors,
        created_at: Date.now(),
        _rev: existingDoc?._rev // Add the current revision if the document exists.
      };

      // Save the document.
      await this.db.put(docToSave);
    } catch (err) {
      console.error("Error storing vectors in VectorDB:", err);
    }
  }

  public static async indexFile(noteFile: NoteFile, embeddingsAPI: Embeddings) {
    if (!this.db) throw new Error("DB not initialized");
    if (!this.embeddingProvider) throw new Error("Embedding provider not set");

    // Markdown splitter: https://js.langchain.com/docs/modules/data_connection/document_transformers/code_splitter#markdown
    const textSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: 5000,
    });
    // Add note title as contextual chunk headers
    // https://js.langchain.com/docs/modules/data_connection/document_transformers/contextual_chunk_headers
    const splitDocument = await textSplitter.createDocuments(
      [noteFile.content],
      [],
      {
        chunkHeader: '[[' + noteFile.basename + ']]' + '\n\n---\n\n',
        appendChunkOverlapHeader: true,
      },
    );
    const docVectors = await embeddingsAPI.embedDocuments(splitDocument.map(doc => doc.pageContent));
    const memoryVectors = docVectors.map((docVector, i) => (
      {
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
      const existingDoc = await this.db.get(docHash).catch(err => null);

      // Prepare the document to be saved.
      const docToSave: VectorStoreDocument = {
        _id: docHash,
        memory_vectors: serializedMemoryVectors,
        file_mtime: noteFile.mtime,
        embeddingProvider: this.embeddingProvider,
        created_at: Date.now(),
        _rev: existingDoc?._rev // Add the current revision if the document exists.
      };

      // Save the document.
      await this.db.put(docToSave);
      return docToSave;
    } catch (err) {
      console.error("Error storing vectors in VectorDB:", err);
    }
  }

  public static async getNoteFiles(): Promise<NoteFile[]> {
    if (!this.db) throw new Error("DB not initialized");
    try {
      const allDocsResponse = await this.db.allDocs<VectorStoreDocument>({ include_docs: true });
      const allDocs = allDocsResponse.rows.map(row => row.doc as VectorStoreDocument);
      const memoryVectors = allDocs.map(doc => JSON.parse(doc.memory_vectors) as MemoryVector[])
        .filter(memoryVectors => memoryVectors.length > 0);

      const noteFiles = memoryVectors.map((memoryVectors, i) => {
        const doc = allDocs[i];
        const noteFile: NoteFile = {
          path: memoryVectors[0].metadata.path,
          basename: memoryVectors[0].metadata.title,
          mtime: doc.file_mtime,
          content: memoryVectors[0].content,
          metadata: memoryVectors[0].metadata,
        }
        return noteFile;
      }).filter((noteFile): noteFile is NoteFile => noteFile !== undefined);
      return noteFiles;
    } catch (err) {
      console.error("Error getting note files from VectorDB:", err);
      return [];
    }
  }

  public static async removeMemoryVectors(docHash: string): Promise<void> {
    if (!this.db) throw new Error("DB not initialized");
    try {
      const doc = await this.db.get(docHash);
      if (doc) {
        await this.db.remove(doc);
      }
    } catch (err) {
      console.error("Error removing file from VectorDB:", err);
    }
  }

  public static async getLatestFileMtime(): Promise<number> {
    if (!this.db) throw new Error("DB not initialized");
    if (!this.embeddingProvider) throw new Error("Embedding provider not set");

    try {
      const allDocsResponse = await this.db.allDocs<VectorStoreDocument>({ include_docs: true });
      const allDocs = allDocsResponse.rows.map(row => row.doc as VectorStoreDocument)
        .filter(doc => doc.embeddingProvider === this.embeddingProvider);
      const newestFileMtime = allDocs.map(doc => doc.file_mtime).sort((a, b) => b - a)[0];
      return newestFileMtime;
    } catch (err) {
      console.error("Error getting newest file mtime from VectorDB:", err);
      return 0;
    }
  }

  public static async getMemoryVectors(docHash: string): Promise<MemoryVector[] | undefined> {
    if (!this.db) throw new Error("DB not initialized");
    try {
      const doc: VectorStoreDocument = await this.db.get(docHash);
      if (doc && doc.memory_vectors) {
        return JSON.parse(doc.memory_vectors);
      }
    } catch (err) {
      console.log("No vectors found in VectorDB for dochash:", docHash);
    }
  }

}

export default VectorDBManager;
