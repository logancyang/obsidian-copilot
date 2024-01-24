import ChainManager from '@/LLMProviders/chainManager';
import { SetChainOptions } from '@/aiParams';
import { ChainType } from '@/chainFactory';
import { BaseChatMemory } from "langchain/memory";
import { useState } from 'react';

/**
 * React hook to manage state related to model, chain and memory in Chat component.
*/
export function useAIState(
  chainManager: ChainManager,
): [
  string,
  (model: string) => void,
  ChainType,
  (chain: ChainType, options?: SetChainOptions) => void,
  () => void,
] {
  const { langChainParams } = chainManager;
  const [currentModel, setCurrentModel] = useState<string>(langChainParams.modelDisplayName);
  const [currentChain, setCurrentChain] = useState<ChainType>(langChainParams.chainType);
  const [, setChatMemory] = useState<BaseChatMemory | null>(chainManager.memoryManager.getMemory());

  const clearChatMemory = () => {
    chainManager.memoryManager.clearChatMemory();
    setChatMemory(chainManager.memoryManager.getMemory());
  };

  const setModel = (newModelDisplayName: string) => {
    chainManager.createChainWithNewModel(newModelDisplayName);
    setCurrentModel(newModelDisplayName);
  };

  const setChain = (newChain: ChainType, options?: SetChainOptions) => {
    chainManager.setChain(newChain, options);
    setCurrentChain(newChain);
  };

  return [
    currentModel,
    setModel,
    currentChain,
    setChain,
    clearChatMemory,
  ];
}
