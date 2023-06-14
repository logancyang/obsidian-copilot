import { MD5 } from 'crypto-js';
import { BaseLanguageModel } from "langchain/base_language";
import {
  BaseChain,
  ConversationChain,
  ConversationalRetrievalQAChain,
  LLMChainInput
} from "langchain/chains";
import { VectorStore } from 'langchain/dist/vectorstores/base';
import { BaseRetriever } from "langchain/schema";


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

// Add new chain types here
export const LLM_CHAIN = 'llm_chain';
// Issue where conversational retrieval chain gives rephrased question
// when streaming: https://github.com/hwchase17/langchainjs/issues/754#issuecomment-1540257078
// Temp workaround triggers CORS issue 'refused to set header user-agent'
// TODO: Wait for official fix and use conversational retrieval chain instead of retrieval qa.
export const CONVERSATIONAL_RETRIEVAL_QA_CHAIN = 'conversational_retrieval_chain';
export const RETRIEVAL_QA_CHAIN = 'retrieval_qa';

export enum ChainType {
  LLM_CHAIN,
  RETRIEVAL_QA_CHAIN
}

class ChainFactory {
  public static instances: Map<string, BaseChain> = new Map();
  public static vectorStoreMap: Map<string, VectorStore> = new Map();

  public static getLLMChain(args: LLMChainInput): BaseChain {
    let instance = ChainFactory.instances.get(LLM_CHAIN);
    if (!instance) {
      instance = new ConversationChain(args as LLMChainInput);
      console.log('New chain created: ', instance._chainType());
      ChainFactory.instances.set(LLM_CHAIN, instance);
    }
    return instance;
  }

  public static getDocumentHash(sourceDocument: string): string {
    return MD5(sourceDocument).toString();
  }

  public static setVectorStore(vectorStore: VectorStore, docHash: string): void {
    ChainFactory.vectorStoreMap.set(docHash, vectorStore);
  }

  public static getVectorStore(docHash: string): VectorStore | undefined {
    return ChainFactory.vectorStoreMap.get(docHash);
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
