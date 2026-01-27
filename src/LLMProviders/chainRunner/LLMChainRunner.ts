import { ABORT_REASON, ModelCapability } from "@/constants";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { findCustomModel, withSuppressedTokenWarnings } from "@/utils";
import { BaseChainRunner } from "./BaseChainRunner";
import { loadAndAddChatHistory } from "./utils/chatHistoryUtils";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import { getModelKey } from "@/aiParams";

export class LLMChainRunner extends BaseChainRunner {
  /**
   * Construct messages array using envelope-based context (L1-L5 layers)
   * Requires context envelope - throws error if unavailable
   */
  private async constructMessages(userMessage: ChatMessage): Promise<any[]> {
    // Require envelope for LLM chain
    if (!userMessage.contextEnvelope) {
      throw new Error(
        "[LLMChainRunner] Context envelope is required but not available. Cannot proceed with LLM chain."
      );
    }

    logInfo("[LLMChainRunner] Using envelope-based context");

    // Convert envelope to messages (L1 system + L2+L3+L5 user)
    const baseMessages = LayerToMessagesConverter.convert(userMessage.contextEnvelope, {
      includeSystemMessage: true,
      mergeUserContent: true,
      debug: false,
    });

    const messages: any[] = [];

    // Add system message (L1)
    const systemMessage = baseMessages.find((m) => m.role === "system");
    if (systemMessage) {
      messages.push(systemMessage);
    }

    // Add chat history (L4)
    const memory = this.chainManager.memoryManager.getMemory();
    await loadAndAddChatHistory(memory, messages);

    // Add user message (L2+L3+L5 merged)
    const userMessageContent = baseMessages.find((m) => m.role === "user");
    if (userMessageContent) {
      // Handle multimodal content if present
      if (userMessage.content && Array.isArray(userMessage.content)) {
        // Merge envelope text with multimodal content (images)
        const updatedContent = userMessage.content.map((item: any) => {
          if (item.type === "text") {
            return { ...item, text: userMessageContent.content };
          }
          return item;
        });
        messages.push({
          role: "user",
          content: updatedContent,
        });
      } else {
        messages.push(userMessageContent);
      }
    }

    return messages;
  }

  async run(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string> {
    // Check if the current model has reasoning capability
    const settings = getSettings();
    const modelKey = getModelKey();
    let excludeThinking = false;

    try {
      const currentModel = findCustomModel(modelKey, settings.activeModels);
      // Exclude thinking blocks if model doesn't have REASONING capability
      excludeThinking = !currentModel.capabilities?.includes(ModelCapability.REASONING);
    } catch (error) {
      // If we can't find the model, default to including thinking blocks
      logInfo(
        "Could not determine model capabilities, defaulting to include thinking blocks",
        error
      );
    }

    const streamer = new ThinkBlockStreamer(updateCurrentAiMessage, excludeThinking);

    try {
      // Construct messages using envelope or legacy approach
      const messages = await this.constructMessages(userMessage);

      // Record the payload for debugging (includes layered view if envelope available)
      const chatModel = this.chainManager.chatModelManager.getChatModel();
      const modelName = (chatModel as { modelName?: string } | undefined)?.modelName;
      recordPromptPayload({
        messages,
        modelName,
        contextEnvelope: userMessage.contextEnvelope,
      });

      logInfo("Final Request to AI:\n", messages);

      // Stream with abort signal
      const chatStream = await withSuppressedTokenWarnings(() =>
        this.chainManager.chatModelManager.getChatModel().stream(messages, {
          signal: abortController.signal,
        })
      );

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) {
          logInfo("Stream iteration aborted", { reason: abortController.signal.reason });
          break;
        }
        streamer.processChunk(chunk);
      }
    } catch (error: any) {
      // Check if the error is due to abort signal
      if (error.name === "AbortError" || abortController.signal.aborted) {
        logInfo("Stream aborted by user", { reason: abortController.signal.reason });
        // Don't show error message for user-initiated aborts
      } else {
        await this.handleError(error, streamer.processErrorChunk.bind(streamer));
      }
    }

    // Always return the response, even if partial
    const result = streamer.close();

    const responseMetadata = {
      wasTruncated: result.wasTruncated,
      tokenUsage: result.tokenUsage ?? undefined,
    };

    // Only skip saving if it's a new chat (clearing everything)
    if (abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      updateCurrentAiMessage("");
      return "";
    }

    await this.handleResponse(
      result.content,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      undefined,
      undefined,
      responseMetadata
    );

    return result.content;
  }
}
