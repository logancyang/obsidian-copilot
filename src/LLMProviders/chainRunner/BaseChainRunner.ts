import { ABORT_REASON, AI_SENDER } from "@/constants";
import { logError, logInfo } from "@/logger";
import { ChatMessage, ResponseMetadata } from "@/types/message";
import { err2String, formatDateTime } from "@/utils";
import ChainManager from "../chainManager";

export interface ChainRunner {
  run(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string>;
}

export abstract class BaseChainRunner implements ChainRunner {
  protected chainManager: ChainManager;

  constructor(chainManager: ChainManager) {
    this.chainManager = chainManager;
  }

  abstract run(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string>;

  protected async handleResponse(
    fullAIResponse: string,
    userMessage: ChatMessage,
    abortController: AbortController,
    addMessage: (message: ChatMessage) => void,
    updateCurrentAiMessage: (message: string) => void,
    sources?: { title: string; path: string; score: number }[],
    llmFormattedOutput?: string,
    responseMetadata?: ResponseMetadata
  ) {
    // Save to memory and add message if we have a response
    // Skip only if it's a NEW_CHAT abort (clearing everything)

    // Add message if we have a response OR if response was truncated (even if empty)
    // This ensures truncation warnings are shown even for empty truncated responses
    const shouldAddMessage =
      (fullAIResponse || responseMetadata?.wasTruncated) &&
      !(abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT);

    if (shouldAddMessage) {
      // Use saveContext for atomic operation and proper memory management
      // Note: LangChain's memory expects text content, not multimodal arrays, so multimodal content is not saved
      // For truncated empty responses, save a placeholder message
      const outputForMemory =
        llmFormattedOutput || fullAIResponse || "[Response truncated - no content generated]";
      await this.chainManager.memoryManager
        .getMemory()
        .saveContext({ input: userMessage.message }, { output: outputForMemory });

      // For empty truncated responses, show a helpful message
      const displayMessage =
        fullAIResponse ||
        (responseMetadata?.wasTruncated
          ? "_[The response was truncated before any content could be generated. Try increasing the max tokens limit.]_"
          : "");

      const messageToAdd = {
        message: displayMessage,
        sender: AI_SENDER,
        isVisible: true,
        timestamp: formatDateTime(new Date()),
        sources: sources,
        responseMetadata: responseMetadata,
      };

      addMessage(messageToAdd);

      // Clear the streaming message since it's now in chat history
      updateCurrentAiMessage("");
    } else if (abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      // Also clear if it's a new chat
      updateCurrentAiMessage("");
    }
    // Log compact memory summary and a truncated final response (~300 chars)
    const historyMessages = (this.chainManager.memoryManager.getMemory().chatHistory as any)
      .messages;
    logInfo("Chat memory updated:\n", {
      turns: Array.isArray(historyMessages) ? historyMessages.length : 0,
    });

    const MAX_LOG_LENGTH = 2000;
    try {
      const { parseToolCallMarkers } = await import("./utils/toolCallParser");
      const parsed = parseToolCallMarkers(fullAIResponse);
      let textOnly = parsed.segments
        .map((seg: any) => (seg.type === "text" ? seg.content : ""))
        .join("")
        .trim();
      if (!textOnly) textOnly = fullAIResponse || "";
      const snippet =
        textOnly.length > MAX_LOG_LENGTH
          ? textOnly.slice(0, MAX_LOG_LENGTH) + "... (truncated)"
          : textOnly;
      logInfo("Final AI response (truncated):\n", snippet);
    } catch {
      // Fallback: truncate raw response without parsing
      const s = typeof fullAIResponse === "string" ? fullAIResponse : String(fullAIResponse ?? "");
      const clipped =
        s.length > MAX_LOG_LENGTH ? s.slice(0, MAX_LOG_LENGTH) + "... (truncated)" : s;
      logInfo("Final AI response (truncated):\n", clipped);
    }
    return fullAIResponse;
  }

  protected async handleError(error: any, processErrorChunk: (message: string) => void) {
    const msg = err2String(error);
    logError("Error during LLM invocation:", msg);
    const errorData = error?.response?.data?.error || msg;
    const errorCode = errorData?.code || msg;
    let errorMessage = "";

    // Check for specific error messages
    if (error?.message?.includes("Invalid license key")) {
      errorMessage = "Invalid Copilot Plus license key. Please check your license key in settings.";
    } else if (errorCode === "model_not_found") {
      errorMessage =
        "You do not have access to this model or the model does not exist, please check with your API provider.";
    } else {
      errorMessage = `${errorCode}`;
    }

    logError(errorData);
    processErrorChunk(this.enhancedErrorMsg(errorMessage, msg));
  }

  private enhancedErrorMsg(errorMessage: string, msg: string) {
    // remove langchain troubleshooting URL from error message
    const ignoreEndIndex = errorMessage.search("Troubleshooting URL");
    errorMessage = ignoreEndIndex !== -1 ? errorMessage.slice(0, ignoreEndIndex) : errorMessage;

    // add more user guide for invalid API key
    if (msg.search(/401|invalid|not valid/gi) !== -1) {
      errorMessage =
        "Something went wrong. Please check if you have set your API key." +
        "\nPath: Settings > copilot plugin > Basic Tab > Set Keys." +
        "\nOr check model config" +
        "\nError Details: " +
        errorMessage;
    }
    return errorMessage;
  }
}
