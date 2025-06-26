import { getCurrentProject } from "@/aiParams";
import { getStandaloneQuestion } from "@/chainUtils";
import {
  ABORT_REASON,
  AI_SENDER,
  EMPTY_INDEX_ERROR_MESSAGE,
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
import { HybridRetriever } from "@/search/hybridRetriever";
import { getSettings, getSystemPrompt } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { createGetFileTreeTool } from "@/tools/FileTreeTools";
import { indexTool, localSearchTool, webSearchTool } from "@/tools/SearchTools";
import {
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
  pomodoroTool,
} from "@/tools/TimeTools";
import { ToolManager } from "@/tools/toolManager";
import { simpleYoutubeTranscriptionTool } from "@/tools/YoutubeTools";
import {
  err2String,
  extractChatHistory,
  extractUniqueTitlesFromDocs,
  extractYoutubeUrl,
  formatDateTime,
  getApiErrorMessage,
  getMessageRole,
  withSuppressedTokenWarnings,
} from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Notice } from "obsidian";
import ChainManager from "./chainManager";
import { COPILOT_TOOL_NAMES, IntentAnalyzer } from "./intentAnalyzer";
import ProjectManager from "./projectManager";

class ThinkBlockStreamer {
  private hasOpenThinkBlock = false;
  private fullResponse = "";

  constructor(private updateCurrentAiMessage: (message: string) => void) {}

  private handleClaude37Chunk(content: any[]) {
    let textContent = "";
    for (const item of content) {
      switch (item.type) {
        case "text":
          textContent += item.text;
          break;
        case "thinking":
          if (!this.hasOpenThinkBlock) {
            this.fullResponse += "\n<think>";
            this.hasOpenThinkBlock = true;
          }
          this.fullResponse += item.thinking;
          this.updateCurrentAiMessage(this.fullResponse);
          return true; // Indicate we handled a thinking chunk
      }
    }
    if (textContent) {
      this.fullResponse += textContent;
    }
    return false; // No thinking chunk handled
  }

  private handleDeepseekChunk(chunk: any) {
    // Handle standard string content
    if (typeof chunk.content === "string") {
      this.fullResponse += chunk.content;
    }

    // Handle deepseek reasoning/thinking content
    if (chunk.additional_kwargs?.reasoning_content) {
      if (!this.hasOpenThinkBlock) {
        this.fullResponse += "\n<think>";
        this.hasOpenThinkBlock = true;
      }
      this.fullResponse += chunk.additional_kwargs.reasoning_content;
      return true; // Indicate we handled a thinking chunk
    }
    return false; // No thinking chunk handled
  }

  processChunk(chunk: any) {
    let handledThinking = false;

    // Handle Claude 3.7 array-based content
    if (Array.isArray(chunk.content)) {
      handledThinking = this.handleClaude37Chunk(chunk.content);
    } else {
      // Handle deepseek format
      handledThinking = this.handleDeepseekChunk(chunk);
    }

    // Close think block if we have one open and didn't handle thinking content
    if (this.hasOpenThinkBlock && !handledThinking) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }

    this.updateCurrentAiMessage(this.fullResponse);
  }

  close() {
    // Make sure to close any open think block at the end
    if (this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.updateCurrentAiMessage(this.fullResponse);
    }
    return this.fullResponse;
  }
}

export interface ChainRunner {
  run(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string>;
}

abstract class BaseChainRunner implements ChainRunner {
  protected chainManager: ChainManager;

  constructor(chainManager: ChainManager) {
    this.chainManager = chainManager;
  }

  abstract run(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string>;

  protected async handleResponse(
    fullAIResponse: string,
    userMessage: ChatMessage,
    abortController: AbortController,
    addMessage: (message: ChatMessage) => void,
    updateCurrentAiMessage: (message: string) => void,
    sources?: { title: string; score: number }[]
  ) {
    // Save to memory and add message if we have a response
    // Skip only if it's a NEW_CHAT abort (clearing everything)
    if (
      fullAIResponse &&
      !(abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT)
    ) {
      await this.chainManager.memoryManager
        .getMemory()
        .saveContext({ input: userMessage.message }, { output: fullAIResponse });

      addMessage({
        message: fullAIResponse,
        sender: AI_SENDER,
        isVisible: true,
        timestamp: formatDateTime(new Date()),
        sources: sources,
      });

      // Clear the streaming message since it's now in chat history
      updateCurrentAiMessage("");
    } else if (abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      // Also clear if it's a new chat
      updateCurrentAiMessage("");
    }
    logInfo(
      "==== Chat Memory ====\n",
      (this.chainManager.memoryManager.getMemory().chatHistory as any).messages.map(
        (m: any) => m.content
      )
    );
    logInfo("==== Final AI Response ====\n", fullAIResponse);
    return fullAIResponse;
  }

  protected async handleError(
    error: any,
    addMessage?: (message: ChatMessage) => void,
    updateCurrentAiMessage?: (message: string) => void
  ) {
    const msg = err2String(error);
    logError("Error during LLM invocation:", msg);
    const errorData = error?.response?.data?.error || msg;
    const errorCode = errorData?.code || msg;
    let errorMessage = "";

    // Check for specific error messages
    if (error?.message?.includes("Invalid license key")) {
      errorMessage = "Invalid Copilot Plus license key. Please check your license key in settings.";
    } else if (errorCode === "model_not_found") {
      errorMessage =
        "You do not have access to this model or the model does not exist, please check with your API provider.";
    } else {
      errorMessage = `${errorCode}`;
    }

    logError(errorData);

    if (addMessage && updateCurrentAiMessage) {
      updateCurrentAiMessage("");

      // remove langchain troubleshooting URL from error message
      const ignoreEndIndex = errorMessage.search("Troubleshooting URL");
      errorMessage = ignoreEndIndex !== -1 ? errorMessage.slice(0, ignoreEndIndex) : errorMessage;

      // add more user guide for invalid API key
      if (msg.search(/401|invalid|not valid/gi) !== -1) {
        errorMessage =
          "Something went wrong. Please check if you have set your API key." +
          "\nPath: Settings > copilot plugin > Basic Tab > Set Keys." +
          "\nOr check model config" +
          "\nError Details: " +
          errorMessage;
      }

      addMessage({
        message: errorMessage,
        isErrorMessage: true,
        sender: AI_SENDER,
        isVisible: true,
        timestamp: formatDateTime(new Date()),
      });
    } else {
      // Fallback to Notice if message handlers aren't provided
      new Notice(errorMessage);
      logError(errorData);
    }
  }
}

class LLMChainRunner extends BaseChainRunner {
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

class VaultQAChainRunner extends BaseChainRunner {
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
      // Add check for empty index
      const indexEmpty = await this.chainManager.vectorStoreManager.isIndexEmpty();
      if (indexEmpty) {
        return this.handleResponse(
          EMPTY_INDEX_ERROR_MESSAGE,
          userMessage,
          abortController,
          addMessage,
          updateCurrentAiMessage
        );
      }

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

      // Create retriever (similar to how it's done in chainManager)
      const retriever = new HybridRetriever({
        minSimilarityScore: 0.01,
        maxK: getSettings().maxSourceChunks,
        salientTerms: [],
      });

      // Retrieve relevant documents
      const retrievedDocs = await retriever.getRelevantDocuments(standaloneQuestion);

      // Store retrieved documents for sources
      this.chainManager.storeRetrieverDocuments(retrievedDocs);

      // Format documents as context
      const context = retrievedDocs.map((doc: any) => doc.pageContent).join("\n\n");

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

      // Add current user question
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

class CopilotPlusChainRunner extends BaseChainRunner {
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

  private async extractEmbeddedImages(content: string): Promise<string[]> {
    const imageRegex = /!\[\[(.*?\.(png|jpg|jpeg|gif|webp|bmp|svg))\]\]/g;
    const matches = [...content.matchAll(imageRegex)];
    const images = matches.map((match) => match[1]);
    return images;
  }

  private async buildMessageContent(
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
      const embeddedImages = await this.extractEmbeddedImages(textContent);
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

  private isMultimodalModel(model: BaseChatModel): boolean {
    return this.hasCapability(model, ModelCapability.VISION);
  }

  private async streamMultimodalResponse(
    textContent: string,
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void
  ): Promise<string> {
    // Get chat history
    const memory = this.chainManager.memoryManager.getMemory();
    const memoryVariables = await memory.loadMemoryVariables({});
    const chatHistory = extractChatHistory(memoryVariables);

    // Create messages array starting with system message
    const messages: any[] = [];

    // Add system message if available
    let fullSystemMessage = await this.getSystemPrompt();

    // Add chat history context to system message if exists
    if (chatHistory.length > 0) {
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

    // Add chat history
    for (const entry of chatHistory) {
      messages.push({ role: entry.role, content: entry.content });
    }

    // Get the current chat model
    const chatModelCurrent = this.chainManager.chatModelManager.getChatModel();
    const isMultimodalCurrent = this.isMultimodalModel(chatModelCurrent);

    // Build message content with text and images for multimodal models, or just text for text-only models
    const content = isMultimodalCurrent
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
    const streamer = new ThinkBlockStreamer(updateCurrentAiMessage);

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
      streamer.processChunk(chunk);
    }

    return streamer.close();
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
    let sources: { title: string; score: number }[] = [];
    let currentPartialResponse = "";

    // Wrapper to track partial response
    const trackAndUpdateAiMessage = (message: string) => {
      currentPartialResponse = message;
      updateCurrentAiMessage(message);
    };

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
      const localSearchResult = toolOutputs.find(
        (output) => output.tool === "localSearch" && output.output && output.output.length > 0
      );

      // Format chat history from memory
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const chatHistory = extractChatHistory(memoryVariables);

      if (localSearchResult) {
        logInfo("==== Step 2: Processing local search results ====");
        const documents = JSON.parse(localSearchResult.output);

        logInfo("==== Step 3: Condensing Question ====");
        const standaloneQuestion = await getStandaloneQuestion(cleanedUserMessage, chatHistory);
        logInfo("Condensed standalone question: ", standaloneQuestion);

        logInfo("==== Step 4: Preparing context ====");
        const timeExpression = this.getTimeExpression(toolCalls);
        const context = this.prepareLocalSearchResult(documents, timeExpression);

        const currentTimeOutputs = toolOutputs.filter((output) => output.tool === "getCurrentTime");
        const enhancedQuestion = this.prepareEnhancedUserMessage(
          standaloneQuestion,
          currentTimeOutputs
        );

        logInfo(context);
        logInfo("==== Step 5: Invoking QA Chain ====");
        const qaPrompt = await this.chainManager.promptManager.getQAPrompt({
          question: enhancedQuestion,
          context,
          systemMessage: "", // System prompt is added separately in streamMultimodalResponse
        });

        fullAIResponse = await this.streamMultimodalResponse(
          qaPrompt,
          userMessage,
          abortController,
          trackAndUpdateAiMessage
        );

        // Append sources to the response
        sources = this.getSources(documents);
      } else {
        // Enhance with tool outputs.
        const enhancedUserMessage = this.prepareEnhancedUserMessage(
          cleanedUserMessage,
          toolOutputs
        );
        // If no results, default to LLM Chain
        logInfo("No local search results. Using standard LLM Chain.");

        fullAIResponse = await this.streamMultimodalResponse(
          enhancedUserMessage,
          userMessage,
          abortController,
          trackAndUpdateAiMessage
        );
      }
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

    return this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      sources
    );
  }

  private getSources(documents: any): { title: string; score: number }[] {
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

      const currentDoc = uniqueDocs.get(doc.title);
      const isReranked = doc && "rerank_score" in doc;
      const docScore = isReranked ? doc.rerank_score : doc.score;

      // If the title doesn't exist in the map, or if the new doc has a higher score, update the map
      if (!currentDoc || docScore > (currentDoc.score ?? 0)) {
        uniqueDocs.set(doc.title, {
          title: doc.title,
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

  private prepareEnhancedUserMessage(userMessage: string, toolOutputs: any[]) {
    let context = "";
    if (toolOutputs.length > 0) {
      const validOutputs = toolOutputs.filter((output) => output.output != null);
      if (validOutputs.length > 0) {
        context =
          "\n\n# Additional context:\n\n" +
          validOutputs
            .map(
              (output) =>
                `<${output.tool}>\n${typeof output.output !== "string" ? JSON.stringify(output.output) : output.output}\n</${output.tool}>`
            )
            .join("\n\n");
      }
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

class ProjectChainRunner extends CopilotPlusChainRunner {
  protected async getSystemPrompt(): Promise<string> {
    let finalPrompt = getSystemPrompt();
    const projectConfig = getCurrentProject();
    if (!projectConfig) {
      return finalPrompt;
    }

    // Get context asynchronously
    const context = await ProjectManager.instance.getProjectContext(projectConfig.id);
    finalPrompt = `${finalPrompt}\n\n<project_system_prompt>\n${projectConfig.systemPrompt}\n</project_system_prompt>`;

    // TODO: Move project context out of the system prompt and into the user prompt.
    if (context) {
      finalPrompt = `${finalPrompt}\n\n <project_context>\n${context}\n</project_context>`;
    }

    return finalPrompt;
  }
}

interface ToolCall {
  name: string;
  args: any;
}

interface ToolExecutionResult {
  toolName: string;
  result: string;
  success: boolean;
}

class SequentialThinkingChainRunner extends CopilotPlusChainRunner {
  private parseXMLToolCalls(text: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    try {
      const regex = /<use_tool>([\s\S]*?)<\/use_tool>/g;

      let match;
      while ((match = regex.exec(text)) !== null) {
        const content = match[1];
        const nameMatch = content.match(/<name>([\s\S]*?)<\/name>/);
        const argsMatch = content.match(/<args>([\s\S]*?)<\/args>/);

        if (nameMatch) {
          const name = nameMatch[1].trim();

          // Validate tool name
          if (!name || name.length === 0) {
            logWarn("Skipping tool call with empty name");
            continue;
          }

          let args = {};

          if (argsMatch) {
            try {
              const argsText = argsMatch[1].trim();
              if (argsText) {
                args = JSON.parse(argsText);
              }
            } catch (e) {
              logError("Failed to parse tool arguments:", e);
              // Use the raw string as args if JSON parsing fails
              args = { raw: argsMatch[1].trim() };
            }
          }

          toolCalls.push({ name, args });
        }
      }
    } catch (error) {
      logError("Error parsing XML tool calls:", error);
      // Return empty array if parsing fails completely
      return [];
    }

    return toolCalls;
  }

  private async executeSequentialToolCall(
    toolCall: ToolCall,
    updateCurrentAiMessage: (message: string) => void
  ): Promise<ToolExecutionResult> {
    const TOOL_TIMEOUT = 30000; // 30 seconds timeout per tool

    try {
      // Validate tool call
      if (!toolCall || !toolCall.name) {
        return {
          toolName: toolCall?.name || "unknown",
          result: "Error: Invalid tool call - missing tool name",
          success: false,
        };
      }

      // Note: Tool execution message is now handled by the calling loop

      // Find the tool in the existing tool registry
      const availableTools = this.getAvailableTools();
      const tool = availableTools.find((t) => t.name === toolCall.name);

      if (!tool) {
        const availableToolNames = availableTools.map((t) => t.name).join(", ");
        return {
          toolName: toolCall.name,
          result: `Error: Tool '${toolCall.name}' not found. Available tools: ${availableToolNames}`,
          success: false,
        };
      }

      // Execute the tool with timeout
      const result = await Promise.race([
        ToolManager.callTool(tool, toolCall.args),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool execution timed out after ${TOOL_TIMEOUT}ms`)),
            TOOL_TIMEOUT
          )
        ),
      ]);

      // Validate result
      if (result === null || result === undefined) {
        logWarn(`Tool ${toolCall.name} returned null/undefined result`);
        return {
          toolName: toolCall.name,
          result: "Tool executed but returned no result",
          success: true,
        };
      }

      return {
        toolName: toolCall.name,
        result: typeof result === "string" ? result : JSON.stringify(result),
        success: true,
      };
    } catch (error) {
      logError(`Error executing tool ${toolCall.name}:`, error);
      return {
        toolName: toolCall.name,
        result: `Error: ${err2String(error)}`,
        success: false,
      };
    }
  }

  private getAvailableTools(): any[] {
    // Get tools from the existing IntentAnalyzer
    const tools: any[] = [
      localSearchTool,
      webSearchTool,
      pomodoroTool,
      simpleYoutubeTranscriptionTool,
      getCurrentTimeTool,
      getTimeInfoByEpochTool,
      getTimeRangeMsTool,
      indexTool,
    ];

    // Add file tree tool if available
    if (this.chainManager.app?.vault) {
      const fileTreeTool = createGetFileTreeTool(this.chainManager.app.vault.getRoot());
      tools.push(fileTreeTool);
    }

    return tools;
  }

  private generateToolDescriptions(): string {
    const tools = this.getAvailableTools();
    return tools
      .map((tool) => {
        const schema = tool.schema || {};
        const params = schema.properties
          ? Object.entries(schema.properties)
              .map(
                ([key, val]: [string, any]) => `  - ${key}: ${val.description || "No description"}`
              )
              .join("\n")
          : "";

        return `- ${tool.name}: ${tool.description}${params ? "\n" + params : ""}`;
      })
      .join("\n\n");
  }

  private stripToolCallXML(text: string): string {
    // Remove all <use_tool>...</use_tool> blocks
    let cleaned = text.replace(/<use_tool>[\s\S]*?<\/use_tool>/g, "");

    // Remove empty code blocks that might appear
    cleaned = cleaned.replace(/```\w*\s*```/g, "");

    // Remove tool_code blocks (both empty and with content)
    cleaned = cleaned.replace(/```tool_code[\s\S]*?```/g, "");

    // Remove any remaining empty code blocks with various languages
    cleaned = cleaned.replace(/```[\w]*[\s\n]*```/g, "");

    // Clean up excessive whitespace and trim
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, "\n\n").trim();

    return cleaned;
  }

  private logToolCall(toolCall: ToolCall, iteration: number): void {
    const displayName = this.getToolDisplayName(toolCall.name);
    const emoji = this.getToolEmoji(toolCall.name);

    // Create clean parameter display
    const paramDisplay =
      Object.keys(toolCall.args).length > 0
        ? JSON.stringify(toolCall.args, null, 2)
        : "(no parameters)";

    logInfo(`${emoji} [Iteration ${iteration}] ${displayName.toUpperCase()}`);
    logInfo(`Parameters:`, paramDisplay);
    logInfo("---");
  }

  private logToolResult(toolName: string, result: ToolExecutionResult): void {
    const displayName = this.getToolDisplayName(toolName);
    const emoji = this.getToolEmoji(toolName);
    const status = result.success ? "✅ SUCCESS" : "❌ FAILED";

    logInfo(`${emoji} ${displayName.toUpperCase()} RESULT: ${status}`);

    // Log abbreviated result for readability
    if (result.result.length > 500) {
      logInfo(
        `Result: ${result.result.substring(0, 500)}... (truncated, ${result.result.length} chars total)`
      );
    } else {
      logInfo(`Result:`, result.result);
    }
    logInfo("---");
  }

  private deduplicateSources(
    sources: { title: string; score: number }[]
  ): { title: string; score: number }[] {
    const uniqueSources = new Map<string, { title: string; score: number }>();

    for (const source of sources) {
      const existing = uniqueSources.get(source.title);
      if (!existing || source.score > existing.score) {
        uniqueSources.set(source.title, source);
      }
    }

    return Array.from(uniqueSources.values()).sort((a, b) => b.score - a.score);
  }

  private getToolDisplayName(toolName: string): string {
    const displayNameMap: Record<string, string> = {
      localSearch: "vault search",
      webSearch: "web search",
      getFileTree: "file tree",
      getCurrentTime: "current time",
      pomodoroTool: "pomodoro timer",
      simpleYoutubeTranscriptionTool: "YouTube transcription",
      indexTool: "index",
    };

    return displayNameMap[toolName] || toolName;
  }

  private getToolEmoji(toolName: string): string {
    const emojiMap: Record<string, string> = {
      localSearch: "🔍",
      webSearch: "🌐",
      getFileTree: "📁",
      getCurrentTime: "🕒",
      pomodoroTool: "⏱️",
      simpleYoutubeTranscriptionTool: "📺",
      indexTool: "📚",
    };

    return emojiMap[toolName] || "🔧";
  }

  private buildIterationDisplay(
    iterationHistory: string[],
    currentIteration: number,
    currentMessage: string
  ): string {
    // Simply join all history without headers or separators
    const allParts = [...iterationHistory];

    // Add current message if present
    if (currentMessage) {
      allParts.push(currentMessage);
    }

    // Join with simple spacing
    return allParts.join("\n\n");
  }

  private generateSystemPrompt(): string {
    const basePrompt = getSystemPrompt();
    const toolDescriptions = this.generateToolDescriptions();

    return `${basePrompt}

# Sequential Thinking Mode

You are now in sequential thinking mode. You can use tools to gather information and complete tasks step by step.

When you need to use a tool, format it EXACTLY like this:
<use_tool>
<name>tool_name_here</name>
<args>
{
  "param1": "value1",
  "param2": "value2"
}
</args>
</use_tool>

## Important Tool Usage Examples:

For localSearch (searching notes in the vault):
<use_tool>
<name>localSearch</name>
<args>
{
  "query": "piano learning",
  "salientTerms": ["piano", "learning", "practice", "music"]
}
</args>
</use_tool>

For webSearch:
<use_tool>
<name>webSearch</name>
<args>
{
  "query": "piano learning techniques",
  "chatHistory": []
}
</args>
</use_tool>

For getFileTree:
<use_tool>
<name>getFileTree</name>
<args>
{}
</args>
</use_tool>

Available tools:
${toolDescriptions}

CRITICAL: For localSearch, you MUST always provide both "query" (string) and "salientTerms" (array of strings). Extract key terms from the query for salientTerms.

You can use multiple tools in sequence. After each tool execution, you'll receive the results and can decide whether to use more tools or provide your final response.

Always explain your reasoning before using tools. Be conversational and clear about what you're doing.
When you've gathered enough information, provide your final response without any tool calls.

IMPORTANT: Do not include any code blocks (\`\`\`) or tool_code blocks in your responses. Only use the <use_tool> format for tool calls.`;
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
    let fullAIResponse = "";
    const conversationMessages: any[] = [];
    const iterationHistory: string[] = []; // Track all iterations for display
    const collectedSources: { title: string; score: number }[] = []; // Collect sources from localSearch

    try {
      // Get chat history from memory
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const chatHistory = extractChatHistory(memoryVariables);

      // Build initial conversation messages
      const customSystemPrompt = this.generateSystemPrompt();
      const chatModel = this.chainManager.chatModelManager.getChatModel();

      if (customSystemPrompt) {
        conversationMessages.push({
          role: getMessageRole(chatModel),
          content: customSystemPrompt,
        });
      }

      // Add chat history
      for (const entry of chatHistory) {
        conversationMessages.push({ role: entry.role, content: entry.content });
      }

      // Add current user message
      conversationMessages.push({
        role: "user",
        content: userMessage.message,
      });

      // Sequential thinking loop
      const maxIterations = 4; // Prevent infinite loops while allowing sufficient reasoning
      let iteration = 0;

      while (iteration < maxIterations) {
        if (abortController.signal.aborted) {
          break;
        }

        iteration++;
        logInfo(`=== Sequential Thinking Iteration ${iteration} ===`);

        // Get AI response
        const response = await this.streamResponse(
          conversationMessages,
          abortController,
          (message) => {
            // Strip tool calls from streaming display and show cumulative conversation
            const cleanedMessage = this.stripToolCallXML(message);
            const currentDisplay = [...iterationHistory, cleanedMessage].join("\n\n");
            updateCurrentAiMessage(currentDisplay);
          }
        );

        if (!response) break;

        // Parse tool calls from the response
        const toolCalls = this.parseXMLToolCalls(response);

        if (toolCalls.length === 0) {
          // No tool calls, this is the final response
          // Strip any tool call XML from final response too
          const cleanedResponse = this.stripToolCallXML(response);
          fullAIResponse = [...iterationHistory, cleanedResponse].join("\n\n");
          break;
        }

        // Store this iteration's response (AI reasoning) without tool call XML
        const responseWithoutToolCalls = this.stripToolCallXML(response);
        iterationHistory.push(responseWithoutToolCalls);

        // Execute tool calls and show progress
        const toolResults: ToolExecutionResult[] = [];
        const toolCallMessages: string[] = [];

        for (const toolCall of toolCalls) {
          if (abortController.signal.aborted) break;

          // Log tool call details for debugging
          this.logToolCall(toolCall, iteration);

          // Create tool calling message with better spacing and display name
          const toolEmoji = this.getToolEmoji(toolCall.name);
          const toolDisplayName = this.getToolDisplayName(toolCall.name);
          const toolCallingMessage = `<br/>\n\n${toolEmoji} *Calling ${toolDisplayName}...*\n\n<br/>`;
          toolCallMessages.push(toolCallingMessage);

          // Show all history plus all tool call messages
          const currentDisplay = [...iterationHistory, ...toolCallMessages].join("\n\n");
          updateCurrentAiMessage(currentDisplay);

          const result = await this.executeSequentialToolCall(toolCall, () => {});
          toolResults.push(result);

          // Log tool result
          this.logToolResult(toolCall.name, result);

          // Collect sources from localSearch results
          if (toolCall.name === "localSearch" && result.success) {
            try {
              const searchResults = JSON.parse(result.result);
              if (Array.isArray(searchResults)) {
                const sources = searchResults.map((doc: any) => ({
                  title: doc.title || doc.path,
                  score: doc.rerank_score || doc.score || 0,
                }));
                collectedSources.push(...sources);
              }
            } catch (e) {
              logWarn("Failed to parse localSearch results for sources:", e);
            }
          }
        }

        // Add all tool call messages to history so they persist
        if (toolCallMessages.length > 0) {
          iterationHistory.push(toolCallMessages.join("\n"));
        }

        // Don't add tool results to display - they're internal only

        // Add AI response to conversation for next iteration
        conversationMessages.push({
          role: "assistant",
          content: response,
        });

        // Add tool results as user messages for next iteration
        const toolResultsForConversation = toolResults
          .map((result) => `Tool '${result.toolName}' result: ${result.result}`)
          .join("\n\n");

        conversationMessages.push({
          role: "user",
          content: toolResultsForConversation,
        });

        logInfo("Tool results added to conversation:", toolResultsForConversation);
      }

      // If we hit max iterations, the last response becomes the final one
      if (iteration >= maxIterations && !fullAIResponse) {
        fullAIResponse = iterationHistory.join("\n\n");
      }
    } catch (error: any) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        logInfo("Sequential thinking stream aborted by user", {
          reason: abortController.signal.reason,
        });
      } else {
        logError("Sequential thinking failed, falling back to regular Plus mode:", error);

        // Fallback to regular CopilotPlusChainRunner
        try {
          const fallbackRunner = new CopilotPlusChainRunner(this.chainManager);
          return await fallbackRunner.run(
            userMessage,
            abortController,
            updateCurrentAiMessage,
            addMessage,
            options
          );
        } catch (fallbackError) {
          logError("Fallback to regular Plus mode also failed:", fallbackError);
          await this.handleError(fallbackError, addMessage, updateCurrentAiMessage);
          return "";
        }
      }
    }

    // Handle response like the parent class, with sources if we found any
    const uniqueSources = this.deduplicateSources(collectedSources);
    return this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      uniqueSources.length > 0 ? uniqueSources : undefined
    );
  }

  private async streamResponse(
    messages: any[],
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void
  ): Promise<string> {
    const streamer = new ThinkBlockStreamer(updateCurrentAiMessage);

    try {
      const chatStream = await withSuppressedTokenWarnings(() =>
        this.chainManager.chatModelManager.getChatModel().stream(messages, {
          signal: abortController.signal,
        })
      );

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) {
          break;
        }
        streamer.processChunk(chunk);
      }

      return streamer.close();
    } catch (error) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        return streamer.close();
      }
      throw error;
    }
  }
}

export {
  CopilotPlusChainRunner,
  LLMChainRunner,
  ProjectChainRunner,
  SequentialThinkingChainRunner,
  VaultQAChainRunner,
};
