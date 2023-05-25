import { BaseLanguageModel } from "langchain/base_language";
import {
  BaseChain,
  ConversationChain,
  ConversationalRetrievalQAChain,
  LLMChainInput,
} from "langchain/chains";
import { BaseRetriever } from "langchain/schema";


export interface ConversationalRetrievalChainParams {
  llm: BaseLanguageModel;
  retriever: BaseRetriever;
  options?: {
    questionGeneratorTemplate?: string;
    qaTemplate?: string;
    returnSourceDocuments?: boolean;
  }
}

// Add new chain types here
export const LLM_CHAIN = 'llm_chain';
export const CONVERSATIONAL_RETRIEVAL_QA_CHAIN = 'conversational_retrieval_chain';
export const SUPPORTED_CHAIN_TYPES = new Set([
  LLM_CHAIN,
  CONVERSATIONAL_RETRIEVAL_QA_CHAIN,
]);

class ChainFactory {
  private static instances: Map<string, BaseChain> = new Map();

  public static getLLMChain(args: LLMChainInput): BaseChain {
    let instance = ChainFactory.instances.get(LLM_CHAIN);
    if (!instance) {
      instance = new ConversationChain(args as LLMChainInput);
      console.log('New chain created: ', instance._chainType());
      ChainFactory.instances.set(LLM_CHAIN, instance);
    }
    return instance;
  }

  public static getRetrievalChain(
    args: ConversationalRetrievalChainParams
  ): ConversationalRetrievalQAChain {
    let instance = ChainFactory.instances.get(CONVERSATIONAL_RETRIEVAL_QA_CHAIN);
    if (!instance) {
      const argsRetrieval = args as ConversationalRetrievalChainParams;
      instance = ConversationalRetrievalQAChain.fromLLM(
        argsRetrieval.llm, argsRetrieval.retriever, argsRetrieval.options
      );
      console.log('New chain created: ', instance._chainType());
      ChainFactory.instances.set(CONVERSATIONAL_RETRIEVAL_QA_CHAIN, instance);
    }
    return instance as ConversationalRetrievalQAChain;
  }
}

export default ChainFactory;
