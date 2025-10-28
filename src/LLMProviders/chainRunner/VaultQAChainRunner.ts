import { ABORT_REASON, RETRIEVED_DOCUMENT_TAG } from "@/constants";
import { getStandaloneQuestion } from "@/chainUtils";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { logInfo } from "@/logger";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";
import { MergedSemanticRetriever } from "@/search/v3/MergedSemanticRetriever";
import { extractTagsFromQuery } from "@/search/v3/utils/tagUtils";
import { getSettings } from "@/settings/model";
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
  hasInlineCitations,
  type SourceCatalogEntry,
} from "./utils/citationUtils";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
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

      // Require envelope for VaultQA
      const envelope = userMessage.contextEnvelope;
      if (!envelope) {
        throw new Error(
          "[VaultQA] Context envelope is required but not available. Cannot proceed with VaultQA chain."
        );
      }

      // Step 1: Extract L5 (raw user query) from envelope
      // Tags MUST be extracted from L5 BEFORE condensing to preserve them for tag-aware retrieval
      const l5User = envelope.layers.find((l) => l.id === "L5_USER");
      const rawUserQuery = l5User?.text || userMessage.message;

      // Step 2: Extract tags from raw query (BEFORE condensing!)
      const tags = this.extractTagTerms(rawUserQuery);
      logInfo("[VaultQA] Extracted tags before condensing:", tags);

      // Step 3: Get chat history from memory (L4)
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const chatHistory = extractChatHistory(memoryVariables);

      // Step 4: Condense L4 + L5 into standalone question for RAG retrieval
      // This improves retrieval by incorporating conversation context
      let standaloneQuestion = rawUserQuery;
      if (chatHistory.length > 0) {
        logInfo("[VaultQA] Condensing query with chat history for better retrieval");
        standaloneQuestion = await getStandaloneQuestion(rawUserQuery, chatHistory);
        logInfo("[VaultQA] Standalone question:", standaloneQuestion);
      }

      // Step 5: Create retriever based on semantic search setting
      const settings = getSettings();

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

      // Step 6: Build messages array with envelope-aware logic
      const messages: any[] = [];
      const chatModel = this.chainManager.chatModelManager.getChatModel();

      // Prepare RAG context and citation instructions
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

      // Build messages using envelope-based context construction
      logInfo("[VaultQA] Using envelope-based context construction with LayerToMessagesConverter");

      // Use LayerToMessagesConverter to get base messages with L1+L2 system, L3+L5 user
      // This ensures smart referencing and L2 Context Library are preserved
      const baseMessages = LayerToMessagesConverter.convert(envelope, {
        includeSystemMessage: true,
        mergeUserContent: true,
        debug: false,
      });

      // Add system message (L1 + L2 Context Library only - no RAG)
      const systemMessage = baseMessages.find((m) => m.role === "system");
      if (systemMessage) {
        messages.push({
          role: getMessageRole(chatModel),
          content: systemMessage.content,
        });
      }

      // Insert L4 (chat history) between system and user
      for (const entry of chatHistory) {
        messages.push({ role: entry.role, content: entry.content });
      }

      // Add user message with RAG prepended
      // User message now contains: RAG results + citations + L3 smart references + L5
      // LayerToMessagesConverter already handles smart referencing:
      // - Items in L2 → referenced by ID
      // - Items NOT in L2 → full content
      const userMessageContent = baseMessages.find((m) => m.role === "user");
      if (userMessageContent) {
        // Prepend RAG results and citations to user content with proper separator
        const enhancedUserContent = qaInstructions + "\n\n" + userMessageContent.content;

        // Handle multimodal content if present
        if (userMessage.content && Array.isArray(userMessage.content)) {
          const updatedContent = userMessage.content.map((item: any) => {
            if (item.type === "text") {
              return { ...item, text: enhancedUserContent };
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
            content: enhancedUserContent,
          });
        }
      }

      // Record the payload for debugging (includes layered view if envelope available)
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

    // Only add sources if the AI actually cited them (has inline citations like [^1], [^2])
    // Don't add fallback sources if there are no citations in the response
    if (!hasInlineCitations(response)) {
      return response;
    }

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
