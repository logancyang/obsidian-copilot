import { ABORT_REASON, RETRIEVED_DOCUMENT_TAG } from "@/constants";
import { logInfo } from "@/logger";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";
import { MergedSemanticRetriever } from "@/search/v3/MergedSemanticRetriever";
import { extractTagsFromQuery } from "@/search/v3/utils/tagUtils";
import { getSettings, getSystemPrompt } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import {
  extractChatHistory,
  extractUniqueTitlesFromDocs,
  getMessageRole,
  withSuppressedTokenWarnings,
} from "@/utils";
import { BaseChainRunner } from "./BaseChainRunner";
import {
  formatSourceCatalog,
  getQACitationInstructionsConditional,
  sanitizeContentForCitations,
  addFallbackSources,
  type SourceCatalogEntry,
} from "./utils/citationUtils";
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
      const tags = this.extractTagTerms(standaloneQuestion);

      const sharedOptions = {
        minSimilarityScore: 0.01,
        maxK: settings.maxSourceChunks,
        salientTerms: tags.length > 0 ? [...tags] : ([] as string[]),
        timeRange: undefined,
        textWeight: undefined,
        returnAll: false,
        useRerankerThreshold: undefined,
      };

      const retriever = settings.enableSemanticSearchV3
        ? new MergedSemanticRetriever(app, {
            ...sharedOptions,
            returnAll: tags.length > 0 ? true : false,
            returnAllTags: tags.length > 0,
            tagTerms: tags,
          })
        : new TieredLexicalRetriever(app, {
            ...sharedOptions,
            returnAll: tags.length > 0 ? true : false,
            returnAllTags: tags.length > 0,
            tagTerms: tags,
          });

      // Retrieve relevant documents
      const retrievedDocs = await retriever.getRelevantDocuments(standaloneQuestion);

      // Store retrieved documents for sources
      this.chainManager.storeRetrieverDocuments(retrievedDocs);

      // Format documents as context with XML tags
      // Sanitize content to remove pre-existing citation markers

      const context = retrievedDocs
        .map((doc: any) => {
          const title = doc.metadata?.title || "Untitled";
          const path = doc.metadata?.path || title;
          return `<${RETRIEVED_DOCUMENT_TAG}>\n<title>${title}</title>\n<path>${path}</path>\n<content>\n${sanitizeContentForCitations(doc.pageContent)}\n</content>\n</${RETRIEVED_DOCUMENT_TAG}>`;
        })
        .join("\n\n");

      // Create messages array
      const messages: any[] = [];

      // Add system message with QA instruction
      const systemPrompt = getSystemPrompt();
      // Prepare citation mapping so the model can produce inline [#] and a Sources footer
      // Build an unnumbered source catalog to avoid biasing the model with arbitrary numbers
      // The model is instructed to assign [1..N] as it cites sources in the answer.
      const sourceEntries: SourceCatalogEntry[] = retrievedDocs
        .slice(0, Math.max(5, Math.min(20, retrievedDocs.length)))
        .map((d: any) => ({
          title: d.metadata?.title || d.metadata?.path || "Untitled",
          path: d.metadata?.path || d.metadata?.title || "",
        }));
      const sourceCatalog = formatSourceCatalog(sourceEntries).join("\n");

      const qaInstructions =
        "\n\nAnswer the question based only on the following context:\n" +
        context +
        getQACitationInstructionsConditional(settings.enableInlineCitations, sourceCatalog);
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
        await this.handleError(error, streamer.processErrorChunk.bind(streamer));
      }
    }

    // Always get the response, even if partial
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

    // Add sources to the response
    const fullAIResponse = this.addSourcestoResponse(result.content);

    await this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      undefined,
      undefined,
      responseMetadata
    );

    return fullAIResponse;
  }

  private addSourcestoResponse(response: string): string {
    const settings = getSettings();
    const retrievedDocs = this.chainManager.getRetrievedDocuments();
    const sources = extractUniqueTitlesFromDocs(retrievedDocs).map((title) => ({ title }));

    return addFallbackSources(response, sources, settings.enableInlineCitations);
  }

  /**
   * Extracts hash-prefixed tags from the current query so Vault QA can trigger tag-aware retrieval.
   */
  private extractTagTerms(query: string): string[] {
    return extractTagsFromQuery(query);
  }
}
