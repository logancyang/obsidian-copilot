import { getStandaloneQuestion } from "@/chainUtils";
import { AVAILABLE_TOOLS } from "@/components/chat-components/constants/tools";
import {
  ABORT_REASON,
  COMPOSER_OUTPUT_INSTRUCTIONS,
  LOADING_MESSAGES,
  MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT,
  ModelCapability,
} from "@/constants";
import {
  ImageBatchProcessor,
  ImageContent,
  ImageProcessingResult,
  MessageContent,
} from "@/imageProcessing/imageProcessor";
import { logInfo, logWarn } from "@/logger";
import { checkIsPlusUser } from "@/plusUtils";
import { getSettings, getSystemPromptWithMemory } from "@/settings/model";
import { writeToFileTool } from "@/tools/ComposerTools";
import { ToolManager } from "@/tools/toolManager";
import { ToolResultFormatter } from "@/tools/ToolResultFormatter";
import { ChatMessage } from "@/types/message";
import { getApiErrorMessage, getMessageRole, withSuppressedTokenWarnings } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { IntentAnalyzer } from "../intentAnalyzer";
import { BaseChainRunner } from "./BaseChainRunner";
import { ActionBlockStreamer } from "./utils/ActionBlockStreamer";
import {
  addChatHistoryToMessages,
  processedMessagesToTextOnly,
  processRawChatHistory,
} from "./utils/chatHistoryUtils";
import {
  addFallbackSources,
  formatSourceCatalog,
  getCitationInstructions,
  sanitizeContentForCitations,
  type SourceCatalogEntry,
} from "./utils/citationUtils";
import {
  extractSourcesFromSearchResults,
  formatSearchResultsForLLM,
  formatSearchResultStringForLLM,
  logSearchResultsDebugTable,
} from "./utils/searchResultUtils";
import {
  buildLocalSearchInnerContent,
  renderCiCMessage,
  wrapLocalSearchPayload,
} from "./utils/cicPromptUtils";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import { deduplicateSources } from "./utils/toolExecution";

export class CopilotPlusChainRunner extends BaseChainRunner {
  private async processImageUrls(urls: string[]): Promise<ImageProcessingResult> {
    const failedImages: string[] = [];
    const processedImages = await ImageBatchProcessor.processUrlBatch(
      urls,
      failedImages,
      this.chainManager.app.vault
    );
    ImageBatchProcessor.showFailedImagesNotice(failedImages);
    return processedImages;
  }

  private async processChatInputImages(content: MessageContent[]): Promise<ImageProcessingResult> {
    const failedImages: string[] = [];
    const processedImages = await ImageBatchProcessor.processChatImageBatch(
      content,
      failedImages,
      this.chainManager.app.vault
    );
    ImageBatchProcessor.showFailedImagesNotice(failedImages);
    return processedImages;
  }

  private extractNoteContent(textContent: string): string {
    // Extract content from both <note_context> and <active_note> blocks, but not from <url_content> blocks
    const noteContextRegex = /<note_context>([\s\S]*?)<\/note_context>/g;
    const activeNoteRegex = /<active_note>([\s\S]*?)<\/active_note>/g;
    const contentRegex = /<content>([\s\S]*?)<\/content>/g;

    let noteContent = "";
    let match;

    // Find all note_context blocks
    while ((match = noteContextRegex.exec(textContent)) !== null) {
      const noteBlock = match[1];
      // Extract content from within this note_context block
      let contentMatch;
      while ((contentMatch = contentRegex.exec(noteBlock)) !== null) {
        noteContent += contentMatch[1] + "\n\n";
      }
    }

    // Find all active_note blocks
    while ((match = activeNoteRegex.exec(textContent)) !== null) {
      const noteBlock = match[1];
      // Extract content from within this active_note block
      let contentMatch;
      while ((contentMatch = contentRegex.exec(noteBlock)) !== null) {
        noteContent += contentMatch[1] + "\n\n";
      }
    }

    return noteContent.trim();
  }

  private async extractEmbeddedImages(content: string, sourcePath?: string): Promise<string[]> {
    // Match both wiki-style ![[image.ext]] and standard markdown ![alt](image.ext)
    const wikiImageRegex = /!\[\[(.*?\.(png|jpg|jpeg|gif|webp|bmp|svg))\]\]/g;
    // Updated regex to handle URLs with or without file extensions
    const markdownImageRegex = /!\[.*?\]\(([^)]+)\)/g;

    const resolvedImages: string[] = [];

    // Process wiki-style images
    const wikiMatches = [...content.matchAll(wikiImageRegex)];
    for (const match of wikiMatches) {
      const imageName = match[1];

      // If we have a source path and access to the app, resolve the wikilink
      if (sourcePath) {
        const resolvedFile = app.metadataCache.getFirstLinkpathDest(imageName, sourcePath);

        if (resolvedFile) {
          // Use the resolved path
          resolvedImages.push(resolvedFile.path);
        } else {
          // If file not found, log a warning but still include the raw filename
          logWarn(`Could not resolve embedded image: ${imageName} from source: ${sourcePath}`);
          resolvedImages.push(imageName);
        }
      } else {
        // Fallback to raw filename if no source path available
        resolvedImages.push(imageName);
      }
    }

    // Process standard markdown images
    const mdMatches = [...content.matchAll(markdownImageRegex)];
    for (const match of mdMatches) {
      const imagePath = match[1].trim();

      // Skip empty paths
      if (!imagePath) continue;

      // Handle external URLs (http://, https://, etc.)
      if (imagePath.match(/^https?:\/\//)) {
        // Include external URLs - they will be processed by processImageUrls
        // The ImageProcessor will validate if it's actually an image
        resolvedImages.push(imagePath);
        continue;
      }

      // For local paths, resolve them using Obsidian's metadata cache
      // Let ImageBatchProcessor handle validation of whether it's actually an image
      // Clean up the path (remove any leading ./ or /)
      const cleanPath = imagePath.replace(/^\.\//, "").replace(/^\//, "");

      // If we have a source path and access to the app, resolve the path
      if (sourcePath) {
        const resolvedFile = app.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath);

        if (resolvedFile) {
          // Use the resolved path
          resolvedImages.push(resolvedFile.path);
        } else {
          // If file not found, still include the raw path
          // Let ImageBatchProcessor handle validation
          resolvedImages.push(cleanPath);
        }
      } else {
        // Fallback to raw path if no source path available
        resolvedImages.push(cleanPath);
      }
    }

    return resolvedImages;
  }

  protected async buildMessageContent(
    textContent: string,
    userMessage: ChatMessage
  ): Promise<MessageContent[]> {
    const failureMessages: string[] = [];
    const successfulImages: ImageContent[] = [];
    const settings = getSettings();

    // Collect all image sources
    const imageSources: { urls: string[]; type: string }[] = [];

    // NOTE: Context URLs are web pages we fetched content from, NOT images to process
    // Do not add context URLs as image sources

    // Process embedded images only if setting is enabled
    if (settings.passMarkdownImages) {
      // Determine source path for resolving wikilinks
      let sourcePath: string | undefined;

      // First, check if we have context notes
      if (userMessage.context?.notes && userMessage.context.notes.length > 0) {
        // Use the first note in context as the source path
        sourcePath = userMessage.context.notes[0].path;
      } else {
        // Fallback to active file if no context notes
        const activeFile = this.chainManager.app?.workspace.getActiveFile();
        if (activeFile) {
          sourcePath = activeFile.path;
        }
      }

      // Extract note content (excluding URL content) for image processing
      const noteContent = this.extractNoteContent(textContent);
      if (noteContent) {
        const embeddedImages = await this.extractEmbeddedImages(noteContent, sourcePath);
        if (embeddedImages.length > 0) {
          imageSources.push({ urls: embeddedImages, type: "embedded" });
        }
      }
    }

    // Process all image sources
    for (const source of imageSources) {
      const result = await this.processImageUrls(source.urls);
      successfulImages.push(...result.successfulImages);
      failureMessages.push(...result.failureDescriptions);
    }

    // Process existing chat content images if present
    const existingContent = userMessage.content;
    if (existingContent && existingContent.length > 0) {
      const result = await this.processChatInputImages(existingContent);
      successfulImages.push(...result.successfulImages);
      failureMessages.push(...result.failureDescriptions);
    }

    // Let the LLM know about the image processing failures
    let finalText = textContent;
    if (failureMessages.length > 0) {
      finalText = `${textContent}\n\nNote: \n${failureMessages.join("\n")}\n`;
    }

    const messageContent: MessageContent[] = [
      {
        type: "text",
        text: finalText,
      },
    ];

    // Add successful images after the text content
    if (successfulImages.length > 0) {
      messageContent.push(...successfulImages);
    }

    return messageContent;
  }

  private hasCapability(model: BaseChatModel, capability: ModelCapability): boolean {
    const modelName = (model as any).modelName || (model as any).model || "";
    const customModel = this.chainManager.chatModelManager.findModelByName(modelName);
    return customModel?.capabilities?.includes(capability) ?? false;
  }

  protected isMultimodalModel(model: BaseChatModel): boolean {
    return this.hasCapability(model, ModelCapability.VISION);
  }

  /**
   * If userMessage.message contains '@composer', append COMPOSER_OUTPUT_INSTRUCTIONS to the text content.
   * Handles both string and MessageContent[] types.
   */
  private appendComposerInstructionsIfNeeded(content: string, userMessage: ChatMessage): string {
    if (!userMessage.message || !userMessage.message.includes("@composer")) {
      return content;
    }
    const composerPrompt = `<OUTPUT_FORMAT>\n${COMPOSER_OUTPUT_INSTRUCTIONS}\n</OUTPUT_FORMAT>`;
    return `${content}\n\n${composerPrompt}`;
  }

  private async streamMultimodalResponse(
    textContent: string,
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void
  ): Promise<{ content: string; wasTruncated: boolean; tokenUsage: any }> {
    // Get chat history
    const memory = this.chainManager.memoryManager.getMemory();
    const memoryVariables = await memory.loadMemoryVariables({});
    // Use the raw history array which contains BaseMessage objects
    const rawHistory = memoryVariables.history || [];

    // Create messages array starting with system message
    const messages: any[] = [];

    // Add system message if available
    let fullSystemMessage = await this.getSystemPrompt();

    // Add chat history context to system message if exists
    if (rawHistory.length > 0) {
      fullSystemMessage +=
        "\n\nThe following is the relevant conversation history. Use this context to maintain consistency in your responses:";
    }

    // Get chat model for role determination for O-series models
    const chatModel = this.chainManager.chatModelManager.getChatModel();

    // Add the combined system message with appropriate role
    if (fullSystemMessage) {
      messages.push({
        role: getMessageRole(chatModel),
        content: `${fullSystemMessage}\nIMPORTANT: Maintain consistency with previous responses in the conversation. If you've provided information about a person or topic before, use that same information in follow-up questions.`,
      });
    }

    // Add chat history - safely handle different message formats
    addChatHistoryToMessages(rawHistory, messages);

    // Get the current chat model
    const chatModelCurrent = this.chainManager.chatModelManager.getChatModel();
    const isMultimodalCurrent = this.isMultimodalModel(chatModelCurrent);

    // Build message content with text and images for multimodal models, or just text for text-only models
    const content: string | MessageContent[] = isMultimodalCurrent
      ? await this.buildMessageContent(textContent, userMessage)
      : textContent;

    // Add current user message
    messages.push({
      role: "user",
      content,
    });

    const enhancedUserMessage = content instanceof Array ? (content[0] as any).text : content;
    logInfo("Enhanced user message: ", enhancedUserMessage);
    logInfo("Final request to AI", { messages: messages.length });
    const actionStreamer = new ActionBlockStreamer(ToolManager, writeToFileTool);
    const thinkStreamer = new ThinkBlockStreamer(updateCurrentAiMessage);

    // Wrap the stream call with warning suppression
    // Enable usage metadata for OpenAI models (stream_options may not be typed in all LangChain versions)
    const chatStream = await withSuppressedTokenWarnings(() =>
      this.chainManager.chatModelManager.getChatModel().stream(messages, {
        signal: abortController.signal,
        // stream_options: { include_usage: true },
      } as any)
    );

    for await (const chunk of chatStream) {
      if (abortController.signal.aborted) {
        logInfo("CopilotPlus multimodal stream iteration aborted", {
          reason: abortController.signal.reason,
        });
        break;
      }
      for await (const processedChunk of actionStreamer.processChunk(chunk)) {
        thinkStreamer.processChunk(processedChunk);
      }
    }

    const result = thinkStreamer.close();

    // Log token usage and show warning if truncated
    if (result.tokenUsage) {
      logInfo("CopilotPlus token usage:", result.tokenUsage);
    }
    if (result.wasTruncated) {
      logWarn("CopilotPlus response was truncated due to token limit", result.tokenUsage);
    }

    return {
      content: result.content,
      wasTruncated: result.wasTruncated,
      tokenUsage: result.tokenUsage,
    };
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
      updateLoadingMessage?: (message: string) => void;
    }
  ): Promise<string> {
    const { updateLoadingMessage } = options;
    let fullAIResponse = "";
    let sources: { title: string; path: string; score: number; explanation?: any }[] = [];
    let currentPartialResponse = "";
    const isPlusUser = await checkIsPlusUser({
      isCopilotPlus: true,
    });
    if (!isPlusUser) {
      await this.handleError(new Error("Invalid license key"), addMessage, updateCurrentAiMessage);
      return "";
    }

    // Wrapper to track partial response
    const trackAndUpdateAiMessage = (message: string) => {
      currentPartialResponse = message;
      updateCurrentAiMessage(message);
    };

    try {
      logInfo("==== Step 1: Analyzing intent ====");
      let toolCalls;
      // Use the original message for intent analysis
      const messageForAnalysis = userMessage.originalMessage || userMessage.message;
      try {
        toolCalls = await IntentAnalyzer.analyzeIntent(messageForAnalysis);
      } catch (error: any) {
        return this.handleResponse(
          getApiErrorMessage(error),
          userMessage,
          abortController,
          addMessage,
          updateCurrentAiMessage
        );
      }

      // Use the same removeAtCommands logic as IntentAnalyzer
      const cleanedUserMessage = userMessage.message
        .split(" ")
        .filter((word) => !AVAILABLE_TOOLS.includes(word.toLowerCase()))
        .join(" ")
        .trim();

      const { toolOutputs, sources: toolSources } = await this.executeToolCalls(
        toolCalls,
        updateLoadingMessage
      );

      // Use sources from tool execution
      sources = toolSources;

      // Check if localSearch has results
      const localSearchResult = toolOutputs.find(
        (output) => output.tool === "localSearch" && output.output != null
      );
      const hasLocalSearchWithResults = localSearchResult && sources.length > 0;

      // Format chat history from memory
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const rawHistory = memoryVariables.history || [];

      // Process history consistently - same data used for both LLM and question condensing
      const processedHistory = processRawChatHistory(rawHistory);
      const chatHistory = processedMessagesToTextOnly(processedHistory);

      // Get standalone question if we have chat history
      let questionForEnhancement = cleanedUserMessage;
      if (chatHistory.length > 0) {
        logInfo("Condensing question");
        questionForEnhancement = await getStandaloneQuestion(cleanedUserMessage, chatHistory);
        logInfo("Condensed standalone question: ", questionForEnhancement);
      }

      // Enhance with ALL tool outputs including localSearch
      let enhancedUserMessage = this.prepareEnhancedUserMessage(
        questionForEnhancement,
        toolOutputs
      );

      // If localSearch has actual results and no other tools, add QA-style instruction to maintain same behavior
      const hasOtherTools = toolOutputs.some(
        (output) => output.tool !== "localSearch" && output.output != null
      );
      if (hasLocalSearchWithResults && !hasOtherTools) {
        // The QA format is already handled in prepareEnhancedUserMessage, just add the instruction
        enhancedUserMessage = `Answer the question with as detailed as possible based only on the following context:\n${enhancedUserMessage}`;
      }

      // Append composer instruction to the end of text prompt to enhance instruction following.
      enhancedUserMessage = this.appendComposerInstructionsIfNeeded(
        enhancedUserMessage,
        userMessage
      );

      logInfo("Invoking LLM with all tool results");
      const streamResult = await this.streamMultimodalResponse(
        enhancedUserMessage,
        userMessage,
        abortController,
        trackAndUpdateAiMessage
      );
      fullAIResponse = streamResult.content;

      // Store truncation metadata for handleResponse
      const responseMetadata = {
        wasTruncated: streamResult.wasTruncated,
        tokenUsage: streamResult.tokenUsage,
      };
      (this as any)._responseMetadata = responseMetadata;
    } catch (error: any) {
      // Reset loading message to default
      updateLoadingMessage?.(LOADING_MESSAGES.DEFAULT);

      // Check if the error is due to abort signal
      if (error.name === "AbortError" || abortController.signal.aborted) {
        logInfo("CopilotPlus stream aborted by user", { reason: abortController.signal.reason });
        // Don't show error message for user-initiated aborts
      } else {
        await this.handleError(error, addMessage, updateCurrentAiMessage);
      }
    }

    // Only skip saving if it's a new chat (clearing everything)
    if (abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      updateCurrentAiMessage("");
      return "";
    }

    // If aborted but not a new chat, use the partial response
    if (abortController.signal.aborted && currentPartialResponse) {
      fullAIResponse = currentPartialResponse;
    }

    // Add fallback sources if citations are enabled and missing
    const settings = getSettings();
    const fallbackSources =
      this.lastCitationSources && this.lastCitationSources.length > 0
        ? this.lastCitationSources
        : ((sources as any[]) || []).map((source) => ({ title: source.title, path: source.path }));

    fullAIResponse = addFallbackSources(
      fullAIResponse,
      fallbackSources,
      settings.enableInlineCitations
    );

    // Get response metadata if available
    const responseMetadata = (this as any)._responseMetadata;
    delete (this as any)._responseMetadata;

    await this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      sources,
      undefined,
      responseMetadata
    );

    return fullAIResponse;
  }

  private getSources(
    documents: any
  ): { title: string; path: string; score: number; explanation?: any }[] {
    if (!documents || !Array.isArray(documents)) {
      logWarn("No valid documents provided to getSources");
      return [];
    }
    return this.sortUniqueDocsByScore(documents);
  }

  private sortUniqueDocsByScore(documents: any[]): any[] {
    const uniqueDocs = new Map<string, any>();

    // Iterate through all documents
    for (const doc of documents) {
      if (!doc.title || (!doc?.score && !doc?.rerank_score)) {
        logWarn("Invalid document structure:", doc);
        continue;
      }

      // Use path as the unique key, falling back to title if path is not available
      const key = doc.path || doc.title;
      const currentDoc = uniqueDocs.get(key);
      const isReranked = doc && "rerank_score" in doc;
      const docScore = isReranked ? doc.rerank_score : doc.score;

      // If the document doesn't exist in the map, or if the new doc has a higher score, update the map
      if (!currentDoc || docScore > (currentDoc.score ?? 0)) {
        uniqueDocs.set(key, {
          title: doc.title,
          path: doc.path || doc.title, // Use path if available, otherwise use title
          score: docScore,
          isReranked: isReranked,
          explanation: doc.explanation || null, // Preserve explanation data
        });
      }
    }

    // Convert the map values back to an array and sort by score in descending order
    return Array.from(uniqueDocs.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  private async executeToolCalls(
    toolCalls: any[],
    updateLoadingMessage?: (message: string) => void
  ): Promise<{
    toolOutputs: { tool: string; output: any }[];
    sources: { title: string; path: string; score: number; explanation?: any }[];
  }> {
    const toolOutputs = [];
    const allSources: { title: string; path: string; score: number; explanation?: any }[] = [];

    for (const toolCall of toolCalls) {
      logInfo(`Step 2: Calling tool: ${toolCall.tool.name}`);
      if (toolCall.tool.name === "localSearch") {
        updateLoadingMessage?.(LOADING_MESSAGES.READING_FILES);
      } else if (toolCall.tool.name === "webSearch") {
        updateLoadingMessage?.(LOADING_MESSAGES.SEARCHING_WEB);
      } else if (toolCall.tool.name === "getFileTree") {
        updateLoadingMessage?.(LOADING_MESSAGES.READING_FILE_TREE);
      }
      const output = await ToolManager.callTool(toolCall.tool, toolCall.args);

      // Process localSearch results immediately
      if (toolCall.tool.name === "localSearch") {
        // Convert output to string if needed
        const outputStr = typeof output === "string" ? output : JSON.stringify(output);
        const result = { result: outputStr, success: output != null };
        const timeExpression = this.getTimeExpression(toolCalls);
        const processed = this.processLocalSearchResult(result, timeExpression);

        // Collect sources
        allSources.push(...processed.sources);

        // Store the formatted output for LLM
        toolOutputs.push({ tool: toolCall.tool.name, output: processed.formattedForLLM });
      } else {
        toolOutputs.push({ tool: toolCall.tool.name, output });
      }
    }

    return { toolOutputs, sources: deduplicateSources(allSources) };
  }

  // Persist citation lines built for this turn to reuse in fallback
  private lastCitationSources: { title?: string; path?: string }[] | null = null;

  private prepareEnhancedUserMessage(userMessage: string, toolOutputs: any[]) {
    let context = "";
    let hasLocalSearchWithResults = false;

    // Check if localSearch has actual results (non-empty documents array)
    const localSearchOutput = toolOutputs.find(
      (output) => output.tool === "localSearch" && output.output != null
    );

    if (localSearchOutput && typeof localSearchOutput.output === "string") {
      // Detect presence via XML content
      if (/<document>/.test(localSearchOutput.output)) {
        hasLocalSearchWithResults = true;
      }
    }

    const validOutputs = toolOutputs.filter((output) => output.output != null);

    if (validOutputs.length > 0) {
      // Don't add "Additional context" header if only localSearch with results to maintain QA format
      const contextHeader =
        hasLocalSearchWithResults && validOutputs.length === 1
          ? ""
          : "\n\n# Additional context:\n\n";
      const rawContext =
        contextHeader +
        validOutputs
          .map((output) => {
            let content = output.output;

            // localSearch results are already formatted by executeToolCalls
            // No need for special processing here

            // Ensure content is string
            if (typeof content !== "string") {
              content = JSON.stringify(content);
            }

            // localSearch is already wrapped in XML tags, don't double-wrap
            if (output.tool === "localSearch") {
              return content;
            }

            // All other tools get wrapped consistently
            return `<${output.tool}>\n${content}\n</${output.tool}>`;
          })
          .join("\n\n");

      context = rawContext.trim();
    }

    if (!context) {
      return userMessage;
    }

    const shouldLabelQuestion = hasLocalSearchWithResults && validOutputs.length === 1;
    return renderCiCMessage(context, userMessage, shouldLabelQuestion);
  }

  protected getTimeExpression(toolCalls: any[]): string {
    const timeRangeCall = toolCalls.find((call) => call.tool.name === "getTimeRangeMs");
    return timeRangeCall ? timeRangeCall.args.timeExpression : "";
  }

  private prepareLocalSearchResult(documents: any[], timeExpression: string): string {
    // First filter documents with includeInContext
    const includedDocs = documents.filter((doc) => doc.includeInContext);

    // Calculate total content length (only content, not metadata)
    const totalContentLength = includedDocs.reduce(
      (sum, doc) => sum + (doc.content?.length || 0),
      0
    );

    // If total content length exceeds threshold, truncate content proportionally
    let processedDocs = includedDocs;
    if (totalContentLength > MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT) {
      const truncationRatio = MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT / totalContentLength;
      logInfo(
        "Truncating document contents to fit context length. Truncation ratio:",
        truncationRatio
      );
      processedDocs = includedDocs.map((doc) => ({
        ...doc,
        // Truncate only content, preserve all metadata
        content:
          doc.content?.slice(0, Math.floor((doc.content?.length || 0) * truncationRatio)) || "",
      }));
    }

    // Sanitize content to remove any pre-existing citation markers to prevent number leakage

    // Assign stable source ids and sanitize content
    const withIds = processedDocs.map((doc, idx) => ({
      ...doc,
      __sourceId: idx + 1,
      content: sanitizeContentForCitations(doc.content || ""),
    }));

    // Format documents with essential metadata including source id
    const formattedContent = formatSearchResultsForLLM(withIds);

    // Build a compact, unnumbered source catalog to avoid bias
    const sourceEntries: SourceCatalogEntry[] = withIds
      .slice(0, Math.min(20, withIds.length))
      .map((d: any) => ({
        title: d.title || d.path || "Untitled",
        path: d.path || d.title || "",
      }));
    const catalogLines = formatSourceCatalog(sourceEntries);

    // Also keep a numbered mapping for fallback use only (if model emits footnotes but forgets Sources)
    this.lastCitationSources = withIds
      .slice(0, Math.min(20, withIds.length))
      .map((d: any, i: number) => {
        const title = d.title || d.path || "Untitled";
        return {
          title,
          path: d.path || undefined,
        };
      });

    const settings = getSettings();
    const guidance = getCitationInstructions(settings.enableInlineCitations, catalogLines);

    const innerContent = buildLocalSearchInnerContent(guidance, formattedContent);

    // Wrap in XML-like tags for better LLM understanding
    return wrapLocalSearchPayload(innerContent, timeExpression);
  }

  /**
   * Processes localSearch tool results for LLM consumption and source extraction
   * @param toolResult - The result from localSearch tool execution
   * @param timeExpression - Optional time expression for contextualizing results
   * @returns Object containing formatted result for LLM and extracted sources for UI
   */
  protected processLocalSearchResult(
    toolResult: { result: string; success: boolean },
    timeExpression?: string
  ): {
    formattedForLLM: string;
    formattedForDisplay: string;
    sources: { title: string; path: string; score: number; explanation?: any }[];
  } {
    let sources: { title: string; path: string; score: number; explanation?: any }[] = [];
    let formattedForLLM: string;
    let formattedForDisplay: string;

    if (!toolResult.success) {
      formattedForLLM = "<localSearch>\nSearch failed.\n</localSearch>";
      formattedForDisplay = `Search failed: ${toolResult.result}`;
      return { formattedForLLM, formattedForDisplay, sources };
    }

    try {
      const parsed = JSON.parse(toolResult.result);
      const searchResults =
        parsed &&
        typeof parsed === "object" &&
        parsed.type === "local_search" &&
        Array.isArray(parsed.documents)
          ? parsed.documents
          : null;
      if (!Array.isArray(searchResults)) {
        formattedForLLM = "<localSearch>\nInvalid search results format.\n</localSearch>";
        formattedForDisplay = "Search results were in an unexpected format.";
        return { formattedForLLM, formattedForDisplay, sources };
      }

      // Log a concise debug table of results with explanations (title, ctime, mtime)
      logSearchResultsDebugTable(searchResults);

      // Extract sources with explanation for UI display
      sources = extractSourcesFromSearchResults(searchResults);

      // Prepare and format results for LLM (include stable ids)
      formattedForLLM = this.prepareLocalSearchResult(searchResults, timeExpression || "");
      formattedForDisplay = ToolResultFormatter.format("localSearch", formattedForLLM);
    } catch (error) {
      logWarn("Failed to parse localSearch results:", error);
      // Fallback: try to format as text
      const formatted = formatSearchResultStringForLLM(toolResult.result);
      formattedForLLM = timeExpression
        ? `<localSearch timeRange="${timeExpression}">\n${formatted}\n</localSearch>`
        : `<localSearch>\n${formatted}\n</localSearch>`;
      formattedForDisplay = ToolResultFormatter.format("localSearch", formattedForLLM);
    }

    return { formattedForLLM, formattedForDisplay, sources };
  }

  protected async getSystemPrompt(): Promise<string> {
    return getSystemPromptWithMemory(this.chainManager.userMemoryManager);
  }
}
