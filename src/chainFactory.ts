import { MD5 } from 'crypto-js';
import { BaseLanguageModel } from "langchain/base_language";
import {
  BaseChain,
  ConversationChain,
  ConversationalRetrievalQAChain,
  LLMChainInput,
  RetrievalQAChain,
} from "langchain/chains";
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
export const SUPPORTED_CHAIN_TYPES = new Set([
  LLM_CHAIN,
  RETRIEVAL_QA_CHAIN,
  CONVERSATIONAL_RETRIEVAL_QA_CHAIN,
]);

class ChainFactory {
  public static instances: Map<string, BaseChain> = new Map();

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

  /**
 * Get the retrieval chain for a given source document. If the document exists
 * and is not changed, it retrieves its previous chain instance. Otherwise,
 * it creates a new chain and put it into the chain factory map where the key
 * is the full document's MD5 hash.
 */
  public static getRetrievalChain(
    inputDocHash: string,
  ): RetrievalQAChain {
    let instance;
    if (ChainFactory.instances.has(inputDocHash)) {
      // Use the existing chain when the note has been indexed
      instance = ChainFactory.instances.get(inputDocHash) as RetrievalQAChain;
      console.log('Retrieval qa chain retrieved for document hash: ', inputDocHash);
    }

    return instance as RetrievalQAChain;
  }

  public static createRetrievalChain(
    args: RetrievalChainParams,
    inputDocHash: string,
  ): RetrievalQAChain {
    // Create a new retrieval chain when the note hasn't been indexed
    const argsRetrieval = args as RetrievalChainParams;
    const instance = RetrievalQAChain.fromLLM(
      argsRetrieval.llm, argsRetrieval.retriever, argsRetrieval.options
    );
    ChainFactory.instances.set(inputDocHash, instance);
    console.log('New retrieval qa chain created for document hash: ', inputDocHash);

    return instance as RetrievalQAChain;
  }

  public static getConversationalRetrievalChain(
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
