import { BaseRetriever } from "@langchain/core/retrievers";
import { RunnableSequence } from "@langchain/core/runnables";
import { BaseLanguageModel } from "langchain/base_language";
import {
  ConversationalRetrievalQAChain
} from "langchain/chains";
import { BufferWindowMemory } from "langchain/memory";
import { ChatPromptTemplate } from "langchain/prompts";

export interface LLMChainInput {
  llm: BaseLanguageModel;
  memory: BufferWindowMemory;
  prompt: ChatPromptTemplate;
  abortController?: AbortController;
}

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
  public static instances: Map<string, RunnableSequence> = new Map();

  public static createNewLLMChain(args: LLMChainInput): RunnableSequence {
    const { llm, memory, prompt, abortController } = args;

    const model = llm.bind({ signal: abortController?.signal });
    const instance = RunnableSequence.from([
      {
        input: (initialInput) => initialInput.input,
        memory: () => memory.loadMemoryVariables({}),
      },
      {
        input: (previousOutput) => previousOutput.input,
        history: (previousOutput) => previousOutput.memory.history,
      },
      prompt,
      model,
    ]);
    ChainFactory.instances.set(ChainType.LLM_CHAIN, instance);
    return instance;
  }

  public static getLLMChainFromMap(args: LLMChainInput): RunnableSequence {
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
