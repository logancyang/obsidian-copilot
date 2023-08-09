import { MD5 } from 'crypto-js';
import { BaseLanguageModel } from "langchain/base_language";
import {
  BaseChain,
  ConversationChain,
  ConversationalRetrievalQAChain,
  LLMChainInput
} from "langchain/chains";
import { Document } from "langchain/document";
import { Embeddings } from 'langchain/embeddings/base';
import { BaseRetriever } from "langchain/schema";
import { MemoryVectorStore } from "langchain/vectorstores/memory";

export interface RetrievalChainParams {
  llm: BaseLanguageModel;
  retriever: BaseRetriever;
  options?: {
    returnSourceDocuments?: boolean;
  }
}

export interface ConversationalRetrievalChainParams {
  llm: BaseLanguageModel;
  retriever: BaseRetriever;
  options?: {
      returnSourceDocuments?: boolean;
      questionGeneratorTemplate?: string;
      qaTemplate?: string;
  }
}

export interface VectorStoreDocument {
    _id: string;
    _rev?: string;
    data: string;
}

export interface MemoryVector {
    content: string;
    embedding: number[];
    metadata: Record<string, any>;
}

// Issue where conversational retrieval chain gives rephrased question
// when streaming: https://github.com/hwchase17/langchainjs/issues/754#issuecomment-1540257078
// Temp workaround triggers CORS issue 'refused to set header user-agent'

// Add new chain types here
export enum ChainType {
  LLM_CHAIN = 'llm_chain',
  RETRIEVAL_QA_CHAIN = 'retrieval_qa',
  // TODO: Wait for official fix and use conversational retrieval chain instead of retrieval qa.
  CONVERSATIONAL_RETRIEVAL_QA_CHAIN = 'conversational_retrieval_chain',
}

class ChainFactory {
  public static instances: Map<string, BaseChain> = new Map();
  public static db: PouchDB.Database | null = null;

  public static createNewLLMChain(args: LLMChainInput): BaseChain {
    const instance = new ConversationChain(args as LLMChainInput);
    console.log('New chain created: ', instance._chainType());
    ChainFactory.instances.set(ChainType.LLM_CHAIN, instance);
    return instance;
  }

  public static initializeDB(db: PouchDB.Database): void {
    this.db = db;
  }

  public static getLLMChainFromMap(args: LLMChainInput): BaseChain {
    let instance = ChainFactory.instances.get(ChainType.LLM_CHAIN);
    if (!instance) {
      instance = ChainFactory.createNewLLMChain(args);
    }
    return instance;
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
        data: serializedMemoryVectors,
        _rev: existingDoc?._rev // Add the current revision if the document exists.
      };

      // Save the document.
      await this.db.put(docToSave);
    } catch (err) {
      console.error("Error storing vectors in PouchDB:", err);
    }
  }

  public static async getMemoryVectors(docHash: string): Promise<MemoryVector[] | undefined> {
    if (!this.db) throw new Error("DB not initialized");
    try {
      const doc: VectorStoreDocument = await this.db.get(docHash);
      if (doc && doc.data) {
        return JSON.parse(doc.data);
      }
    } catch (err) {
      console.log("No vectors found in PouchDB for dochash:", docHash);
    }
  }

  public static createConversationalRetrievalChain(
    args: ConversationalRetrievalChainParams
  ): ConversationalRetrievalQAChain {
    // Create a new retrieval chain every time, not singleton
    const argsRetrieval = args as ConversationalRetrievalChainParams;
    const instance = ConversationalRetrievalQAChain.fromLLM(
      argsRetrieval.llm, argsRetrieval.retriever, argsRetrieval.options
    );
    console.log('New chain created: ', instance._chainType());

    return instance as ConversationalRetrievalQAChain;
  }
}

export default ChainFactory;
