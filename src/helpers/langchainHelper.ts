// helper contains business-related tools；
// generally, util contains business-independent tools

import { RunnableSequence } from "@langchain/core/runnables";
import { ChainType, Document } from "@/langchain/chainFactory";
import { BaseChain, RetrievalQAChain } from "langchain/chains";
import { NOMIC_EMBED_TEXT, USER_SENDER } from "@/constants";
import { MemoryVariables } from "@langchain/core/memory";
import { ChatMessage } from "@/services/sharedState";

export const isLLMChain = (chain: RunnableSequence): chain is RunnableSequence => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last.bound.modelName || (chain as any).last.bound.model;
};
export const stringToChainType = (chain: string): ChainType => {
  switch (chain) {
    case "llm_chain":
      return ChainType.LLM_CHAIN;
    case "vault_qa":
      return ChainType.VAULT_QA_CHAIN;
    case "copilot_plus":
      return ChainType.COPILOT_PLUS;
    default:
      throw new Error(`Unknown chain type: ${chain}`);
  }
};
export const isRetrievalQAChain = (chain: BaseChain): chain is RetrievalQAChain => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last.bound.retriever !== undefined;
};
export const isSupportedChain = (chain: RunnableSequence): chain is RunnableSequence => {
  return isLLMChain(chain) || isRetrievalQAChain(chain);
};

export function areEmbeddingModelsSame(
  model1: string | undefined,
  model2: string | undefined
): boolean {
  if (!model1 || !model2) return false;
  // TODO: Hacks to handle different embedding model names for the same model. Need better handling.
  if (model1.includes(NOMIC_EMBED_TEXT) && model2.includes(NOMIC_EMBED_TEXT)) {
    return true;
  }
  if (
    (model1 === "small" && model2 === "cohereai") ||
    (model1 === "cohereai" && model2 === "small")
  ) {
    return true;
  }
  return model1 === model2;
}

export function extractChatHistory(memoryVariables: MemoryVariables): [string, string][] {
  const chatHistory: [string, string][] = [];
  const { history } = memoryVariables;

  for (let i = 0; i < history.length; i += 2) {
    const userMessage = history[i]?.content || "";
    const aiMessage = history[i + 1]?.content || "";
    chatHistory.push([userMessage, aiMessage]);
  }

  return chatHistory;
}

// Returns the last N messages from the chat history,
// last one being the newest ai message
export const getChatContext = (chatHistory: ChatMessage[], contextSize: number) => {
  if (chatHistory.length === 0) {
    return [];
  }
  const lastAiMessageIndex = chatHistory
    .slice()
    .reverse()
    .findIndex((msg) => msg.sender !== USER_SENDER);
  if (lastAiMessageIndex === -1) {
    // No ai messages found, return an empty array
    return [];
  }

  const lastIndex = chatHistory.length - 1 - lastAiMessageIndex;
  const startIndex = Math.max(0, lastIndex - contextSize + 1);
  return chatHistory.slice(startIndex, lastIndex + 1);
};

export function extractUniqueTitlesFromDocs(docs: Document[]): string[] {
  const titlesSet = new Set<string>();
  docs.forEach((doc) => {
    if (doc.metadata?.title) {
      titlesSet.add(doc.metadata?.title);
    }
  });

  return Array.from(titlesSet);
}
