import { MD5 } from 'crypto-js';
import { Document } from "langchain/document";
import { Embeddings } from 'langchain/embeddings/base';
import { MemoryVectorStore } from "langchain/vectorstores/memory";

export interface VectorStoreDocument {
    _id: string;
    _rev?: string;
    memory_vectors: string;
    created_at: number;
}

export interface MemoryVector {
    content: string;
    embedding: number[];
    metadata: Record<string, any>;
}

class VectorDBManager {
  public static db: PouchDB.Database | null = null;

  public static initializeDB(db: PouchDB.Database): void {
    this.db = db;
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

  public static async removeOldDocuments(ttl: number): Promise<void> {
    if (!this.db) throw new Error("DB not initialized");

    try {
      const thresholdTime = Date.now() - ttl;

      // Fetch all documents from the database
      const allDocsResponse = await this.db.allDocs<{ created_at: number }>({ include_docs: true });

      // Filter out the documents older than 2 weeks
      const oldDocs = allDocsResponse.rows.filter(row => {
          // Assert the doc type
          const doc = row.doc as VectorStoreDocument;
          return doc && doc.created_at < thresholdTime;
      });

      if (oldDocs.length === 0) {
          return;
      }
      // Prepare the documents for deletion
      const docsToDelete = oldDocs.map(row => ({
          _id: row.id,
          _rev: (row.doc as VectorStoreDocument)._rev,
          _deleted: true
      }));

      // Delete the old documents
      await this.db.bulkDocs(docsToDelete);
      console.log("Deleted old documents from VectorDB");
    }
     catch (err) {
      console.error("Error removing old documents from VectorDB:", err);
    }
  }

  // TODO: Implement advanced stale document removal.
  // NOTE: Cannot just rely on note title + ts because a "document" here is a chunk from
  // the original note. Need a better strategy.
}

export default VectorDBManager;
