import { ABORT_REASON } from "@/constants";
import { logInfo } from "@/logger";
import { getSystemPrompt } from "@/settings/model";
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
      const systemPrompt = getSystemPrompt();
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

      // Add current user message
      messages.push({
        role: "user",
        content: userMessage.message,
      });

      logInfo("==== Final Request to AI ====\n", messages);

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
        await this.handleError(error, addMessage, updateCurrentAiMessage);
      }
    }

    // Always return the response, even if partial
    const response = streamer.close();

    // Only skip saving if it's a new chat (clearing everything)
    if (abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      updateCurrentAiMessage("");
      return "";
    }

    return this.handleResponse(
      response,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage
    );
  }
}
