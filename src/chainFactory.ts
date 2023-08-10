import { BaseLanguageModel } from "langchain/base_language";
import {
  BaseChain,
  ConversationChain,
  ConversationalRetrievalQAChain,
  LLMChainInput
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

  public static createNewLLMChain(args: LLMChainInput): BaseChain {
    const instance = new ConversationChain(args as LLMChainInput);
    console.log('New chain created: ', instance._chainType());
    ChainFactory.instances.set(ChainType.LLM_CHAIN, instance);
    return instance;
  }

  public static getLLMChainFromMap(args: LLMChainInput): BaseChain {
    let instance = ChainFactory.instances.get(ChainType.LLM_CHAIN);
    if (!instance) {
      instance = ChainFactory.createNewLLMChain(args);
    }
    return instance;
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
