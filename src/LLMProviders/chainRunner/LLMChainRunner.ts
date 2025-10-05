import { ABORT_REASON } from "@/constants";
import { logInfo } from "@/logger";
import { getSystemPromptWithMemory } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { extractChatHistory, getMessageRole, withSuppressedTokenWarnings } from "@/utils";
import { BaseChainRunner } from "./BaseChainRunner";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";

export class LLMChainRunner extends BaseChainRunner {
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
    const streamer = new ThinkBlockStreamer(updateCurrentAiMessage);

    try {
      // Get chat history from memory
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const chatHistory = extractChatHistory(memoryVariables);

      // Create messages array starting with system message
      const messages: any[] = [];

      // Add system message if available
      const systemPrompt = await getSystemPromptWithMemory(this.chainManager.userMemoryManager);
      const chatModel = this.chainManager.chatModelManager.getChatModel();

      if (systemPrompt) {
        messages.push({
          role: getMessageRole(chatModel),
          content: systemPrompt,
        });
      }

      // Add chat history
      for (const entry of chatHistory) {
        messages.push({ role: entry.role, content: entry.content });
      }

      // Add current user message - support multimodal content if available
      if (userMessage.content && Array.isArray(userMessage.content)) {
        // For multimodal messages with images, replace the text content with processed text
        const updatedContent = userMessage.content.map((item: any) => {
          if (item.type === "text") {
            // Use processed message text that includes context
            return { ...item, text: userMessage.message };
          }
          return item;
        });
        messages.push({
          role: "user",
          content: updatedContent,
        });
      } else {
        messages.push({
          role: "user",
          content: userMessage.message,
        });
      }

      logInfo("Final Request to AI:\n", messages);

      // Stream with abort signal
      // Enable usage metadata for OpenAI models (stream_options may not be typed in all LangChain versions)
      const chatStream = await withSuppressedTokenWarnings(() =>
        this.chainManager.chatModelManager.getChatModel().stream(messages, {
          signal: abortController.signal,
          stream_options: { include_usage: true },
        } as any)
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
        await this.handleError(error, addMessage, updateCurrentAiMessage);
      }
    }

    // Always return the response, even if partial
    const result = streamer.close();

    const responseMetadata = {
      wasTruncated: result.wasTruncated,
      tokenUsage: result.tokenUsage || undefined,
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
