// helper contains business-related tools；
// generally, util contains business-independent tools

import ChainManager from "@/LLMProviders/chainManager";
import { ChainType } from "@/langchain/chainFactory";
import { SetChainOptions } from "@/models/aiParams";
import { useEffect, useState } from "react";
import { BaseChatMemory } from "langchain/memory";
import SharedState, { ChatMessage } from "@/services/sharedState";

/**
 * React hook to manage state related to model, chain and memory in Chat component.
 */
export function useAIState(
  chainManager: ChainManager
): [
  string,
  (model: string) => void,
  ChainType,
  (chain: ChainType, options?: SetChainOptions) => void,
  () => void,
] {
  const langChainParams = chainManager.getLangChainParams();
  const [currentModelKey, setCurrentModelKey] = useState<string>(langChainParams.modelKey);
  const [currentChain, setCurrentChain] = useState<ChainType>(langChainParams.chainType);
  const [, setChatMemory] = useState<BaseChatMemory | null>(chainManager.memoryManager.getMemory());

  const clearChatMemory = () => {
    chainManager.memoryManager.clearChatMemory();
    setChatMemory(chainManager.memoryManager.getMemory());
  };

  const setModelKey = (newModelKey: string) => {
    chainManager.createChainWithNewModel(newModelKey);
    setCurrentModelKey(newModelKey);
  };

  const setChain = (newChain: ChainType, options?: SetChainOptions) => {
    chainManager.setChain(newChain, options);
    setCurrentChain(newChain);
  };

  return [currentModelKey, setModelKey, currentChain, setChain, clearChatMemory];
}

export function useSharedState(
  sharedState: SharedState
): [ChatMessage[], (message: ChatMessage) => void, () => void] {
  // Initializes the local chatHistory state with the current
  // sharedState chatHistory using the useState hook
  // setChatHistory is used to update the *local* state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(sharedState.getMessages());

  // The useEffect hook ensures that the local state is synchronized
  // with the shared state when the component is mounted.
  // [] is the dependency array. The effect will only run if one of
  // the dependencies has changed since the last render.
  // When there are no dependencies, the effect will only run once,
  // *right after the initial render* (similar to componentDidMount in class components).
  useEffect(() => {
    setChatHistory(sharedState.getMessages());
  }, []);

  const addMessage = (message: ChatMessage) => {
    sharedState.addMessage(message);
    setChatHistory([...sharedState.getMessages()]);
  };

  const clearMessages = () => {
    sharedState.clearChatHistory();
    setChatHistory([]);
  };

  return [chatHistory, addMessage, clearMessages];
}
