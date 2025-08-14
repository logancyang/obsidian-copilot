import { getStandaloneQuestion } from "@/chainUtils";
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
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings, getSystemPrompt } from "@/settings/model";
import { ToolManager } from "@/tools/toolManager";
import { writeToFileTool } from "@/tools/ComposerTools";
import { ChatMessage } from "@/types/message";
import {
  extractYoutubeUrl,
  getApiErrorMessage,
  getMessageRole,
  withSuppressedTokenWarnings,
} from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { COPILOT_TOOL_NAMES, IntentAnalyzer } from "../intentAnalyzer";
import { BaseChainRunner } from "./BaseChainRunner";
import { ActionBlockStreamer } from "./utils/ActionBlockStreamer";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import {
  addChatHistoryToMessages,
  processRawChatHistory,
  processedMessagesToTextOnly,
} from "./utils/chatHistoryUtils";
import { checkIsPlusUser } from "@/plusUtils";

export class CopilotPlusChainRunner extends BaseChainRunner {
  private isYoutubeOnlyMessage(message: string): boolean {
    const trimmedMessage = message.trim();
    const hasYoutubeCommand = trimmedMessage.includes("@youtube");
    const youtubeUrl = extractYoutubeUrl(trimmedMessage);

    // Check if message only contains @youtube command and a valid URL
    const words = trimmedMessage
      .split(/\s+/)
      .filter((word) => word !== "@youtube" && word.length > 0);

    return hasYoutubeCommand && youtubeUrl !== null && words.length === 1;
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

    // Safely check and add context URLs
    const contextUrls = userMessage.context?.urls;
    if (contextUrls && contextUrls.length > 0) {
      imageSources.push({ urls: contextUrls, type: "context" });
    }

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

      const embeddedImages = await this.extractEmbeddedImages(textContent, sourcePath);
      if (embeddedImages.length > 0) {
        imageSources.push({ urls: embeddedImages, type: "embedded" });
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
    thinkStreamer: ThinkBlockStreamer
  ): Promise<void> {
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
    logInfo("==== Final Request to AI ====\n", messages);
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
    let sources: { title: string; path: string; score: number }[] = [];

    const isPlusUser = await checkIsPlusUser({
      isCopilotPlus: true,
    });
    if (!isPlusUser) {
      await this.handleError(
        new Error("Invalid license key"),
        thinkStreamer.processErrorChunk.bind(thinkStreamer)
      );
      return "";
    }

    try {
      // Check if this is a YouTube-only message
      if (this.isYoutubeOnlyMessage(userMessage.message)) {
        const url = extractYoutubeUrl(userMessage.message);
        const failMessage =
          "Transcript not available. Only videos with the auto transcript option turned on are supported at the moment.";
        if (url) {
          try {
            const response = await BrevilabsClient.getInstance().youtube4llm(url);
            if (response.response.transcript) {
              return this.handleResponse(
                response.response.transcript,
                userMessage,
                abortController,
                addMessage,
                updateCurrentAiMessage
              );
            }
            return this.handleResponse(
              failMessage,
              userMessage,
              abortController,
              addMessage,
              updateCurrentAiMessage
            );
          } catch (error) {
            logError("Error processing YouTube video:", error);
            return this.handleResponse(
              failMessage,
              userMessage,
              abortController,
              addMessage,
              updateCurrentAiMessage
            );
          }
        }
      }

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
        .filter((word) => !COPILOT_TOOL_NAMES.includes(word.toLowerCase()))
        .join(" ")
        .trim();

      const toolOutputs = await this.executeToolCalls(toolCalls, updateLoadingMessage);

      // Extract sources from localSearch if present
      const localSearchResult = toolOutputs.find(
        (output) => output.tool === "localSearch" && output.output != null
      );

      let hasLocalSearchWithResults = false;
      if (localSearchResult) {
        try {
          const documents = JSON.parse(localSearchResult.output);
          if (Array.isArray(documents) && documents.length > 0) {
            hasLocalSearchWithResults = true;
            sources = this.getSources(documents);
          }
        } catch (error) {
          logWarn("Failed to parse localSearch results for sources:", error);
        }
      }

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
        logInfo("==== Condensing Question ====");
        questionForEnhancement = await getStandaloneQuestion(cleanedUserMessage, chatHistory);
        logInfo("Condensed standalone question: ", questionForEnhancement);
      }

      // Enhance with ALL tool outputs including localSearch
      let enhancedUserMessage = this.prepareEnhancedUserMessage(
        questionForEnhancement,
        toolOutputs,
        toolCalls
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

      logInfo("==== Invoking LLM with all tool results ====");
      await this.streamMultimodalResponse(
        enhancedUserMessage,
        userMessage,
        abortController,
        thinkStreamer
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

    return this.handleResponse(
      thinkStreamer.close(),
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      sources
    );
  }

  private getSources(documents: any): { title: string; path: string; score: number }[] {
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
        });
      }
    }

    // Convert the map values back to an array and sort by score in descending order
    return Array.from(uniqueDocs.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  private async executeToolCalls(
    toolCalls: any[],
    updateLoadingMessage?: (message: string) => void
  ) {
    const toolOutputs = [];
    for (const toolCall of toolCalls) {
      logInfo(`==== Step 2: Calling tool: ${toolCall.tool.name} ====`);
      if (toolCall.tool.name === "localSearch") {
        updateLoadingMessage?.(LOADING_MESSAGES.READING_FILES);
      } else if (toolCall.tool.name === "webSearch") {
        updateLoadingMessage?.(LOADING_MESSAGES.SEARCHING_WEB);
      } else if (toolCall.tool.name === "getFileTree") {
        updateLoadingMessage?.(LOADING_MESSAGES.READING_FILE_TREE);
      }
      const output = await ToolManager.callTool(toolCall.tool, toolCall.args);
      toolOutputs.push({ tool: toolCall.tool.name, output });
    }
    return toolOutputs;
  }

  private prepareEnhancedUserMessage(userMessage: string, toolOutputs: any[], toolCalls?: any[]) {
    let context = "";
    let hasLocalSearchWithResults = false;

    // Check if localSearch has actual results (non-empty documents array)
    const localSearchOutput = toolOutputs.find(
      (output) => output.tool === "localSearch" && output.output != null
    );

    if (localSearchOutput && typeof localSearchOutput.output === "string") {
      try {
        const documents = JSON.parse(localSearchOutput.output);
        if (Array.isArray(documents) && documents.length > 0) {
          hasLocalSearchWithResults = true;
        }
      } catch {
        // Invalid JSON or parsing error
      }
    }

    if (toolOutputs.length > 0) {
      const validOutputs = toolOutputs.filter((output) => output.output != null);
      if (validOutputs.length > 0) {
        // Don't add "Additional context" header if only localSearch with results to maintain QA format
        const contextHeader =
          hasLocalSearchWithResults && validOutputs.length === 1
            ? ""
            : "\n\n# Additional context:\n\n";
        context =
          contextHeader +
          validOutputs
            .map((output) => {
              let content = output.output;

              // Special formatting for localSearch results
              if (output.tool === "localSearch" && typeof content === "string") {
                try {
                  const documents = JSON.parse(content);
                  if (Array.isArray(documents) && documents.length > 0) {
                    // Get time expression from toolCalls if available
                    const timeExpression = toolCalls ? this.getTimeExpression(toolCalls) : "";
                    const formattedContent = this.prepareLocalSearchResult(
                      documents,
                      timeExpression
                    );
                    content = formattedContent;
                  }
                } catch (error) {
                  // If parsing fails, use the raw output
                  logWarn("Failed to parse localSearch output for formatting:", error);
                }
              }

              // Ensure content is string
              if (typeof content !== "string") {
                content = JSON.stringify(content);
              }

              // Only wrap in XML tags if there are multiple tools
              if (validOutputs.length > 1) {
                return `<${output.tool}>\n${content}\n</${output.tool}>`;
              } else if (output.tool === "localSearch" && hasLocalSearchWithResults) {
                // For localSearch with results only, don't wrap in XML to maintain QA format
                return content;
              } else {
                return `<${output.tool}>\n${content}\n</${output.tool}>`;
              }
            })
            .join("\n\n");
      }
    }

    // For QA format when only localSearch with results is present
    if (hasLocalSearchWithResults && toolOutputs.filter((o) => o.output != null).length === 1) {
      return `${context}\n\nQuestion: ${userMessage}`;
    }

    return `${userMessage}${context}`;
  }

  private getTimeExpression(toolCalls: any[]): string {
    const timeRangeCall = toolCalls.find((call) => call.tool.name === "getTimeRangeMs");
    return timeRangeCall ? timeRangeCall.args.timeExpression : "";
  }

  private prepareLocalSearchResult(documents: any[], timeExpression: string): string {
    // First filter documents with includeInContext
    const includedDocs = documents.filter((doc) => doc.includeInContext);

    // Calculate total content length
    const totalLength = includedDocs.reduce((sum, doc) => sum + doc.content.length, 0);

    // If total length exceeds threshold, calculate truncation ratio
    let truncatedDocs = includedDocs;
    if (totalLength > MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT) {
      const truncationRatio = MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT / totalLength;
      logInfo("Truncating documents to fit context length. Truncation ratio:", truncationRatio);
      truncatedDocs = includedDocs.map((doc) => ({
        ...doc,
        content: doc.content.slice(0, Math.floor(doc.content.length * truncationRatio)),
      }));
    }

    const formattedDocs = truncatedDocs
      .map((doc: any) => `Note in Vault: ${doc.content}`)
      .join("\n\n");

    return timeExpression
      ? `Local Search Result for ${timeExpression}:\n${formattedDocs}`
      : `Local Search Result:\n${formattedDocs}`;
  }

  protected async getSystemPrompt(): Promise<string> {
    return getSystemPrompt();
  }
}
