// TODO(logan): This entire file is deprecated since we moved to direct chat model calls in chain runners
// Consider removing after verifying no dependencies remain

import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate, PromptTemplate } from "@langchain/core/prompts";
import { BaseRetriever } from "@langchain/core/retrievers";
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { BaseChatMemory } from "langchain/memory";
import { formatDocumentsAsString } from "langchain/util/document";
import { removeThinkTags } from "./utils";

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
  };
}

export interface ConversationalRetrievalChainParams {
  llm: BaseLanguageModel;
  retriever: BaseRetriever;
  systemMessage: string;
  options?: {
    returnSourceDocuments?: boolean;
    questionGeneratorTemplate?: string;
    qaTemplate?: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Document<T = Record<string, any>> {
  // Structure of Document, possibly including pageContent, metadata, etc.
  pageContent: string;
  metadata: T;
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
  LLM_CHAIN = "llm_chain",
  VAULT_QA_CHAIN = "vault_qa",
  COPILOT_PLUS_CHAIN = "copilot_plus",
  PROJECT_CHAIN = "project",
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
    console.log("New LLM chain created.");
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
    args: ConversationalRetrievalChainParams,
    onDocumentsRetrieved: (documents: Document[]) => void,
    debug?: boolean
  ): RunnableSequence {
    const { llm, retriever, systemMessage } = args;

    // NOTE: This is a tricky part of the Conversational RAG. Weaker models may fail this instruction
    // and lose the follow up question altogether.
    const condenseQuestionTemplate = `Given the following conversation and a follow up question,
    summarize the conversation as context and keep the follow up question unchanged, in its original language.
    If the follow up question is unrelated to its preceding messages, return this follow up question directly.
    If it is related, then combine the summary and the follow up question to construct a standalone question.
    Make sure to keep any [[]] wrapped note titles in the question unchanged.

    Chat History:
    {chat_history}
    Follow Up Input: {question}
    Standalone question:`;
    const CONDENSE_QUESTION_PROMPT = PromptTemplate.fromTemplate(condenseQuestionTemplate);

    const answerTemplate = `{system_message}

Answer the question with as detailed as possible based only on the following context:
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
        question: (input: ConversationalRetrievalQAChainInput) => {
          if (debug) console.log("Input Question: ", input.question);
          return input.question;
        },
        chat_history: (input: ConversationalRetrievalQAChainInput) => {
          const formattedChatHistory = formatChatHistory(input.chat_history);
          if (debug) console.log("Formatted Chat History: ", formattedChatHistory);
          return formattedChatHistory;
        },
      },
      CONDENSE_QUESTION_PROMPT,
      llm,
      new StringOutputParser(),
      (output) => {
        const cleanedOutput = removeThinkTags(output);
        if (debug) console.log("Standalone Question: ", cleanedOutput);
        return cleanedOutput;
      },
    ]);

    const formatDocumentsAsStringAndStore = async (documents: Document[]) => {
      // Store or log documents for debugging
      onDocumentsRetrieved(documents);
      return formatDocumentsAsString(documents);
    };

    const answerChain = RunnableSequence.from([
      {
        context: retriever.pipe(formatDocumentsAsStringAndStore),
        question: new RunnablePassthrough(),
        system_message: () => systemMessage,
      },
      ANSWER_PROMPT,
      llm,
    ]);

    const conversationalRetrievalQAChain = standaloneQuestionChain.pipe(answerChain);
    return conversationalRetrievalQAChain as RunnableSequence;
  }
}

export default ChainFactory;
