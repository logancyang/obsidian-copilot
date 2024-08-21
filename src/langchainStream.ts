import ChainManager from "@/LLMProviders/chainManager";
import { ChatMessage } from "@/sharedState";
import { Notice } from "obsidian";

export type Role = "assistant" | "user" | "system";

export const getAIResponse = async (
  userMessage: ChatMessage,
  chainManager: ChainManager,
  addMessage: (message: ChatMessage) => void,
  updateCurrentAiMessage: (message: string) => void,
  updateShouldAbort: (abortController: AbortController | null) => void,
  options: {
    debug?: boolean;
    ignoreSystemMessage?: boolean;
    updateLoading?: (loading: boolean) => void;
  } = {}
) => {
  const abortController = new AbortController();
  updateShouldAbort(abortController);
  try {
    await chainManager.runChain(
      userMessage.message,
      abortController,
      updateCurrentAiMessage,
      addMessage,
      options
    );
  } catch (error) {
    console.error("Model request failed:", error);
    new Notice("Model request failed:", error);
  }
};
