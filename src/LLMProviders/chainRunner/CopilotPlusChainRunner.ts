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
import { getSettings } from "@/settings/model";
import { getSystemPromptWithMemory } from "@/system-prompts/systemPromptBuilder";
import { writeToFileTool } from "@/tools/ComposerTools";
import { ToolManager } from "@/tools/toolManager";
import { ToolResultFormatter } from "@/tools/ToolResultFormatter";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import { localSearchTool, webSearchTool } from "@/tools/SearchTools";
import { updateMemoryTool } from "@/tools/memoryTools";
import { extractChatHistory } from "@/utils";
import { ChatMessage, ResponseMetadata } from "@/types/message";
import { getApiErrorMessage, getMessageRole, withSuppressedTokenWarnings } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseChainRunner } from "./BaseChainRunner";
import { ActionBlockStreamer } from "./utils/ActionBlockStreamer";
import { loadAndAddChatHistory } from "./utils/chatHistoryUtils";
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
  formatSplitSearchResultsForLLM,
  generateQualitySummary,
  formatQualitySummary,
  logSearchResultsDebugTable,
} from "./utils/searchResultUtils";
import {
  buildLocalSearchInnerContent,
  renderCiCMessage,
  wrapLocalSearchPayload,
} from "./utils/cicPromptUtils";
import { extractMarkdownImagePaths } from "./utils/imageExtraction";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import { deduplicateSources } from "./utils/toolExecution";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import { unescapeXml } from "./utils/xmlParsing";
import { StructuredTool } from "@langchain/core/tools";
import { AIMessage } from "@langchain/core/messages";
import ProjectManager from "@/LLMProviders/projectManager";
import { isProjectMode } from "@/aiParams";

type ToolCallWithExecutor = {
  tool: any;
  args: any;
};

export class CopilotPlusChainRunner extends BaseChainRunner {
  /**
   * Get available tools for Copilot Plus chain.
   * Uses a minimal set of utility tools: time tools and file tree.
   * Search tools are handled via @commands.
   */
  protected getAvailableToolsForPlanning(): StructuredTool[] {
    const registry = ToolRegistry.getInstance();

    // Initialize tools if not already done
    if (registry.getAllTools().length === 0) {
      initializeBuiltinTools(this.chainManager.app?.vault);
    }

    // Get all tools as StructuredTool instances
    const allTools = registry.getAllTools().map((def) => def.tool);

    // Return only utility tools that need automatic detection
    // Other tools (@vault, @websearch, @memory) are handled by @command logic
    return allTools.filter((tool) => {
      return (
        tool.name === "getCurrentTime" ||
        tool.name === "convertTimeBetweenTimezones" ||
        tool.name === "getTimeInfoByEpoch" ||
        tool.name === "getTimeRangeMs" ||
        tool.name === "getFileTree"
      );
    });
  }

  /**
   * Use model-based planning with native tool calling to determine which tools to call.
   * Uses bindTools() for native function calling instead of XML format.
   */
  private async planToolCalls(
    userMessage: string,
    chatModel: BaseChatModel
  ): Promise<{ toolCalls: ToolCallWithExecutor[]; salientTerms: string[]; returnAll: boolean }> {
    const availableTools = this.getAvailableToolsForPlanning();

    // Check if model supports native tool calling
    if (typeof (chatModel as any).bindTools !== "function") {
      logWarn("[CopilotPlus] Model does not support native tool calling, skipping tool planning");
      return {
        toolCalls: [],
        salientTerms: this.extractSalientTermsFromQuery(userMessage),
        returnAll: false,
      };
    }

    // Bind tools to the model for native function calling
    const boundModel = (chatModel as any).bindTools(availableTools);

    // Build a lightweight planning prompt (no XML format instructions needed)
    const planningPrompt = `You are a helpful AI assistant. Analyze the user's message and determine if any tools should be called.

Guidelines:
- Use tools when the user's request requires external information or computation
- For time-related queries, use getTimeRangeMs to convert time expressions to timestamps
- For file structure queries, use getFileTree to explore the vault
- If no tools are needed, respond with your analysis

After analyzing, extract key search terms from the user's message that would be useful for searching notes:
- Extract meaningful nouns, topics, and specific concepts
- Preserve the EXACT words and language from the user's message (works for any language)
- Exclude time expressions (those are handled by tools)

Include your extracted terms as: [SALIENT_TERMS: term1, term2, term3]

If the user wants ALL matching notes (e.g., "find all my X", "list every Y", "show me all Z", "how many notes about W"), output: [RETURN_ALL: true]
Otherwise omit RETURN_ALL or output: [RETURN_ALL: false]`;

    // Create planning request
    const planningMessages = [
      {
        role: getMessageRole(chatModel),
        content: planningPrompt,
      },
      {
        role: "user",
        content: userMessage,
      },
    ];

    logInfo("[CopilotPlus] Requesting tool planning with native tool calling...");

    // Get model response for planning (cast to AIMessage for type safety)
    const response = (await withSuppressedTokenWarnings(() =>
      boundModel.invoke(planningMessages)
    )) as AIMessage;

    // Extract tool calls from native response
    const nativeToolCalls = response.tool_calls || [];
    const responseText =
      typeof response.content === "string" ? response.content : String(response.content);

    logInfo("[CopilotPlus] Native tool calls:", nativeToolCalls.length);

    // Extract salient terms and returnAll intent from response text
    const { salientTerms, returnAll } = this.extractPlanningFieldsFromResponse(
      responseText,
      userMessage
    );

    // Convert native tool calls to executor format
    const toolCalls: ToolCallWithExecutor[] = [];
    for (const tc of nativeToolCalls) {
      const tool = availableTools.find((t) => t.name === tc.name);
      if (tool) {
        toolCalls.push({
          tool,
          args: tc.args as Record<string, unknown>,
        });
        logInfo(`[CopilotPlus] Tool call: ${tc.name}`, tc.args);
      } else {
        logWarn(`[CopilotPlus] Tool '${tc.name}' not found in available tools`);
      }
    }

    return { toolCalls, salientTerms, returnAll };
  }

  /**
   * Extract salient terms and returnAll intent from model response.
   */
  private extractPlanningFieldsFromResponse(
    responseText: string,
    originalQuery: string
  ): { salientTerms: string[]; returnAll: boolean } {
    // Extract salient terms from [SALIENT_TERMS: ...] format
    let salientTerms: string[];
    const termsMatch = responseText.match(/\[SALIENT_TERMS:\s*([^\]]+?)\s*\]/i);
    if (termsMatch) {
      const terms = termsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      salientTerms = terms.length > 0 ? terms : this.extractSalientTermsFromQuery(originalQuery);
    } else {
      salientTerms = this.extractSalientTermsFromQuery(originalQuery);
    }

    // Extract returnAll from [RETURN_ALL: true/false] format
    // Allow optional whitespace/newlines around the value and before closing bracket
    const returnAllMatch = responseText.match(/\[RETURN_ALL:\s*(true|false)\s*\]/i);
    const returnAll = returnAllMatch ? returnAllMatch[1].toLowerCase() === "true" : false;

    return { salientTerms, returnAll };
  }

  /**
   * Extract salient terms directly from query (fallback method).
   * Uses language-agnostic heuristics: keeps words with 3+ characters.
   */
  private extractSalientTermsFromQuery(query: string): string[] {
    // Language-agnostic extraction: split on whitespace and punctuation,
    // keep words with sufficient length (filters out short function words in most languages)
    return query
      .split(/[\s\p{P}]+/u) // Split on whitespace and punctuation (Unicode-aware)
      .filter((word) => word.length >= 3) // Keep words with 3+ characters
      .slice(0, 10); // Limit to 10 terms
  }

  /**
   * Process @commands in the user message and add corresponding tool calls.
   * Handles @vault, @websearch/@web, and @memory commands.
   */
  private async processAtCommands(
    userMessage: string,
    existingToolCalls: ToolCallWithExecutor[],
    context: { salientTerms: string[]; timeRange?: any; returnAll?: boolean }
  ): Promise<ToolCallWithExecutor[]> {
    const message = userMessage.toLowerCase();
    const cleanQuery = this.removeAtCommands(userMessage);
    const toolCalls = [...existingToolCalls];

    // Handle @vault command
    if (message.includes("@vault")) {
      // Check if localSearch is already planned
      const hasLocalSearch = toolCalls.some((tc) => tc.tool.name === "localSearch");
      if (!hasLocalSearch) {
        toolCalls.push({
          tool: localSearchTool,
          args: {
            query: cleanQuery,
            salientTerms: context.salientTerms,
            timeRange: context.timeRange,
            returnAll: context.returnAll === true ? true : undefined,
          },
        });
      }
    }

    // Handle @websearch command and also support @web for backward compatibility
    if (message.includes("@websearch") || message.includes("@web")) {
      const hasWebSearch = toolCalls.some((tc) => tc.tool.name === "webSearch");
      if (!hasWebSearch) {
        const memory = ProjectManager.instance.getCurrentChainManager().memoryManager.getMemory();
        const memoryVariables = await memory.loadMemoryVariables({});
        const chatHistory = extractChatHistory(memoryVariables);

        toolCalls.push({
          tool: webSearchTool,
          args: {
            query: cleanQuery,
            chatHistory,
          },
        });
      }
    }

    // Handle @memory command
    if (message.includes("@memory")) {
      const hasUpdateMemory = toolCalls.some((tc) => tc.tool.name === "updateMemory");
      if (!hasUpdateMemory) {
        toolCalls.push({
          tool: updateMemoryTool,
          args: {
            statement: cleanQuery,
          },
        });
      }
    }

    return toolCalls;
  }

  /**
   * Remove @command tokens from the user message.
   */
  private removeAtCommands(message: string): string {
    return message
      .split(" ")
      .filter((word) => !AVAILABLE_TOOLS.includes(word.toLowerCase()))
      .join(" ")
      .trim();
  }

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

  /**
   * Extracts images from a context block (active_note or active_web_tab) in L3 content.
   * @param l3Text - The full L3_TURN layer text
   * @param source - Configuration for the context source type
   * @returns Array of image URLs/paths found in the block
   */
  private async extractImagesFromContextBlock(
    l3Text: string,
    source: {
      tagName: string;
      identifierTag: string;
      displayName: string;
      useForResolution: boolean;
    }
  ): Promise<string[]> {
    // Match the context block
    const blockRegex = new RegExp(`<${source.tagName}>([\\s\\S]*?)<\\/${source.tagName}>`);
    const blockMatch = blockRegex.exec(l3Text);
    if (!blockMatch) return [];

    const block = blockMatch[1];

    // Extract content - unescape XML entities for correct URL parsing
    const contentRegex = /<content>([\s\S]*?)<\/content>/;
    const contentMatch = contentRegex.exec(block);
    const content = contentMatch ? unescapeXml(contentMatch[1]) : "";
    if (!content) return [];

    // Extract identifier (path or url) for logging and optional resolution
    const identifierRegex = new RegExp(
      `<${source.identifierTag}>(.*?)<\\/${source.identifierTag}>`
    );
    const identifierMatch = identifierRegex.exec(block);
    const identifier = identifierMatch ? identifierMatch[1] : undefined;

    logInfo(
      `[CopilotPlus] Extracting images from ${source.displayName}:`,
      identifier || `no ${source.identifierTag}`
    );

    // Use identifier for vault path resolution only if configured
    const sourcePath = source.useForResolution ? identifier : undefined;
    return this.extractEmbeddedImages(content, sourcePath);
  }

  private async extractEmbeddedImages(content: string, sourcePath?: string): Promise<string[]> {
    // Match wiki-style ![[image.ext]]
    const wikiImageRegex = /!\[\[(.*?\.(png|jpg|jpeg|gif|webp|bmp|svg))\]\]/g;

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

    // Process standard markdown images using robust character-scanning parser
    const mdImagePaths = extractMarkdownImagePaths(content);
    for (const imagePath of mdImagePaths) {
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
      // IMPORTANT: Only extract images from the active context (note or web tab)
      // Never from L2 (promoted notes) or attached context notes
      const envelope = userMessage.contextEnvelope;

      if (!envelope) {
        throw new Error(
          "[CopilotPlus] Context envelope is required but not available. Cannot extract images."
        );
      }

      // Extract from active context blocks in L3 (active_note or active_web_tab)
      const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
      if (l3Turn) {
        // Define context sources to extract images from
        // - tagName: XML tag name in L3 content
        // - identifierTag: tag containing source identifier (path/url) for logging
        // - displayName: human-readable name for logs
        // - useForResolution: whether to use identifier for vault path resolution
        const contextSources = [
          {
            tagName: "active_note",
            identifierTag: "path",
            displayName: "active note",
            useForResolution: true,
          },
          {
            tagName: "active_web_tab",
            identifierTag: "url",
            displayName: "active web tab",
            useForResolution: false,
          },
        ];

        for (const source of contextSources) {
          const images = await this.extractImagesFromContextBlock(l3Turn.text, source);
          if (images.length > 0) {
            imageSources.push({ urls: images, type: "embedded" });
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

  protected hasCapability(model: BaseChatModel, capability: ModelCapability): boolean {
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
    originalUserQuestion: string,
    updateLoadingMessage?: (message: string) => void
  ): Promise<void> {
    // Get memory for chat history loading
    const memory = this.chainManager.memoryManager.getMemory();

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
    await loadAndAddChatHistory(memory, messages);

    // Process user message (L3 smart references + L5)
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
          originalUserQuestion.trim() || userMessage.originalMessage?.trim() || "";
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

    // Check if the current model has reasoning capability
    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const hasReasoning = this.hasCapability(chatModel, ModelCapability.REASONING);
    const excludeThinking = !hasReasoning;

    const thinkStreamer = new ThinkBlockStreamer(updateCurrentAiMessage, excludeThinking);
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
      logInfo("==== Step 1: Planning tools ====");
      let toolCalls: ToolCallWithExecutor[];

      // Extract L5 (raw user query) from envelope for tool planning
      const envelope = userMessage.contextEnvelope;
      if (!envelope) {
        throw new Error(
          "[CopilotPlus] Context envelope is required but not available. Cannot proceed with CopilotPlus chain."
        );
      }
      const l5User = envelope.layers.find((l) => l.id === "L5_USER");
      const messageForAnalysis = l5User?.text || userMessage.originalMessage || "";

      try {
        // Use model-based planning instead of Broca
        const chatModel = this.chainManager.chatModelManager.getChatModel();
        const planningResult = await this.planToolCalls(messageForAnalysis, chatModel);

        // Execute getTimeRangeMs immediately if present (needed for localSearch timeRange)
        // We execute it once here and remove it from toolCalls to avoid double execution
        let timeRange: any = undefined;
        const timeRangeCall = planningResult.toolCalls.find(
          (tc) => tc.tool.name === "getTimeRangeMs"
        );
        if (timeRangeCall) {
          const timeRangeResult = await ToolManager.callTool(
            timeRangeCall.tool,
            timeRangeCall.args
          );
          // Parse result if it's a JSON string (LangChain tools return strings)
          // Extract epoch values from TimeInfo objects - localSearch expects {startTime: number, endTime: number}
          const extractEpochValues = (result: any) => {
            if (result?.startTime?.epoch !== undefined && result?.endTime?.epoch !== undefined) {
              return {
                startTime: result.startTime.epoch,
                endTime: result.endTime.epoch,
              };
            }
            return result;
          };

          if (typeof timeRangeResult === "string") {
            try {
              const parsed = JSON.parse(timeRangeResult);
              // Only use result if it's not an error
              if (!parsed.error) {
                timeRange = extractEpochValues(parsed);
              }
            } catch {
              logWarn("[CopilotPlus] Failed to parse getTimeRangeMs result:", timeRangeResult);
            }
          } else if (timeRangeResult && !timeRangeResult.error) {
            timeRange = extractEpochValues(timeRangeResult);
          }
          logInfo("[CopilotPlus] Executed getTimeRangeMs, result:", timeRange);
        }

        // Filter tool calls: skip getFileTree in project mode, skip getTimeRangeMs if already executed
        const filteredToolCalls = planningResult.toolCalls.filter((tc) => {
          if (tc.tool.name === "getFileTree" && isProjectMode()) {
            logInfo("Skipping getFileTree in project mode");
            return false;
          }
          if (tc.tool.name === "getTimeRangeMs" && timeRange) {
            logInfo("Skipping getTimeRangeMs - already executed during planning");
            return false;
          }
          return true;
        });

        // Process @commands - this may add localSearch, webSearch, or updateMemory
        // Pass timeRange and returnAll in context so @vault commands can use them
        toolCalls = await this.processAtCommands(messageForAnalysis, filteredToolCalls, {
          salientTerms: planningResult.salientTerms,
          timeRange,
          returnAll: planningResult.returnAll,
        });
      } catch (error: any) {
        return this.handleResponse(
          getApiErrorMessage(error),
          userMessage,
          abortController,
          addMessage,
          updateCurrentAiMessage
        );
      }

      // Clean user message by removing @command tokens
      // Use L5 text (expanded user query without context XML) or displayText as fallback.
      // userMessage.message is processedText which includes context artifact XML — using it
      // here would re-inject L3 context into the user message, bypassing envelope separation.
      const l5Text = userMessage.contextEnvelope?.layers.find((l) => l.id === "L5_USER")?.text;
      const cleanedUserMessage = this.removeAtCommands(
        l5Text || userMessage.originalMessage || userMessage.message
      );

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
        cleanedUserMessage,
        updateLoadingMessage
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
    // Filter documents that should be included in context
    // Use !== false to be consistent with formatSearchResultsForLLM and logSearchResultsDebugTable
    const includedDocs = documents.filter((doc) => doc.includeInContext !== false);

    // Generate quality summary across all docs combined
    const qualitySummary = generateQualitySummary(includedDocs);
    const qualityHeader = formatQualitySummary(qualitySummary);

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
        content:
          doc.content?.slice(0, Math.floor((doc.content?.length || 0) * truncationRatio)) || "",
      }));
    }

    // Assign stable source ids (continuous across both groups) and sanitize content
    const withIds = processedDocs.map((doc, idx) => ({
      ...doc,
      __sourceId: idx + 1,
      content: sanitizeContentForCitations(doc.content || ""),
    }));

    // Split into filter and search docs by isFilterResult flag
    const filterDocs = withIds.filter((d: any) => d.isFilterResult === true);
    const searchDocs = withIds.filter((d: any) => d.isFilterResult !== true);

    // Use split formatter if there are filter results, otherwise fall back to unified format
    const hasFilterResults = filterDocs.length > 0;
    const formattedContent = hasFilterResults
      ? formatSplitSearchResultsForLLM(filterDocs, searchDocs)
      : formatSearchResultsForLLM(withIds);

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
    const settings = getSettings();
    const guidance = getLocalSearchGuidance(catalogLines, settings.enableInlineCitations).trim();

    // Add RAG instruction (like VaultQA) to ensure model uses the context
    const ragInstruction = "Answer the question based only on the following context:";
    const documentsSection = buildLocalSearchInnerContent(ragInstruction, formattedContent);

    // Include quality header and guidance directly in the payload, making it self-contained
    const fullInnerContent = guidance
      ? `${qualityHeader}\n\n${documentsSection}\n\n${guidance}`
      : `${qualityHeader}\n\n${documentsSection}`;

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
