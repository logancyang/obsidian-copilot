import { ABORT_REASON, ModelCapability } from "@/constants";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { logInfo } from "@/logger";
import { ChatMessage } from "@/types/message";
import { withSuppressedTokenWarnings } from "@/utils";
import { BaseChainRunner } from "./BaseChainRunner";
import { loadAndAddChatHistory } from "./utils/chatHistoryUtils";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";

export class LLMChainRunner extends BaseChainRunner {
  private async constructMessages(
    userMessage: ChatMessage
  ): Promise<{ role: string; content: string | unknown[] }[]> {
    if (!userMessage.contextEnvelope) {
      throw new Error(
        "[LLMChainRunner] Context envelope is required but not available. Cannot proceed with LLM chain."
      );
    }

    logInfo("[LLMChainRunner] Using envelope-based context");

    const baseMessages = LayerToMessagesConverter.convert(userMessage.contextEnvelope, {
      includeSystemMessage: true,
      mergeUserContent: true,
      debug: false,
    });

    const messages: { role: string; content: string | unknown[] }[] = [];

    const systemMessage = baseMessages.find((m) => m.role === "system");
    if (systemMessage) {
      messages.push(systemMessage);
    }

    const memory = this.chainManager.memoryManager.getMemory();
    await loadAndAddChatHistory(memory, messages);

    const userMessageContent = baseMessages.find((m) => m.role === "user");
    if (userMessageContent) {
      if (userMessage.content && Array.isArray(userMessage.content)) {
        const updatedContent = userMessage.content.map((item: { type?: string }) => {
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
    let excludeThinking = false;

    const currentModel = this.chainManager.chatModelManager.getActiveModel();
    if (currentModel) {
      excludeThinking = !currentModel.capabilities?.includes(ModelCapability.REASONING);
    } else {
      logInfo("Could not determine model capabilities, defaulting to include thinking blocks");
    }

    const streamer = new ThinkBlockStreamer(updateCurrentAiMessage, excludeThinking);

    try {
      const messages = await this.constructMessages(userMessage);

      const chatModel = this.chainManager.chatModelManager.getChatModel();
      const modelName = (chatModel as { modelName?: string } | undefined)?.modelName;
      recordPromptPayload({
        messages,
        modelName,
        contextEnvelope: userMessage.contextEnvelope,
      });

      logInfo("Final Request to AI:\n", messages);

      const chatStream = await withSuppressedTokenWarnings(() =>
        this.chainManager.chatModelManager.getChatModel().stream(messages as never, {
          signal: abortController.signal,
        })
      );

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) {
          logInfo("Stream iteration aborted", { reason: abortController.signal.reason });
          break;
        }
        streamer.processChunk(chunk as Parameters<typeof streamer.processChunk>[0]);
      }
    } catch (error: unknown) {
      const errorName = error instanceof Error ? error.name : "";
      if (errorName === "AbortError" || abortController.signal.aborted) {
        logInfo("Stream aborted by user", { reason: abortController.signal.reason });
      } else {
        await this.handleError(error, (message) => streamer.processErrorChunk(message));
      }
    }

    const result = streamer.close();

    const responseMetadata = {
      wasTruncated: result.wasTruncated,
      tokenUsage: result.tokenUsage ?? undefined,
    };

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
