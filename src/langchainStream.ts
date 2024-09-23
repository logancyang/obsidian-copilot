import { AI_SENDER } from "@/constants";
import ChainManager from "@/LLMProviders/chainManager";
import { ChatMessage } from "@/sharedState";

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
    let errorMessage = "Model request failed: ";

    if (error instanceof Error) {
      errorMessage += error.message;
      if (error.cause) {
        errorMessage += ` Cause: ${error.cause}`;
      }
    } else if (typeof error === "object" && error !== null) {
      errorMessage += JSON.stringify(error);
    } else {
      errorMessage += String(error);
    }

    addMessage({
      sender: AI_SENDER,
      message: `Error: ${errorMessage}`,
      isVisible: true,
    });
  }
};
