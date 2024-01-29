import { StringOutputParser } from "@langchain/core/output_parsers";
import { BaseRetriever } from "@langchain/core/retrievers";
import {
  RunnablePassthrough,
  RunnableSequence,
} from "@langchain/core/runnables";
import { BaseLanguageModel } from "langchain/base_language";
import { BaseChatMemory } from "langchain/memory";
import { ChatPromptTemplate, PromptTemplate } from "langchain/prompts";
import { formatDocumentsAsString } from "langchain/util/document";

export interface LLMChainInput {
  llm: BaseLanguageModel;
  memory: BaseChatMemory;
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

type ConversationalRetrievalQAChainInput = {
  question: string;
  chat_history: [string, string][];
};

// Issue where conversational retrieval chain gives rephrased question
// when streaming: https://github.com/hwchase17/langchainjs/issues/754#issuecomment-1540257078
// Temp workaround triggers CORS issue 'refused to set header user-agent'

// Add new chain types here
export enum ChainType {
  LLM_CHAIN = 'llm_chain',
  RETRIEVAL_QA_CHAIN = 'retrieval_qa',
  // TODO: Wait for official fix and use conversational retrieval chain instead of retrieval qa.
  CONVERSATIONAL_RETRIEVAL_QA_CHAIN = 'conversational_retrieval_chain',
  VAULT_QA_CHAIN = 'vault_qa',
}

class ChainFactory {
  public static instances: Map<string, RunnableSequence> = new Map();

  /**
   * Create a new LLM chain using the provided LLMChainInput.
   *
   * @param {LLMChainInput} args - the input for creating the LLM chain
   * @return {RunnableSequence} the newly created LLM chain
   */
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
    console.log('New LLM chain created.');
    return instance;
  }

  /**
   * Gets the LLM chain singleton from the map.
   *
   * @param {LLMChainInput} args - the input for the LLM chain
   * @return {RunnableSequence} the LLM chain instance
   */
  public static getLLMChainFromMap(args: LLMChainInput): RunnableSequence {
    let instance = ChainFactory.instances.get(ChainType.LLM_CHAIN);
    if (!instance) {
      instance = ChainFactory.createNewLLMChain(args);
    }
    return instance;
  }


  /**
   * Create a conversational retrieval chain with the given parameters. Not a singleton.
   *
   * Example invocation:
   *
   * ```ts
   * const conversationalRetrievalChain = ChainFactory.createConversationalRetrievalChain({
   *  llm: model,
   *  retriever: retriever
   * });
   *
   * const response = await conversationalRetrievalChain.invoke({
   *   question: "What are they made out of?",
   *    chat_history: [
   *      [
   *        "What is the powerhouse of the cell?",
   *        "The powerhouse of the cell is the mitochondria.",
   *      ],
   *    ],
   * });
   * ```
   *
   * @param {ConversationalRetrievalChainParams} args - the parameters for the retrieval chain
   * @return {RunnableSequence} a new conversational retrieval chain
   */
  public static createConversationalRetrievalChain(
    args: ConversationalRetrievalChainParams
  ): RunnableSequence {
    const { llm, retriever } = args;

    const condenseQuestionTemplate = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question, in its original language.

    Chat History:
    {chat_history}
    Follow Up Input: {question}
    Standalone question:`;
    const CONDENSE_QUESTION_PROMPT = PromptTemplate.fromTemplate(
      condenseQuestionTemplate
    );

    const answerTemplate = `Answer the question with as detailed as possible based only on the following context:
    {context}

    Question: {question}
    `;
    const ANSWER_PROMPT = PromptTemplate.fromTemplate(answerTemplate);

    const formatChatHistory = (chatHistory: [string, string][]) => {
      const formattedDialogueTurns = chatHistory.map(
        (dialogueTurn) => `Human: ${dialogueTurn[0]}\nAssistant: ${dialogueTurn[1]}`
      );
      return formattedDialogueTurns.join("\n");
    };

    const standaloneQuestionChain = RunnableSequence.from([
      {
        question: (input: ConversationalRetrievalQAChainInput) => input.question,
        chat_history: (input: ConversationalRetrievalQAChainInput) =>
          formatChatHistory(input.chat_history),
      },
      CONDENSE_QUESTION_PROMPT,
      llm,
      new StringOutputParser(),
    ]);

    const answerChain = RunnableSequence.from([
      {
        context: retriever.pipe(formatDocumentsAsString),
        question: new RunnablePassthrough(),
      },
      ANSWER_PROMPT,
      llm,
    ]);

    const conversationalRetrievalQAChain = standaloneQuestionChain.pipe(answerChain);
    console.log('New Conversational Retrieval QA Chain created.');

    return conversationalRetrievalQAChain as RunnableSequence;
  }
}

export default ChainFactory;
