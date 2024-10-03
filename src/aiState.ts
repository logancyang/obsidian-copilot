import ChainManager from "@/LLMProviders/chainManager";
import { SetChainOptions } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { BaseChatMemory } from "langchain/memory";
import { useState } from "react";

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
