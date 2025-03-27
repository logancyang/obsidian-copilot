import { getStandaloneQuestion } from "@/chainUtils";
import {
  ABORT_REASON,
  AI_SENDER,
  EMPTY_INDEX_ERROR_MESSAGE,
  LOADING_MESSAGES,
  MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT,
  ModelCapability,
} from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logError } from "@/logger";
import { getSystemPrompt } from "@/settings/model";
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
  ImageContent,
  ImageProcessor,
  MessageContent,
} from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Notice } from "obsidian";
import ChainManager from "./chainManager";
import { COPILOT_TOOL_NAMES, IntentAnalyzer } from "./intentAnalyzer";

class ThinkBlockStreamer {
  private hasOpenThinkBlock = false;
  private fullResponse = "";

  constructor(private updateCurrentAiMessage: (message: string) => void) {}

  processChunk(chunk: any) {
    this.fullResponse += chunk.content;

    if (chunk.additional_kwargs?.reasoning_content) {
      // If we don't have an open think block, add one
      if (!this.hasOpenThinkBlock) {
        this.fullResponse += "\n<think>";
        this.hasOpenThinkBlock = true;
      }
      // Add the new reasoning content
      this.fullResponse += chunk.additional_kwargs.reasoning_content;
    } else if (this.hasOpenThinkBlock) {
      // If we have an open think block but no more reasoning content, close it
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
  constructor(protected chainManager: ChainManager) {}

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
      const chain = ChainManager.getChain();
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
      const qaStream = await ChainManager.getRetrievalChain().stream({
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
    const docTitles = extractUniqueTitlesFromDocs(ChainManager.retrievedDocuments);
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

  private async processImageUrls(urls: string[]): Promise<ImageContent[]> {
    try {
      const imageUrls = await Promise.all(
        urls.map(async (url) => {
          if (await ImageProcessor.isImageUrl(url, this.chainManager.app.vault)) {
            const imageContent = await ImageProcessor.convertToBase64(
              url,
              this.chainManager.app.vault
            );
            if (!imageContent) {
              logError(`Failed to process image: ${url}`);
              return null;
            }
            return imageContent;
          }
          return null;
        })
      );

      // Filter out null values and return valid image URLs
      const validImages = imageUrls.filter((item): item is ImageContent => item !== null);
      return validImages;
    } catch (error) {
      logError("Error processing image URLs:", error);
      return [];
    }
  }

  private async processExistingImages(content: MessageContent[]): Promise<ImageContent[]> {
    try {
      const imageContent = await Promise.all(
        content
          .filter(
            (item): item is ImageContent => item.type === "image_url" && !!item.image_url?.url
          )
          .map(async (item) => {
            const processedContent = await ImageProcessor.convertToBase64(
              item.image_url.url,
              this.chainManager.app.vault
            );
            if (!processedContent) {
              logError(`Failed to process existing image: ${item.image_url.url}`);
              return null;
            }
            return processedContent;
          })
      );
      return imageContent.filter((item): item is ImageContent => item !== null);
    } catch (error) {
      logError("Error processing images:", error);
      return [];
    }
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
    const content: MessageContent[] = [
      {
        type: "text",
        text: textContent,
      },
    ];

    // Process URLs in the message to identify images
    if (userMessage.context?.urls && userMessage.context.urls.length > 0) {
      const imageContents = await this.processImageUrls(userMessage.context.urls);
      content.push(...imageContents);
    }

    // Process embedded images from the text content
    const embeddedImages = await this.extractEmbeddedImages(textContent);
    if (embeddedImages.length > 0) {
      const imageContents = await this.processImageUrls(embeddedImages);
      content.push(...imageContents);
    }

    // Add existing image content if present
    if (userMessage.content && userMessage.content.length > 0) {
      const imageContents = await this.processExistingImages(userMessage.content);
      content.push(...imageContents);
    }

    return content;
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
    let fullSystemMessage = getSystemPrompt();

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
    for (const [human, ai] of chatHistory) {
      messages.push({ role: "user", content: human });
      messages.push({ role: "assistant", content: ai });
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

    // Add debug logging for final request
    if (debug) {
      console.log("==== Final Request to AI ====\n", messages);
    }

    const streamer = new ThinkBlockStreamer(updateCurrentAiMessage);
    const chatStream = await this.chainManager.chatModelManager.getChatModel().stream(messages);

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
      try {
        // Use the original message for intent analysis
        const messageForAnalysis = userMessage.originalMessage || userMessage.message;
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

      if (localSearchResult) {
        if (debug) console.log("==== Step 2: Processing local search results ====");
        const documents = JSON.parse(localSearchResult.output);

        // Format chat history from memory
        const memory = this.chainManager.memoryManager.getMemory();
        const memoryVariables = await memory.loadMemoryVariables({});
        const chatHistory = extractChatHistory(memoryVariables);

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
          context: context,
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
        const enhancedUserMessage = this.prepareEnhancedUserMessage(
          cleanedUserMessage,
          toolOutputs
        );
        // If no results, default to LLM Chain
        if (debug) {
          console.log("No local search results. Using standard LLM Chain.");
          console.log("Enhanced user message:", enhancedUserMessage);
        }

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
    return `User message: ${userMessage}${context}`;
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
}

export { CopilotPlusChainRunner, LLMChainRunner, VaultQAChainRunner };
