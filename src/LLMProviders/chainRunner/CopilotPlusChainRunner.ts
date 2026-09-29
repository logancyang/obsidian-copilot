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
import { checkIsPaidUser } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import {
  getEffectiveUserPrompt,
  getSystemPromptWithMemory,
} from "@/system-prompts/systemPromptBuilder";
import { createWriteFileTool } from "@/tools/ComposerTools";
import { ToolManager } from "@/tools/toolManager";
import { ToolResultFormatter } from "@/tools/ToolResultFormatter";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import { createLocalSearchTool, webSearchTool } from "@/tools/SearchTools";
import { createUpdateMemoryTool } from "@/tools/memoryTools";
import { err2String, extractChatHistory } from "@/utils";
import { ChatMessage, ResponseMetadata } from "@/types/message";
import { getApiErrorMessage, getMessageRole, withSuppressedTokenWarnings } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseChainRunner } from "./BaseChainRunner";
import { ActionBlockStreamer } from "./utils/ActionBlockStreamer";
import { loadAndAddChatHistory } from "./utils/chatHistoryUtils";
import {
  addFallbackSources,
  formatSourceCatalog,
  getCitationFormatReminder,
  getLocalSearchGuidance,
  sanitizeContentForCitations,
  type SourceCatalogEntry,
} from "./utils/citationUtils";
import {
  extractSourcesFromSearchResults,
  formatMetadataOnlyDocuments,
  formatSearchResultsForLLM,
  formatSearchResultStringForLLM,
  formatSplitSearchResultsForLLM,
  generateQualitySummary,
  formatQualitySummary,
  isFilterOnlyResults,
  isTimeDominantResults,
  logSearchResultsDebugTable,
  type SearchDoc,
} from "./utils/searchResultUtils";
import {
  buildLocalSearchInnerContent,
  injectGuidanceBeforeUserQuery,
  renderCiCMessage,
  wrapLocalSearchPayload,
} from "./utils/cicPromptUtils";
import { extractMarkdownImagePaths } from "./utils/imageExtraction";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import { deduplicateSources } from "./utils/toolExecution";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import { unescapeXml } from "./utils/xmlParsing";
import { StructuredTool } from "@langchain/core/tools";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import ChainOwner from "@/LLMProviders/chainOwner";

type ToolCallWithExecutor = {
  tool: StructuredTool;
  args: Record<string, unknown>;
};

export class CopilotPlusChainRunner extends BaseChainRunner {
  protected getAvailableToolsForPlanning(): StructuredTool[] {
    const registry = ToolRegistry.getInstance();

    if (registry.getAllTools().length === 0) {
      initializeBuiltinTools(this.chainManager.app);
    }

    const allTools = registry.getAllTools().map((def) => def.tool);

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

  private async planToolCalls(
    userMessage: string,
    chatModel: BaseChatModel,
    hasActiveContextNote: boolean = false
  ): Promise<{ toolCalls: ToolCallWithExecutor[]; salientTerms: string[] }> {
    const availableTools = this.getAvailableToolsForPlanning();

    const modelWithTools = chatModel as BaseChatModel & {
      bindTools?: (tools: StructuredTool[]) => unknown;
    };
    if (typeof modelWithTools.bindTools !== "function") {
      logWarn("[CopilotPlus] Model does not support native tool calling, skipping tool planning");
      return {
        toolCalls: [],
        salientTerms: this.extractSalientTermsFromQuery(userMessage),
      };
    }

    const boundModel = modelWithTools.bindTools(availableTools);

    const activeContextHint = hasActiveContextNote
      ? "\n- The user has an active note attached in this turn. Its content is already available; do NOT call getFileTree merely because the user says 'this note' or 'this file'. Only call getFileTree when the user explicitly wants to discover OTHER notes, list folders, or verify paths."
      : "";
    const planningPrompt = `You are a helpful AI assistant. Analyze the user's message and determine if any tools should be called.

Guidelines:
- Use tools when the user's request requires external information or computation
- For time-related queries, use getTimeRangeMs to convert time expressions to timestamps
- Use getFileTree ONLY when the user wants to discover or list notes/folders in the vault — not to read content already in context${activeContextHint}
- If no tools are needed, respond with your analysis

After analyzing, extract key search terms from the user's message that would be useful for searching notes:
- Extract meaningful nouns, topics, and specific concepts
- Preserve the EXACT words and language from the user's message (works for any language)
- Exclude time expressions (those are handled by tools)

Include your extracted terms as: [SALIENT_TERMS: term1, term2, term3]`;

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

    let response: AIMessage;
    {
      const stream: AsyncIterable<AIMessageChunk> = await withSuppressedTokenWarnings(() =>
        (
          boundModel as { stream: (msgs: unknown) => Promise<AsyncIterable<AIMessageChunk>> }
        ).stream(planningMessages)
      );
      let aggregated: AIMessageChunk | undefined;
      for await (const chunk of stream) {
        aggregated = aggregated ? aggregated.concat(chunk) : chunk;
      }
      if (!aggregated) {
        throw new Error("[CopilotPlus] Received empty response from planning model");
      }
      response = new AIMessage({
        content: aggregated.content,
        tool_calls: aggregated.tool_calls,
        additional_kwargs: aggregated.additional_kwargs,
      });
    }

    const nativeToolCalls = response.tool_calls || [];
    const responseText =
      typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    logInfo("[CopilotPlus] Native tool calls:", nativeToolCalls.length);

    const { salientTerms } = this.extractPlanningFieldsFromResponse(responseText, userMessage);

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

    return { toolCalls, salientTerms };
  }

  private extractPlanningFieldsFromResponse(
    responseText: string,
    originalQuery: string
  ): { salientTerms: string[] } {
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

    return { salientTerms };
  }

  private extractSalientTermsFromQuery(query: string): string[] {
    return query
      .split(/[\s\p{P}]+/u)
      .filter((word) => word.length >= 3)
      .slice(0, 10);
  }

  private async processAtCommands(
    userMessage: string,
    existingToolCalls: ToolCallWithExecutor[],
    context: { salientTerms: string[]; timeRange?: unknown }
  ): Promise<ToolCallWithExecutor[]> {
    const message = userMessage.toLowerCase();
    const cleanQuery = this.removeAtCommands(userMessage);
    const toolCalls = [...existingToolCalls];

    if (message.includes("@vault")) {
      const hasLocalSearch = toolCalls.some((tc) => tc.tool.name === "localSearch");
      if (!hasLocalSearch) {
        toolCalls.push({
          tool: createLocalSearchTool(this.chainManager.app),
          args: {
            query: cleanQuery,
            salientTerms: context.salientTerms,
            timeRange: context.timeRange,
          },
        });
      }
    }

    if (message.includes("@websearch") || message.includes("@web")) {
      const hasWebSearch = toolCalls.some((tc) => tc.tool.name === "webSearch");
      if (!hasWebSearch) {
        const memory = ChainOwner.instance.getCurrentChainManager().memoryManager.getMemory();
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

    if (message.includes("@memory")) {
      const hasUpdateMemory = toolCalls.some((tc) => tc.tool.name === "updateMemory");
      if (!hasUpdateMemory) {
        toolCalls.push({
          tool: createUpdateMemoryTool(this.chainManager.app),
          args: {
            statement: cleanQuery,
          },
        });
      }
    }

    return toolCalls;
  }

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

  private async extractImagesFromContextBlock(
    l3Text: string,
    source: {
      tagName: string;
      identifierTag: string;
      displayName: string;
      useForResolution: boolean;
    }
  ): Promise<string[]> {
    const blockRegex = new RegExp(`<${source.tagName}>([\\s\\S]*?)<\\/${source.tagName}>`);
    const blockMatch = blockRegex.exec(l3Text);
    if (!blockMatch) return [];

    const block = blockMatch[1];

    const contentRegex = /<content>([\s\S]*?)<\/content>/;
    const contentMatch = contentRegex.exec(block);
    const content = contentMatch ? unescapeXml(contentMatch[1]) : "";
    if (!content) return [];

    const identifierRegex = new RegExp(
      `<${source.identifierTag}>(.*?)<\\/${source.identifierTag}>`
    );
    const identifierMatch = identifierRegex.exec(block);
    const identifier = identifierMatch ? identifierMatch[1] : undefined;

    logInfo(
      `[CopilotPlus] Extracting images from ${source.displayName}:`,
      identifier || `no ${source.identifierTag}`
    );

    const sourcePath = source.useForResolution ? identifier : undefined;
    return this.extractEmbeddedImages(content, sourcePath);
  }

  private async extractEmbeddedImages(content: string, sourcePath?: string): Promise<string[]> {
    const wikiImageRegex = /!\[\[(.*?\.(png|jpg|jpeg|gif|webp|bmp|svg))\]\]/g;

    const resolvedImages: string[] = [];

    const wikiMatches = [...content.matchAll(wikiImageRegex)];
    for (const match of wikiMatches) {
      const imageName = match[1];

      if (sourcePath) {
        const resolvedFile = this.chainManager.app.metadataCache.getFirstLinkpathDest(
          imageName,
          sourcePath
        );

        if (resolvedFile) {
          resolvedImages.push(resolvedFile.path);
        } else {
          logWarn(`Could not resolve embedded image: ${imageName} from source: ${sourcePath}`);
          resolvedImages.push(imageName);
        }
      } else {
        resolvedImages.push(imageName);
      }
    }

    const mdImagePaths = extractMarkdownImagePaths(content);
    for (const imagePath of mdImagePaths) {
      if (!imagePath) continue;

      if (imagePath.match(/^https?:\/\//)) {
        resolvedImages.push(imagePath);
        continue;
      }

      const cleanPath = imagePath.replace(/^\.\//, "").replace(/^\//, "");

      if (sourcePath) {
        const resolvedFile = this.chainManager.app.metadataCache.getFirstLinkpathDest(
          cleanPath,
          sourcePath
        );

        if (resolvedFile) {
          resolvedImages.push(resolvedFile.path);
        } else {
          resolvedImages.push(cleanPath);
        }
      } else {
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

    const imageSources: { urls: string[]; type: string }[] = [];

    if (settings.passMarkdownImages) {
      const envelope = userMessage.contextEnvelope;

      if (!envelope) {
        throw new Error(
          "[CopilotPlus] Context envelope is required but not available. Cannot extract images."
        );
      }

      const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
      if (l3Turn) {
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

    for (const source of imageSources) {
      const result = await this.processImageUrls(source.urls);
      successfulImages.push(...result.successfulImages);
      failureMessages.push(...result.failureDescriptions);
    }

    const existingContent = userMessage.content as MessageContent[] | undefined;
    if (existingContent && existingContent.length > 0) {
      const result = await this.processChatInputImages(existingContent);
      successfulImages.push(...result.successfulImages);
      failureMessages.push(...result.failureDescriptions);
    }

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

    if (successfulImages.length > 0) {
      messageContent.push(...successfulImages);
    }

    return messageContent;
  }

  protected hasCapability(model: BaseChatModel, capability: ModelCapability): boolean {
    const modelWithName = model as BaseChatModel & { modelName?: string; model?: string };
    const modelName: string = modelWithName.modelName || modelWithName.model || "";
    const customModel = this.chainManager.chatModelManager.findModelByName(modelName);
    return customModel?.capabilities?.includes(capability) ?? false;
  }

  protected isMultimodalModel(model: BaseChatModel): boolean {
    return this.hasCapability(model, ModelCapability.VISION);
  }

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
    allToolOutputs: { tool: string; output: unknown }[],
    abortController: AbortController,
    thinkStreamer: ThinkBlockStreamer,
    originalUserQuestion: string,
    updateLoadingMessage?: (message: string) => void
  ): Promise<void> {
    const memory = this.chainManager.memoryManager.getMemory();

    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const isMultimodalCurrent = this.isMultimodalModel(chatModel);

    const messages: { role: string; content: string | MessageContent[] }[] = [];

    const envelope = userMessage.contextEnvelope;
    if (!envelope) {
      throw new Error(
        "[CopilotPlus] Context envelope is required but not available. Cannot proceed with CopilotPlus chain."
      );
    }

    logInfo("[CopilotPlus] Using envelope-based context construction");

    const baseMessages = LayerToMessagesConverter.convert(envelope, {
      includeSystemMessage: true,
      mergeUserContent: true,
      debug: false,
    });

    const systemMessage = baseMessages.find((m) => m.role === "system");
    if (systemMessage) {
      messages.push({
        role: getMessageRole(chatModel),
        content: systemMessage.content,
      });
    }

    await loadAndAddChatHistory(memory, messages);

    const userMessageContent = baseMessages.find((m) => m.role === "user");
    if (userMessageContent) {
      let finalUserContent;

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
        const toolContext = this.formatAllToolOutputs(allToolOutputs);

        const userContentWithLabel = ensureUserQueryLabel(userMessageContent.content);
        finalUserContent = renderCiCMessage(toolContext, userContentWithLabel);

        const citationReminder = getCitationFormatReminder(getSettings().enableInlineCitations);
        if (citationReminder) {
          finalUserContent = injectGuidanceBeforeUserQuery(finalUserContent, citationReminder);
        }
      } else {
        finalUserContent = ensureUserQueryLabel(userMessageContent.content);
      }

      if (
        textContent.includes("<OUTPUT_FORMAT>") &&
        !finalUserContent.includes("<OUTPUT_FORMAT>")
      ) {
        const composerMatch = textContent.match(/<OUTPUT_FORMAT>[\s\S]*?<\/OUTPUT_FORMAT>/);
        if (composerMatch) {
          finalUserContent += "\n\n" + composerMatch[0];
        }
      }

      const content: string | MessageContent[] = isMultimodalCurrent
        ? await this.buildMessageContent(finalUserContent, userMessage)
        : finalUserContent;

      messages.push({
        role: "user",
        content,
      });
    }

    logInfo("Final request to AI", { messages: messages.length });

    const modelName = (chatModel as { modelName?: string } | undefined)?.modelName;
    recordPromptPayload({
      messages,
      modelName,
      contextEnvelope: userMessage.contextEnvelope,
    });

    const actionStreamer = new ActionBlockStreamer(
      ToolManager,
      createWriteFileTool(this.chainManager.app)
    );

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
      for await (const processedChunk of actionStreamer.processChunk(
        chunk as unknown as Record<string, unknown>
      )) {
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

    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const hasReasoning = this.hasCapability(chatModel, ModelCapability.REASONING);
    const excludeThinking = !hasReasoning;

    const thinkStreamer = new ThinkBlockStreamer(updateCurrentAiMessage, excludeThinking);
    let sources: { title: string; path: string; score: number; explanation?: unknown }[] = [];

    const isPaidUser = await checkIsPaidUser(this.chainManager.app, {
      trigger: "legacy_chat_turn",
      isCopilotPlus: true,
    });
    if (!isPaidUser) {
      await this.handleError(new Error("Invalid license key"), (message) =>
        thinkStreamer.processErrorChunk(message)
      );
      const errorResponse = thinkStreamer.close().content;

      return this.handleResponse(
        errorResponse,
        userMessage,
        abortController,
        addMessage,
        updateCurrentAiMessage,
        undefined
      );
    }

    try {
      logInfo("==== Step 1: Planning tools ====");
      let toolCalls: ToolCallWithExecutor[];

      const envelope = userMessage.contextEnvelope;
      if (!envelope) {
        throw new Error(
          "[CopilotPlus] Context envelope is required but not available. Cannot proceed with CopilotPlus chain."
        );
      }
      const l5User = envelope.layers.find((l) => l.id === "L5_USER");
      const messageForAnalysis = l5User?.text || userMessage.originalMessage || "";

      try {
        const chatModel = this.chainManager.chatModelManager.getChatModel();
        // Compacted envelopes merge prior-turn context into one segment, so only
        // current-turn segments may signal an attached active note.
        // https://github.com/logancyang/obsidian-copilot/issues/2456
        const l3TurnForPlanning = envelope.layers.find((l) => l.id === "L3_TURN");
        const hasActiveContextNote = !!l3TurnForPlanning?.segments?.some(
          (seg) => seg.metadata?.source === "current_turn" && /<active_note[\s>]/.test(seg.content)
        );
        const planningResult = await this.planToolCalls(
          messageForAnalysis,
          chatModel,
          hasActiveContextNote
        );

        let timeRange: unknown = undefined;
        const timeRangeCall = planningResult.toolCalls.find(
          (tc) => tc.tool.name === "getTimeRangeMs"
        );
        if (timeRangeCall) {
          const timeRangeResult = await ToolManager.callTool(
            timeRangeCall.tool,
            timeRangeCall.args
          );
          type TimeInfoResult = {
            startTime?: { epoch?: number };
            endTime?: { epoch?: number };
            error?: unknown;
          };
          const extractEpochValues = (result: TimeInfoResult): unknown => {
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
              const parsed = JSON.parse(timeRangeResult) as TimeInfoResult;
              if (!parsed.error) {
                timeRange = extractEpochValues(parsed);
              }
            } catch {
              logWarn("[CopilotPlus] Failed to parse getTimeRangeMs result:", timeRangeResult);
            }
          } else if (timeRangeResult) {
            const typedResult = timeRangeResult as TimeInfoResult;
            if (!typedResult.error) {
              timeRange = extractEpochValues(typedResult);
            }
          }
          logInfo("[CopilotPlus] Executed getTimeRangeMs, result:", timeRange);
        }

        const filteredToolCalls = planningResult.toolCalls.filter((tc) => {
          if (tc.tool.name === "getTimeRangeMs" && timeRange) {
            logInfo("Skipping getTimeRangeMs - already executed during planning");
            return false;
          }
          return true;
        });

        toolCalls = await this.processAtCommands(messageForAnalysis, filteredToolCalls, {
          salientTerms: planningResult.salientTerms,
          timeRange,
        });
      } catch (error: unknown) {
        return this.handleResponse(
          getApiErrorMessage(error),
          userMessage,
          abortController,
          addMessage,
          updateCurrentAiMessage
        );
      }

      const l5Text = userMessage.contextEnvelope?.layers.find((l) => l.id === "L5_USER")?.text;
      const cleanedUserMessage = this.removeAtCommands(
        l5Text || userMessage.originalMessage || userMessage.message
      );

      const { toolOutputs, sources: toolSources } = await this.executeToolCalls(
        toolCalls,
        updateLoadingMessage
      );

      sources = toolSources;

      const allToolOutputs = toolOutputs.filter((output) => output.output != null);

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
    } catch (error: unknown) {
      updateLoadingMessage?.(LOADING_MESSAGES.DEFAULT);

      if (
        (error instanceof Error && error.name === "AbortError") ||
        abortController.signal.aborted
      ) {
        logInfo("CopilotPlus stream aborted by user", { reason: abortController.signal.reason });
      } else {
        await this.handleError(error, (message) => thinkStreamer.processErrorChunk(message));
      }
    }

    if (abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      updateCurrentAiMessage("");
      return "";
    }

    const streamResult = thinkStreamer.close();
    let fullAIResponse = streamResult.content;

    const responseMetadata: ResponseMetadata | undefined = {
      wasTruncated: streamResult.wasTruncated,
      tokenUsage: streamResult.tokenUsage ?? undefined,
    };

    const settings = getSettings();
    const fallbackSources =
      this.lastCitationSources && this.lastCitationSources.length > 0
        ? this.lastCitationSources
        : (sources || []).map((source) => ({ title: source.title, path: source.path }));

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
    toolCalls: ToolCallWithExecutor[],
    updateLoadingMessage?: (message: string) => void
  ): Promise<{
    toolOutputs: { tool: string; output: unknown }[];
    sources: { title: string; path: string; score: number; explanation?: unknown }[];
  }> {
    const toolOutputs: { tool: string; output: unknown }[] = [];
    const allSources: { title: string; path: string; score: number; explanation?: unknown }[] = [];

    const hasLocalSearch = toolCalls.some((tc) => tc.tool.name === "localSearch");

    for (const toolCall of toolCalls) {
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
      let output: unknown;
      try {
        output = await ToolManager.callTool(toolCall.tool, toolCall.args);
      } catch (error) {
        // localSearch throws for an unusable backend; render that as a failed search the model can explain instead of aborting the turn.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/356
        if (toolCall.tool.name !== "localSearch") {
          throw error;
        }
        const failure = this.processLocalSearchResult({
          result: err2String(error),
          success: false,
        });
        toolOutputs.push({ tool: toolCall.tool.name, output: failure.formattedForLLM });
        continue;
      }

      if (toolCall.tool.name === "localSearch") {
        const outputStr = typeof output === "string" ? output : JSON.stringify(output);
        const result = { result: outputStr, success: output != null };
        const timeExpression = this.getTimeExpression(toolCalls);
        const processed = this.processLocalSearchResult(result, timeExpression);

        allSources.push(...processed.sources);

        toolOutputs.push({ tool: toolCall.tool.name, output: processed.formattedForLLM });
      } else {
        toolOutputs.push({ tool: toolCall.tool.name, output });
      }
    }

    return { toolOutputs, sources: deduplicateSources(allSources) };
  }

  private lastCitationSources: { title?: string; path?: string }[] | null = null;

  protected getTimeExpression(toolCalls: ToolCallWithExecutor[]): string {
    const timeRangeCall = toolCalls.find((call) => call.tool.name === "getTimeRangeMs");
    return timeRangeCall ? (timeRangeCall.args.timeExpression as string) : "";
  }

  private prepareLocalSearchResult(documents: unknown[], timeExpression: string): string {
    const settings = getSettings();

    type SearchDoc = {
      includeInContext?: boolean;
      mtime?: number;
      content?: string;
      source?: string;
      isFilterResult?: boolean;
      title?: string;
      path?: string;
      __sourceId?: number;
    };

    const typedDocs = documents as SearchDoc[];

    const includedDocs = typedDocs.filter((doc) => doc.includeInContext !== false);

    const qualitySummary = generateQualitySummary(includedDocs);
    const qualityHeader = formatQualitySummary(qualitySummary);

    const filterOnly = isFilterOnlyResults(includedDocs);
    const timeDominant = isTimeDominantResults(includedDocs);

    let tier1Docs: SearchDoc[];
    let tier2Docs: SearchDoc[];
    if (timeDominant) {
      const sorted = [...includedDocs].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      tier1Docs = sorted.slice(0, settings.maxSourceChunks);
      tier2Docs = sorted.slice(settings.maxSourceChunks);
    } else if (filterOnly) {
      tier1Docs = [];
      tier2Docs = includedDocs;
    } else {
      if (includedDocs.length > settings.maxSourceChunks) {
        tier1Docs = includedDocs.slice(0, settings.maxSourceChunks);
        tier2Docs = includedDocs.slice(settings.maxSourceChunks);
      } else {
        tier1Docs = includedDocs;
        tier2Docs = [];
      }
    }

    const totalContentLength = tier1Docs.reduce<number>((sum, doc) => {
      return sum + (doc.content ? doc.content.length : 0);
    }, 0);

    let processedDocs: SearchDoc[] = tier1Docs;
    if (totalContentLength > MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT) {
      const truncationRatio = MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT / totalContentLength;
      logInfo(
        "Truncating document contents to fit context length. Truncation ratio:",
        truncationRatio
      );
      processedDocs = tier1Docs.map(
        (doc): SearchDoc => ({
          ...doc,
          content:
            doc.content?.slice(0, Math.floor((doc.content?.length || 0) * truncationRatio)) || "",
        })
      );
    }

    const withIds: SearchDoc[] = processedDocs.map(
      (doc, idx): SearchDoc => ({
        ...doc,
        __sourceId: idx + 1,
        content: sanitizeContentForCitations((doc.content as string) || ""),
      })
    );

    const filterDocs = withIds.filter((d) => d.isFilterResult === true);
    const searchDocs = withIds.filter((d) => d.isFilterResult !== true);

    const hasFilterResults = filterDocs.length > 0;
    let formattedContent = hasFilterResults
      ? formatSplitSearchResultsForLLM(filterDocs, searchDocs)
      : tier1Docs.length === 0 && tier2Docs.length > 0
        ? formatMetadataOnlyDocuments(tier2Docs)
        : formatSearchResultsForLLM(withIds);

    if (tier1Docs.length > 0 && tier2Docs.length > 0) {
      if (timeDominant) {
        logInfo(
          `Time-dominant search: ${tier1Docs.length} recent notes (full content), ${tier2Docs.length} older notes (metadata-only)`
        );
      } else {
        logInfo(
          `Two-tier search: ${tier1Docs.length} full-content docs, ${tier2Docs.length} metadata-only docs`
        );
      }
      formattedContent = `${formattedContent}\n\n${formatMetadataOnlyDocuments(tier2Docs)}`;
    } else if (filterOnly) {
      logInfo(`Tag-only search: ${tier2Docs.length} notes (metadata-only)`);
    }

    const sourceEntries: SourceCatalogEntry[] = withIds
      .slice(0, Math.min(20, withIds.length))
      .map((d) => ({
        title: d.title || d.path || "Untitled",
        path: d.path || d.title || "",
      }));
    const catalogLines = formatSourceCatalog(sourceEntries);

    this.lastCitationSources = withIds.slice(0, Math.min(20, withIds.length)).map((d) => {
      const title = d.title || d.path || "Untitled";
      return {
        title,
        path: d.path || undefined,
      };
    });

    const guidance = getLocalSearchGuidance(catalogLines, settings.enableInlineCitations).trim();

    const ragInstruction = "Answer the question based only on the following context:";
    const documentsSection = buildLocalSearchInnerContent(ragInstruction, formattedContent);

    const fullInnerContent = guidance
      ? `${qualityHeader}\n\n${documentsSection}\n\n${guidance}`
      : `${qualityHeader}\n\n${documentsSection}`;

    return wrapLocalSearchPayload(fullInnerContent, timeExpression);
  }

  protected processLocalSearchResult(
    toolResult: { result: string; success: boolean },
    timeExpression?: string
  ): {
    formattedForLLM: string;
    formattedForDisplay: string;
    sources: { title: string; path: string; score: number; explanation?: unknown }[];
  } {
    let sources: { title: string; path: string; score: number; explanation?: unknown }[] = [];
    let formattedForLLM: string;
    let formattedForDisplay: string;

    if (!toolResult.success) {
      formattedForLLM = `<localSearch>\nSearch failed: ${toolResult.result}\n</localSearch>`;
      formattedForDisplay = `Search failed: ${toolResult.result}`;
      return { formattedForLLM, formattedForDisplay, sources };
    }

    try {
      const parsed = JSON.parse(toolResult.result) as { type?: unknown; documents?: unknown };
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

      logSearchResultsDebugTable(searchResults as SearchDoc[]);

      sources = extractSourcesFromSearchResults(searchResults);

      formattedForLLM = this.prepareLocalSearchResult(searchResults, timeExpression || "");
      formattedForDisplay = ToolResultFormatter.format("localSearch", formattedForLLM);
    } catch (error) {
      logWarn("Failed to parse localSearch results:", error);
      const formatted = formatSearchResultStringForLLM(toolResult.result);
      formattedForLLM = timeExpression
        ? `<localSearch timeRange="${timeExpression}">\n${formatted}\n</localSearch>`
        : `<localSearch>\n${formatted}\n</localSearch>`;
      formattedForDisplay = ToolResultFormatter.format("localSearch", formattedForLLM);
    }

    return { formattedForLLM, formattedForDisplay, sources };
  }

  protected async getSystemPrompt(): Promise<string> {
    return getSystemPromptWithMemory(
      this.chainManager.userMemoryManager,
      await getEffectiveUserPrompt(this.chainManager.app)
    );
  }

  private formatAllToolOutputs(toolOutputs: { tool: string; output: unknown }[]): string {
    if (toolOutputs.length === 0) return "";

    const formattedOutputs = toolOutputs
      .map((output) => {
        const content: string =
          typeof output.output === "string" ? output.output : JSON.stringify(output.output);
        return `<${output.tool}>\n${content}\n</${output.tool}>`;
      })
      .join("\n\n");

    return "# Additional context:\n\n" + formattedOutputs;
  }
}
