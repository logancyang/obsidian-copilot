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
import { logInfo } from "@/logger";
import { getSettings, getSystemPrompt } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { ToolManager } from "@/tools/toolManager";
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
    debug: boolean,
    sources?: { title: string; score: number }[]
  ) {
    if (fullAIResponse && abortController.signal.reason !== ABORT_REASON.NEW_CHAT) {
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
    }
    updateCurrentAiMessage("");
    if (debug) {
      console.log(
        "==== Chat Memory ====\n",
        (this.chainManager.memoryManager.getMemory().chatHistory as any).messages.map(
          (m: any) => m.content
        )
      );
      console.log("==== Final AI Response ====\n", fullAIResponse);
    }
    return fullAIResponse;
  }

  protected async handleError(
    error: any,
    debug: boolean,
    addMessage?: (message: ChatMessage) => void,
    updateCurrentAiMessage?: (message: string) => void
  ) {
    const msg = err2String(error);
    if (debug) console.error("Error during LLM invocation:", msg);
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

    console.error(errorData);

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
      console.error(errorData);
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
    const { debug = false } = options;
    const streamer = new ThinkBlockStreamer(updateCurrentAiMessage);

    try {
      const chain = this.chainManager.getChain();
      const chatStream = await chain.stream({
        input: userMessage.message,
      } as any);

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) break;
        streamer.processChunk(chunk);
      }
    } catch (error) {
      await this.handleError(error, debug, addMessage, updateCurrentAiMessage);
    }

    return this.handleResponse(
      streamer.close(),
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      debug
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
    const { debug = false } = options;
    let fullAIResponse = "";

    try {
      // Add check for empty index
      const indexEmpty = await this.chainManager.vectorStoreManager.isIndexEmpty();
      if (indexEmpty) {
        return this.handleResponse(
          EMPTY_INDEX_ERROR_MESSAGE,
          userMessage,
          abortController,
          addMessage,
          updateCurrentAiMessage,
          debug
        );
      }

      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const chatHistory = extractChatHistory(memoryVariables);
      const qaStream = await this.chainManager.getRetrievalChain().stream({
        question: userMessage.message,
        chat_history: chatHistory,
      } as any);

      for await (const chunk of qaStream) {
        if (abortController.signal.aborted) break;
        fullAIResponse += chunk.content;
        updateCurrentAiMessage(fullAIResponse);
      }

      fullAIResponse = this.addSourcestoResponse(fullAIResponse);
    } catch (error) {
      await this.handleError(error, debug, addMessage, updateCurrentAiMessage);
    }

    return this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      debug
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
    updateCurrentAiMessage: (message: string) => void,
    debug: boolean
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
      this.chainManager.chatModelManager.getChatModel().stream(messages)
    );

    for await (const chunk of chatStream) {
      if (abortController.signal.aborted) break;
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
    const { debug = false, updateLoadingMessage } = options;
    let fullAIResponse = "";
    let sources: { title: string; score: number }[] = [];

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
                updateCurrentAiMessage,
                debug
              );
            }
            return this.handleResponse(
              failMessage,
              userMessage,
              abortController,
              addMessage,
              updateCurrentAiMessage,
              debug
            );
          } catch (error) {
            console.error("Error processing YouTube video:", error);
            return this.handleResponse(
              failMessage,
              userMessage,
              abortController,
              addMessage,
              updateCurrentAiMessage,
              debug
            );
          }
        }
      }

      if (debug) console.log("==== Step 1: Analyzing intent ====");
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
          updateCurrentAiMessage,
          debug
        );
      }

      // Use the same removeAtCommands logic as IntentAnalyzer
      const cleanedUserMessage = userMessage.message
        .split(" ")
        .filter((word) => !COPILOT_TOOL_NAMES.includes(word.toLowerCase()))
        .join(" ")
        .trim();

      const toolOutputs = await this.executeToolCalls(toolCalls, debug, updateLoadingMessage);
      const localSearchResult = toolOutputs.find(
        (output) => output.tool === "localSearch" && output.output && output.output.length > 0
      );

      // Format chat history from memory
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const chatHistory = extractChatHistory(memoryVariables);

      if (localSearchResult) {
        if (debug) console.log("==== Step 2: Processing local search results ====");
        const documents = JSON.parse(localSearchResult.output);

        if (debug) console.log("==== Step 3: Condensing Question ====");
        const standaloneQuestion = await getStandaloneQuestion(cleanedUserMessage, chatHistory);
        if (debug) console.log("Condensed standalone question: ", standaloneQuestion);

        if (debug) console.log("==== Step 4: Preparing context ====");
        const timeExpression = this.getTimeExpression(toolCalls);
        const context = this.prepareLocalSearchResult(documents, timeExpression);

        const currentTimeOutputs = toolOutputs.filter((output) => output.tool === "getCurrentTime");
        const enhancedQuestion = this.prepareEnhancedUserMessage(
          standaloneQuestion,
          currentTimeOutputs
        );

        if (debug) console.log(context);
        if (debug) console.log("==== Step 5: Invoking QA Chain ====");
        const qaPrompt = await this.chainManager.promptManager.getQAPrompt({
          question: enhancedQuestion,
          context,
          systemMessage: "", // System prompt is added separately in streamMultimodalResponse
        });

        fullAIResponse = await this.streamMultimodalResponse(
          qaPrompt,
          userMessage,
          abortController,
          updateCurrentAiMessage,
          debug
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
          updateCurrentAiMessage,
          debug
        );
      }
    } catch (error) {
      // Reset loading message to default
      updateLoadingMessage?.(LOADING_MESSAGES.DEFAULT);
      await this.handleError(error, debug, addMessage, updateCurrentAiMessage);
    }

    return this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      debug,
      sources
    );
  }

  private getSources(documents: any): { title: string; score: number }[] {
    if (!documents || !Array.isArray(documents)) {
      console.warn("No valid documents provided to getSources");
      return [];
    }
    return this.sortUniqueDocsByScore(documents);
  }

  private sortUniqueDocsByScore(documents: any[]): any[] {
    const uniqueDocs = new Map<string, any>();

    // Iterate through all documents
    for (const doc of documents) {
      if (!doc.title || (!doc?.score && !doc?.rerank_score)) {
        console.warn("Invalid document structure:", doc);
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
    debug: boolean,
    updateLoadingMessage?: (message: string) => void
  ) {
    const toolOutputs = [];
    for (const toolCall of toolCalls) {
      if (debug) {
        console.log(`==== Step 2: Calling tool: ${toolCall.tool.name} ====`);
      }
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
      console.log("Truncating documents to fit context length. Truncation ratio:", truncationRatio);
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

export { CopilotPlusChainRunner, LLMChainRunner, ProjectChainRunner, VaultQAChainRunner };
