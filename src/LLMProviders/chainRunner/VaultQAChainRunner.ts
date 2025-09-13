import { ABORT_REASON, RETRIEVED_DOCUMENT_TAG } from "@/constants";
import { logInfo } from "@/logger";
import { HybridRetriever } from "@/search/hybridRetriever";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";
import { getSettings, getSystemPrompt } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import {
  extractChatHistory,
  extractUniqueTitlesFromDocs,
  getMessageRole,
  withSuppressedTokenWarnings,
} from "@/utils";
import { BaseChainRunner } from "./BaseChainRunner";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";

export class VaultQAChainRunner extends BaseChainRunner {
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
      // Tiered lexical retriever doesn't need index check - it builds indexes on demand

      // Get chat history from memory
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const chatHistory = extractChatHistory(memoryVariables);

      // Generate standalone question from user message + chat history
      // This is similar to what the conversational retrieval chain does
      let standaloneQuestion = userMessage.message;
      if (chatHistory.length > 0) {
        // For simplicity, we'll use the original question directly
        // The original chain would rephrase it, but this approach should work for most cases
        standaloneQuestion = userMessage.message;
      }

      // Create retriever based on semantic search setting
      const settings = getSettings();
      const retriever = settings.enableSemanticSearchV3
        ? new HybridRetriever({
            minSimilarityScore: 0.01,
            maxK: settings.maxSourceChunks,
            salientTerms: [],
          })
        : new TieredLexicalRetriever(app, {
            minSimilarityScore: 0.01,
            maxK: settings.maxSourceChunks,
            salientTerms: [],
            timeRange: undefined,
            textWeight: undefined,
            returnAll: false,
            useRerankerThreshold: undefined,
          });

      // Retrieve relevant documents
      const retrievedDocs = await retriever.getRelevantDocuments(standaloneQuestion);

      // Store retrieved documents for sources
      this.chainManager.storeRetrieverDocuments(retrievedDocs);

      // Format documents as context with XML tags
      const context = retrievedDocs
        .map(
          (doc: any) =>
            `<${RETRIEVED_DOCUMENT_TAG}>\n${doc.pageContent}\n</${RETRIEVED_DOCUMENT_TAG}>`
        )
        .join("\n\n");

      // Create messages array
      const messages: any[] = [];

      // Add system message with QA instruction
      const systemPrompt = getSystemPrompt();
      const qaInstructions =
        "\n\nAnswer the question with as detailed as possible based only on the following context:\n" +
        context;
      const fullSystemMessage = systemPrompt + qaInstructions;

      const chatModel = this.chainManager.chatModelManager.getChatModel();
      if (fullSystemMessage) {
        messages.push({
          role: getMessageRole(chatModel),
          content: fullSystemMessage,
        });
      }

      // Add chat history
      for (const entry of chatHistory) {
        messages.push({ role: entry.role, content: entry.content });
      }

      // Add current user question - support multimodal content if available
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
      const chatStream = await withSuppressedTokenWarnings(() =>
        this.chainManager.chatModelManager.getChatModel().stream(messages, {
          signal: abortController.signal,
        })
      );

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) {
          logInfo("VaultQA stream iteration aborted", { reason: abortController.signal.reason });
          break;
        }
        streamer.processChunk(chunk);
      }
    } catch (error: any) {
      // Check if the error is due to abort signal
      if (error.name === "AbortError" || abortController.signal.aborted) {
        logInfo("VaultQA stream aborted by user", { reason: abortController.signal.reason });
        // Don't show error message for user-initiated aborts
      } else {
        await this.handleError(error, addMessage, updateCurrentAiMessage);
      }
    }

    // Always get the response, even if partial
    let fullAIResponse = streamer.close();

    // Only skip saving if it's a new chat (clearing everything)
    if (abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      updateCurrentAiMessage("");
      return "";
    }

    // Add sources to the response
    fullAIResponse = this.addSourcestoResponse(fullAIResponse);

    return this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage
    );
  }

  private addSourcestoResponse(response: string): string {
    const docTitles = extractUniqueTitlesFromDocs(this.chainManager.getRetrievedDocuments());
    if (docTitles.length > 0) {
      const links = docTitles.map((title) => `- [[${title}]]`).join("\n");
      response += "\n\n#### Sources:\n\n" + links;
    }
    return response;
  }
}
