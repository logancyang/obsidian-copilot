import { AI_SENDER } from "@/constants";
import ChainManager from "@/LLMProviders/chainManager";
import { ChatMessage } from "@/types/message";
import { err2String, formatDateTime } from "./utils";
import { logError } from "@/logger";
import { v4 as uuidv4 } from "uuid";
import { formatErrorChunk } from "@/utils/toolResultUtils";

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
    updateLoadingMessage?: (message: string) => void;
  } = {}
) => {
  const abortController = new AbortController();
  updateShouldAbort(abortController);
  try {
    await chainManager.runChain(
      userMessage,
      abortController,
      updateCurrentAiMessage,
      addMessage,
      options
    );
  } catch (error) {
    logError("Model request failed:", error);
    const errorMessage = formatErrorChunk("Model request failed: " + err2String(error));

    addMessage({
      id: uuidv4(),
      sender: AI_SENDER,
      isErrorMessage: true,
      message: errorMessage,
      isVisible: true,
      timestamp: formatDateTime(new Date()),
    });
  }
};
