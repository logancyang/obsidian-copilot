import { AVAILABLE_TOOLS } from "@/components/chat-components/constants/tools";
import {
  ABORT_REASON,
  COMPOSER_OUTPUT_INSTRUCTIONS,
  LOADING_MESSAGES,
  MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT,
  ModelCapability,
} from "@/constants";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
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
import { ChatMessage, ResponseMetadata } from "@/types/message";
import { getApiErrorMessage, getMessageRole, withSuppressedTokenWarnings } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { IntentAnalyzer } from "../intentAnalyzer";
import { BaseChainRunner } from "./BaseChainRunner";
import { ActionBlockStreamer } from "./utils/ActionBlockStreamer";
import { addChatHistoryToMessages } from "./utils/chatHistoryUtils";
import {
  addFallbackSources,
  formatSourceCatalog,
  getLocalSearchGuidance,
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
import { recordPromptPayload } from "./utils/promptPayloadRecorder";

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
      // IMPORTANT: Only extract images from the active note
      // Never from L2 (promoted notes) or attached context notes
      const envelope = userMessage.contextEnvelope;

      if (!envelope) {
        throw new Error(
          "[CopilotPlus] Context envelope is required but not available. Cannot extract images."
        );
      }

      // Extract ONLY from <active_note> block in L3
      const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
      if (l3Turn) {
        // Find <active_note> block
        const activeNoteRegex = /<active_note>([\s\S]*?)<\/active_note>/;
        const activeNoteMatch = activeNoteRegex.exec(l3Turn.text);

        if (activeNoteMatch) {
          const activeNoteBlock = activeNoteMatch[1];

          // Extract path from <path> tag
          const pathRegex = /<path>(.*?)<\/path>/;
          const pathMatch = pathRegex.exec(activeNoteBlock);
          const sourcePath = pathMatch ? pathMatch[1] : undefined;

          // Extract content from <content> tag
          const contentRegex = /<content>([\s\S]*?)<\/content>/;
          const contentMatch = contentRegex.exec(activeNoteBlock);
          const activeNoteContent = contentMatch ? contentMatch[1] : "";

          if (activeNoteContent) {
            logInfo(
              "[CopilotPlus] Extracting images from active note only:",
              sourcePath || "no source path"
            );
            const embeddedImages = await this.extractEmbeddedImages(activeNoteContent, sourcePath);
            if (embeddedImages.length > 0) {
              imageSources.push({ urls: embeddedImages, type: "embedded" });
            }
          }
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
    allToolOutputs: any[],
    abortController: AbortController,
    thinkStreamer: ThinkBlockStreamer,
    originalUserQuestion: string
  ): Promise<void> {
    // Get chat history
    const memory = this.chainManager.memoryManager.getMemory();
    const memoryVariables = await memory.loadMemoryVariables({});
    const rawHistory = memoryVariables.history || [];

    // Get chat model
    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const isMultimodalCurrent = this.isMultimodalModel(chatModel);

    // Create messages array
    const messages: any[] = [];

    // Envelope-based context construction (required)
    const envelope = userMessage.contextEnvelope;
    if (!envelope) {
      throw new Error(
        "[CopilotPlus] Context envelope is required but not available. Cannot proceed with CopilotPlus chain."
      );
    }

    logInfo("[CopilotPlus] Using envelope-based context construction");

    // Use LayerToMessagesConverter to get base messages with L1+L2 system, L3+L5 user
    const baseMessages = LayerToMessagesConverter.convert(envelope, {
      includeSystemMessage: true,
      mergeUserContent: true,
      debug: false,
    });

    // Add system message (L1 + L2 Context Library only - no tool results)
    const systemMessage = baseMessages.find((m) => m.role === "system");
    if (systemMessage) {
      messages.push({
        role: getMessageRole(chatModel),
        content: systemMessage.content,
      });
    }

    // Insert L4 (chat history) between system and user
    addChatHistoryToMessages(rawHistory, messages);

    // Find user message (L3 smart references + L5)
    const userMessageContent = baseMessages.find((m) => m.role === "user");
    if (userMessageContent) {
      let finalUserContent;

      // All tools (including localSearch) are formatted uniformly and added to user message
      const hasTools = allToolOutputs.length > 0;

      const ensureUserQueryLabel = (content: string): string => {
        const userQueryLabel = "[User query]:";
        if (content.includes(userQueryLabel)) {
          return content;
        }

        const trimmedContent = content.trimEnd();
        const sections: string[] = [];
        if (trimmedContent.length > 0) {
          sections.push(trimmedContent);
        }

        const trimmedQuestion =
          originalUserQuestion.trim() ||
          userMessage.message?.trim() ||
          userMessage.originalMessage?.trim() ||
          "";
        if (trimmedQuestion.length > 0) {
          sections.push(`${userQueryLabel}\n${trimmedQuestion}`);
        } else {
          sections.push(userQueryLabel);
        }

        return sections.join("\n\n");
      };

      if (hasTools) {
        // Format all tool outputs and prepend to user content using CiC format
        const toolContext = this.formatAllToolOutputs(allToolOutputs);

        const userContentWithLabel = ensureUserQueryLabel(userMessageContent.content);
        finalUserContent = renderCiCMessage(toolContext, userContentWithLabel);
      } else {
        // No tools - use converter's output as-is
        // Smart references are already properly formatted by LayerToMessagesConverter
        finalUserContent = ensureUserQueryLabel(userMessageContent.content);
      }

      // Add composer instructions if textContent has them
      // (textContent already has composer instructions appended via appendComposerInstructionsIfNeeded)
      if (
        textContent.includes("<OUTPUT_FORMAT>") &&
        !finalUserContent.includes("<OUTPUT_FORMAT>")
      ) {
        const composerMatch = textContent.match(/<OUTPUT_FORMAT>[\s\S]*?<\/OUTPUT_FORMAT>/);
        if (composerMatch) {
          finalUserContent += "\n\n" + composerMatch[0];
        }
      }

      // Build message content with text and images for multimodal models
      const content: string | MessageContent[] = isMultimodalCurrent
        ? await this.buildMessageContent(finalUserContent, userMessage)
        : finalUserContent;

      messages.push({
        role: "user",
        content,
      });
    }

    logInfo("Final request to AI", { messages: messages.length });

    // Record the payload for debugging (includes layered view if envelope available)
    const modelName = (chatModel as { modelName?: string } | undefined)?.modelName;
    recordPromptPayload({
      messages,
      modelName,
      contextEnvelope: userMessage.contextEnvelope,
    });

    const actionStreamer = new ActionBlockStreamer(ToolManager, writeToFileTool);

    // Wrap the stream call with warning suppression
    const chatStream = await withSuppressedTokenWarnings(() =>
      this.chainManager.chatModelManager.getChatModel().stream(messages, {
        signal: abortController.signal,
      })
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
    const thinkStreamer = new ThinkBlockStreamer(updateCurrentAiMessage);
    let sources: { title: string; path: string; score: number; explanation?: any }[] = [];

    const isPlusUser = await checkIsPlusUser({
      isCopilotPlus: true,
    });
    if (!isPlusUser) {
      await this.handleError(
        new Error("Invalid license key"),
        thinkStreamer.processErrorChunk.bind(thinkStreamer)
      );
      const errorResponse = thinkStreamer.close().content;

      return this.handleResponse(
        errorResponse,
        userMessage,
        abortController,
        addMessage,
        updateCurrentAiMessage,
        undefined // no sources
      );
    }

    try {
      logInfo("==== Step 1: Analyzing intent ====");
      let toolCalls;

      // Extract L5 (raw user query) from envelope for intent analysis
      const envelope = userMessage.contextEnvelope;
      if (!envelope) {
        throw new Error(
          "[CopilotPlus] Context envelope is required but not available. Cannot proceed with CopilotPlus chain."
        );
      }
      const l5User = envelope.layers.find((l) => l.id === "L5_USER");
      const messageForAnalysis = l5User?.text || userMessage.originalMessage || userMessage.message;

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

      // All tools (including localSearch) are treated uniformly
      // They all go to the user message with consistent formatting
      const allToolOutputs = toolOutputs.filter((output) => output.output != null);

      // Prepare textContent with composer instructions if needed
      // This is checked in streamMultimodalResponse to append to final user content
      const textContentWithComposer = this.appendComposerInstructionsIfNeeded(
        cleanedUserMessage,
        userMessage
      );

      logInfo("Invoking LLM with envelope-based context construction");
      await this.streamMultimodalResponse(
        textContentWithComposer,
        userMessage,
        allToolOutputs,
        abortController,
        thinkStreamer,
        cleanedUserMessage
      );
    } catch (error: any) {
      // Reset loading message to default
      updateLoadingMessage?.(LOADING_MESSAGES.DEFAULT);

      // Check if the error is due to abort signal
      if (error.name === "AbortError" || abortController.signal.aborted) {
        logInfo("CopilotPlus stream aborted by user", { reason: abortController.signal.reason });
        // Don't show error message for user-initiated aborts
      } else {
        await this.handleError(error, thinkStreamer.processErrorChunk.bind(thinkStreamer));
      }
    }

    // Only skip saving if it's a new chat (clearing everything)
    if (abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      updateCurrentAiMessage("");
      return "";
    }

    // Get the response from thinkStreamer
    const streamResult = thinkStreamer.close();
    let fullAIResponse = streamResult.content;

    // Store truncation metadata for handleResponse
    const responseMetadata: ResponseMetadata | undefined = {
      wasTruncated: streamResult.wasTruncated,
      tokenUsage: streamResult.tokenUsage ?? undefined,
    };

    // Add fallback sources if citations are missing
    const fallbackSources =
      this.lastCitationSources && this.lastCitationSources.length > 0
        ? this.lastCitationSources
        : ((sources as any[]) || []).map((source) => ({ title: source.title, path: source.path }));

    fullAIResponse = addFallbackSources(fullAIResponse, fallbackSources);

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

  private async executeToolCalls(
    toolCalls: any[],
    updateLoadingMessage?: (message: string) => void
  ): Promise<{
    toolOutputs: { tool: string; output: any }[];
    sources: { title: string; path: string; score: number; explanation?: any }[];
  }> {
    const toolOutputs = [];
    const allSources: { title: string; path: string; score: number; explanation?: any }[] = [];

    // TODO: remove this hack until better solution in place (logan, wenzheng)
    // Skip getFileTree if localSearch is already being called to avoid redundant work
    const hasLocalSearch = toolCalls.some((tc) => tc.tool.name === "localSearch");

    for (const toolCall of toolCalls) {
      // TODO: remove this hack until better solution in place (logan, wenzheng)
      // Skip getFileTree when localSearch is present
      if (toolCall.tool.name === "getFileTree" && hasLocalSearch) {
        logInfo("Skipping getFileTree since localSearch is already active");
        continue;
      }

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
    this.lastCitationSources = withIds.slice(0, Math.min(20, withIds.length)).map((d: any) => {
      const title = d.title || d.path || "Untitled";
      return {
        title,
        path: d.path || undefined,
      };
    });

    // Build guidance block with citation rules and source catalog
    const guidance = getLocalSearchGuidance(catalogLines).trim();

    // Add RAG instruction (like VaultQA) to ensure model uses the context
    const ragInstruction = "Answer the question based only on the following context:";
    const documentsSection = buildLocalSearchInnerContent(ragInstruction, formattedContent);

    // Include guidance directly in the payload, making it self-contained
    const fullInnerContent = guidance ? `${documentsSection}\n\n${guidance}` : documentsSection;

    // Wrap in XML-like tags for better LLM understanding
    return wrapLocalSearchPayload(fullInnerContent, timeExpression);
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

  /**
   * Formats all tool outputs uniformly for user message.
   * All tools (localSearch, webSearch, getFileTree, etc.) are treated the same.
   */
  private formatAllToolOutputs(toolOutputs: any[]): string {
    if (toolOutputs.length === 0) return "";

    const formattedOutputs = toolOutputs
      .map((output) => {
        let content = output.output;
        if (typeof content !== "string") {
          content = JSON.stringify(content);
        }
        return `<${output.tool}>\n${content}\n</${output.tool}>`;
      })
      .join("\n\n");

    return "# Additional context:\n\n" + formattedOutputs;
  }
}
