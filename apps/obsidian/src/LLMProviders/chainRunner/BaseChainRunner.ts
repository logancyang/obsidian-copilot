import { ABORT_REASON, AI_SENDER } from "@/constants";
import { logError, logInfo } from "@/logger";
import { ChatMessage, ResponseMetadata } from "@/types/message";
import { err2String, formatDateTime } from "@/utils";
import { formatUsageCapError } from "@/utils/usageCapError";
import ChainManager from "@/LLMProviders/chainManager";

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
    const shouldAddMessage =
      (fullAIResponse || responseMetadata?.wasTruncated) &&
      !(abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT);

    if (shouldAddMessage) {
      const l5Text = userMessage.contextEnvelope?.layers.find((l) => l.id === "L5_USER")?.text;
      const inputForMemory = l5Text || userMessage.originalMessage || userMessage.message;
      const outputForMemory =
        llmFormattedOutput || fullAIResponse || "[Response truncated - no content generated]";
      await this.chainManager.memoryManager.saveContext(
        { input: inputForMemory },
        { output: outputForMemory }
      );

      const displayMessage =
        fullAIResponse ||
        (responseMetadata?.wasTruncated
          ? "_[The model stopped at its maximum response length before generating any content.]_"
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

      updateCurrentAiMessage("");
    } else if (abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      updateCurrentAiMessage("");
    }
    const historyMessages = (
      this.chainManager.memoryManager.getMemory().chatHistory as { messages?: unknown[] }
    ).messages;
    logInfo("Chat memory updated:\n", {
      turns: Array.isArray(historyMessages) ? historyMessages.length : 0,
    });

    const MAX_LOG_LENGTH = 2000;
    try {
      const { parseToolCallMarkers } = await import("./utils/toolCallParser");
      const parsed = parseToolCallMarkers(fullAIResponse);
      let textOnly = (parsed.segments as { type: string; content: string }[])
        .map((seg) => (seg.type === "text" ? seg.content : ""))
        .join("")
        .trim();
      if (!textOnly) textOnly = fullAIResponse || "";
      const snippet =
        textOnly.length > MAX_LOG_LENGTH
          ? textOnly.slice(0, MAX_LOG_LENGTH) + "... (truncated)"
          : textOnly;
      logInfo("Final AI response (truncated):\n", snippet);
    } catch {
      const s = typeof fullAIResponse === "string" ? fullAIResponse : String(fullAIResponse ?? "");
      const clipped =
        s.length > MAX_LOG_LENGTH ? s.slice(0, MAX_LOG_LENGTH) + "... (truncated)" : s;
      logInfo("Final AI response (truncated):\n", clipped);
    }
    return fullAIResponse;
  }

  protected async handleError(error: unknown, processErrorChunk: (message: string) => void) {
    const msg = err2String(error);
    logError("Error during LLM invocation:", msg);
    const capMessage = formatUsageCapError(error);
    if (capMessage) {
      processErrorChunk(capMessage);
      return;
    }
    const errorData =
      (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error || msg;
    const errorCode = (errorData as { code?: string })?.code || msg;
    let errorMessage = "";

    if ((error as { message?: string })?.message?.includes("Invalid license key")) {
      errorMessage = "Invalid Copilot Plus license key. Please check your license key in settings.";
    } else if (errorCode === "model_not_found") {
      errorMessage =
        "You do not have access to this model or the model does not exist, please check with your API provider.";
    } else {
      errorMessage = `${errorCode}`;
    }

    logError(errorData);
    processErrorChunk(this.enhancedErrorMsg(errorMessage, msg, error));
  }

  private enhancedErrorMsg(errorMessage: string, msg: string, error: unknown) {
    const ignoreEndIndex = errorMessage.search("Troubleshooting URL");
    errorMessage = ignoreEndIndex !== -1 ? errorMessage.slice(0, ignoreEndIndex) : errorMessage;

    if (this.isAuthenticationError(error, msg)) {
      errorMessage =
        "Something went wrong. Please check if you have set your API key." +
        "\nPath: Settings > Copilot > BYOK." +
        "\nOr check model config" +
        "\nError Details: " +
        errorMessage;
    }
    return errorMessage;
  }

  private isAuthenticationError(error: unknown, normalizedMessage: string): boolean {
    const responseError = (
      error as {
        response?: {
          status?: number;
          data?: {
            error?: { status?: number | string; code?: string; message?: string; type?: string };
          };
        };
      }
    )?.response;
    const errorData = responseError?.data?.error ?? (error as { error?: unknown })?.error;
    const rawStatus = responseError?.status ?? (errorData as { status?: number | string })?.status;
    const statusCode = typeof rawStatus === "string" ? Number.parseInt(rawStatus, 10) : rawStatus;
    const errorObject =
      typeof errorData === "object" && errorData !== null
        ? (errorData as Record<string, unknown>)
        : undefined;
    const loweredMessage = (
      typeof errorObject?.message === "string" ? errorObject.message : normalizedMessage
    ).toLowerCase();
    const loweredCode = typeof errorObject?.code === "string" ? errorObject.code.toLowerCase() : "";
    const loweredType = typeof errorObject?.type === "string" ? errorObject.type.toLowerCase() : "";

    if (statusCode === 401) {
      return true;
    }

    const authHints = [
      "api key",
      "apikey",
      "unauthorized",
      "authentication",
      "invalid authentication",
    ];
    return authHints.some(
      (hint) =>
        loweredMessage.includes(hint) || loweredCode.includes(hint) || loweredType.includes(hint)
    );
  }
}
