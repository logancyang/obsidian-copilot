import { ModelCapability } from "@/constants";
import { MessageContent } from "@/imageProcessing/imageProcessor";
import { logError, logInfo, logWarn } from "@/logger";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { checkIsPlusUser } from "@/plusUtils";
import { getSettings, getSystemPromptWithMemory } from "@/settings/model";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import { extractParametersFromZod, SimpleTool } from "@/tools/SimpleTool";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { deriveReadNoteDisplayName, ToolResultFormatter } from "@/tools/ToolResultFormatter";
import { ChatMessage, ResponseMetadata, StreamingResult } from "@/types/message";
import { err2String, getMessageRole, withSuppressedTokenWarnings } from "@/utils";
import { formatErrorChunk, processToolResults } from "@/utils/toolResultUtils";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { CopilotPlusChainRunner } from "./CopilotPlusChainRunner";
import { addChatHistoryToMessages } from "./utils/chatHistoryUtils";
import {
  joinPromptSections,
  messageRequiresTools,
  ModelAdapter,
  ModelAdapterFactory,
  STREAMING_TRUNCATE_THRESHOLD,
} from "./utils/modelAdapter";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import {
  createToolCallMarker,
  ensureEncodedToolCallMarkerResults,
  updateToolCallMarker,
} from "./utils/toolCallParser";
import {
  deduplicateSources,
  executeSequentialToolCall,
  getToolConfirmtionMessage,
  getToolDisplayName,
  getToolEmoji,
  logToolCall,
  logToolResult,
  ToolExecutionResult,
} from "./utils/toolExecution";

import { ensureCiCOrderingWithQuestion } from "./utils/cicPromptUtils";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { buildAgentPromptDebugReport } from "./utils/promptDebugService";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import { PromptDebugReport } from "./utils/toolPromptDebugger";
import {
  extractToolNameFromPartialBlock,
  parseXMLToolCalls,
  stripToolCallXML,
} from "./utils/xmlParsing";

type ConversationMessage = {
  role: string;
  content: string | MessageContent[];
};

type AgentSource = {
  title: string;
  path: string;
  score: number;
  explanation?: any;
};

interface AgentLoopDeps {
  availableTools: SimpleTool<any, any>[];
  getTemporaryToolCallId: (toolName: string, index: number) => string;
  processLocalSearchResult: (
    toolResult: { result: string; success: boolean },
    timeExpression?: string
  ) => {
    formattedForLLM: string;
    formattedForDisplay: string;
    sources: AgentSource[];
  };
  applyCiCOrderingToLocalSearchResult: (
    localSearchPayload: string,
    originalPrompt: string
  ) => string;
}

interface AgentRunContext {
  conversationMessages: ConversationMessage[];
  iterationHistory: string[];
  collectedSources: AgentSource[];
  originalUserPrompt: string;
  loopDeps: AgentLoopDeps;
}

interface AgentLoopParams extends AgentRunContext {
  adapter: ModelAdapter;
  abortController: AbortController;
  updateCurrentAiMessage: (message: string) => void;
}

interface AgentLoopResult {
  fullAIResponse: string;
  responseMetadata?: ResponseMetadata;
  iterationHistory: string[];
  collectedSources: AgentSource[];
  llmMessages: string[];
}

interface AgentFinalizationParams extends AgentRunContext {
  userMessage: ChatMessage;
  abortController: AbortController;
  addMessage: (message: ChatMessage) => void;
  updateCurrentAiMessage: (message: string) => void;
  modelNameForLog?: string;
  responseMetadata?: ResponseMetadata;
  fullAIResponse: string;
}

export class AutonomousAgentChainRunner extends CopilotPlusChainRunner {
  private llmFormattedMessages: string[] = []; // Track LLM-formatted messages for memory
  private lastDisplayedContent = ""; // Track the last content displayed to user for error recovery

  private getAvailableTools(): SimpleTool<any, any>[] {
    const settings = getSettings();
    const registry = ToolRegistry.getInstance();

    // Initialize tools if not already done
    if (registry.getAllTools().length === 0) {
      initializeBuiltinTools(this.chainManager.app?.vault);
    }

    // Get enabled tool IDs from settings
    const enabledToolIds = new Set(settings.autonomousAgentEnabledToolIds || []);

    // Get all enabled tools from registry
    return registry.getEnabledTools(enabledToolIds, !!this.chainManager.app?.vault);
  }

  public static generateToolDescriptions(availableTools: SimpleTool<any, any>[]): string {
    const tools = availableTools;
    return tools
      .map((tool) => {
        let params = "";

        // All tools now have Zod schema
        const parameters = extractParametersFromZod(tool.schema);
        if (Object.keys(parameters).length > 0) {
          params = Object.entries(parameters)
            .map(([key, description]) => `<${key}>${description}</${key}>`)
            .join("\n");
        }

        return `<${tool.name}>
<description>${tool.description}</description>
<parameters>
${params}
</parameters>
</${tool.name}>`;
      })
      .join("\n\n");
  }

  public static async generateSystemPrompt(
    availableTools: SimpleTool<any, any>[],
    adapter: ModelAdapter,
    userMemoryManager?: UserMemoryManager
  ): Promise<string> {
    const basePrompt = await getSystemPromptWithMemory(userMemoryManager);
    const toolDescriptions = AutonomousAgentChainRunner.generateToolDescriptions(availableTools);

    const toolNames = availableTools.map((tool) => tool.name);

    // Get tool metadata for custom instructions
    const registry = ToolRegistry.getInstance();
    const toolMetadata = availableTools
      .map((tool) => registry.getToolMetadata(tool.name))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);

    return adapter.enhanceSystemPrompt(basePrompt, toolDescriptions, toolNames, toolMetadata);
  }

  /**
   * Build an annotated prompt report for debugging tool call prompting.
   *
   * @param userMessage - The user chat message to inspect.
   * @returns A prompt debug report containing sections and annotated string output.
   */
  public async buildToolPromptDebugReport(userMessage: ChatMessage): Promise<PromptDebugReport> {
    const availableTools = this.getAvailableTools();
    const adapter = ModelAdapterFactory.createAdapter(
      this.chainManager.chatModelManager.getChatModel()
    );
    const toolDescriptions = AutonomousAgentChainRunner.generateToolDescriptions(availableTools);

    return buildAgentPromptDebugReport({
      chainManager: this.chainManager,
      adapter,
      availableTools,
      toolDescriptions,
      userMessage,
    });
  }

  /**
   * Apply CiC ordering by appending the original user question after the local search payload.
   * Guidance is now self-contained within each localSearch payload from prepareLocalSearchResult.
   *
   * @param localSearchPayload - XML-wrapped local search payload prepared for the LLM (includes guidance).
   * @param originalPrompt - The original user prompt (before any enhancements).
   * @returns Payload with question appended using CiC ordering when needed.
   */
  protected applyCiCOrderingToLocalSearchResult(
    localSearchPayload: string,
    originalPrompt: string
  ): string {
    return ensureCiCOrderingWithQuestion(localSearchPayload, originalPrompt);
  }

  private getTemporaryToolCallId(toolName: string, index: number): string {
    return `temporary-tool-call-id-${toolName}-${index}`;
  }

  /**
   * Execute the autonomous agent workflow end-to-end, handling preparation,
   * iterative tool execution, and final response persistence.
   */
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
    this.llmFormattedMessages = [];
    this.lastDisplayedContent = ""; // Reset to prevent stale content from previous runs
    let fullAIResponse = "";
    let responseMetadata: ResponseMetadata | undefined;

    const isPlusUser = await checkIsPlusUser({
      isAutonomousAgent: true,
    });

    // Use model adapter for clean model-specific handling
    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const adapter = ModelAdapterFactory.createAdapter(chatModel);

    // Check if the current model has reasoning capability
    const hasReasoning = this.hasCapability(chatModel, ModelCapability.REASONING);
    const excludeThinking = !hasReasoning;

    // Create ThinkBlockStreamer to manage all content and errors
    const thinkStreamer = new ThinkBlockStreamer(updateCurrentAiMessage, adapter, excludeThinking);

    if (!isPlusUser) {
      await this.handleError(
        new Error("Invalid license key"),
        thinkStreamer.processErrorChunk.bind(thinkStreamer)
      );
      const errorResponse = thinkStreamer.close().content;

      // Use handleResponse to properly save error to conversation history and memory
      return this.handleResponse(
        errorResponse,
        userMessage,
        abortController,
        addMessage,
        updateCurrentAiMessage,
        undefined // no sources
      );
    }

    const modelNameForLog = (chatModel as { modelName?: string } | undefined)?.modelName;

    // Validate and extract context envelope (required)
    const envelope = userMessage.contextEnvelope;
    if (!envelope) {
      throw new Error(
        "[Agent] Context envelope is required but not available. Cannot proceed with autonomous agent."
      );
    }

    logInfo("[Agent] Using envelope-based context construction");

    const context = await this.prepareAgentConversation(userMessage, chatModel);

    try {
      const loopResult = await this.executeAgentLoop({
        ...context,
        adapter,
        abortController,
        updateCurrentAiMessage,
      });
      fullAIResponse = loopResult.fullAIResponse;
      responseMetadata = loopResult.responseMetadata;
      context.iterationHistory = loopResult.iterationHistory;
      context.collectedSources = loopResult.collectedSources;
      this.llmFormattedMessages = loopResult.llmMessages;
    } catch (error: any) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        logInfo("Autonomous agent stream aborted by user", {
          reason: abortController.signal.reason,
        });
      } else {
        logError("Autonomous agent failed, falling back to regular Plus mode:", error);
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

          // Use thinkStreamer to format and display the error
          // If we have displayed content, add it first before the error
          if (this.lastDisplayedContent) {
            thinkStreamer.processChunk({ content: this.lastDisplayedContent });
          }

          // Append fallback error information to the existing error response
          const autonomousAgentErrorMsg = err2String(error);

          const fallbackErrorMsg =
            `\n\nFallback to regular Plus mode also failed: ` + err2String(fallbackError);

          await this.handleError(
            new Error(autonomousAgentErrorMsg + fallbackErrorMsg),
            thinkStreamer.processErrorChunk.bind(thinkStreamer)
          );

          fullAIResponse = thinkStreamer.close().content;

          // Return immediately to prevent further execution
          return this.handleResponse(
            fullAIResponse,
            userMessage,
            abortController,
            addMessage,
            updateCurrentAiMessage,
            undefined, // no sources
            fullAIResponse // llmFormattedOutput
          );
        }
      }
    }

    return await this.finalizeAgentRun({
      ...context,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      modelNameForLog,
      responseMetadata,
      fullAIResponse,
    });
  }

  /**
   * Prepare the base conversation state, including system prompt, chat history,
   * and the initial user message tailored for the active model.
   *
   * @param userMessage - The initiating user message from the UI.
   * @param chatModel - The active chat model instance.
   * @returns Aggregated context required for the autonomous agent loop.
   */
  private async prepareAgentConversation(
    userMessage: ChatMessage,
    chatModel: any
  ): Promise<AgentRunContext> {
    const conversationMessages: ConversationMessage[] = [];
    const iterationHistory: string[] = [];
    const collectedSources: AgentSource[] = [];
    const availableTools = this.getAvailableTools();
    const loopDeps: AgentLoopDeps = {
      availableTools,
      getTemporaryToolCallId: this.getTemporaryToolCallId.bind(this),
      processLocalSearchResult: this.processLocalSearchResult.bind(this),
      applyCiCOrderingToLocalSearchResult: this.applyCiCOrderingToLocalSearchResult.bind(this),
    };

    // Extract envelope (validated in run())
    const envelope = userMessage.contextEnvelope!;

    // Use LayerToMessagesConverter to get base messages with L1+L2 system, L3+L5 user
    const baseMessages = LayerToMessagesConverter.convert(envelope, {
      includeSystemMessage: true,
      mergeUserContent: true,
      debug: false,
    });

    // Get memory for chat history
    const memory = this.chainManager.memoryManager.getMemory();
    const memoryVariables = await memory.loadMemoryVariables({});
    const rawHistory = memoryVariables.history || [];

    // Build system message: L1+L2 from envelope + tool-only sections
    const systemMessage = baseMessages.find((m) => m.role === "system");

    // Build tool-only sections (excluding base prompt which is already in L1)
    const adapter = ModelAdapterFactory.createAdapter(chatModel);
    const toolDescriptions = AutonomousAgentChainRunner.generateToolDescriptions(availableTools);
    const registry = ToolRegistry.getInstance();
    const toolMetadata = availableTools
      .map((tool) => registry.getToolMetadata(tool.name))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);

    const allSections = adapter.buildSystemPromptSections(
      "", // Pass empty base prompt since we already have L1+L2 from envelope
      toolDescriptions,
      availableTools.map((t) => t.name),
      toolMetadata
    );

    // Filter out base-system-prompt section (already in L1 from envelope)
    const toolOnlySections = allSections.filter((s) => s.id !== "base-system-prompt");
    const toolDescriptionsPrompt = joinPromptSections(toolOnlySections);

    if (systemMessage || toolDescriptionsPrompt) {
      const systemContent = [
        systemMessage?.content || "", // L1 + L2 from envelope
        toolDescriptionsPrompt || "", // Tool-specific sections only
      ]
        .filter(Boolean)
        .join("\n\n");

      conversationMessages.push({
        role: getMessageRole(chatModel),
        content: systemContent,
      });
    }

    // Insert L4 (chat history) between system and user
    addChatHistoryToMessages(rawHistory, conversationMessages);

    // Extract L5 for original prompt and adapter enhancement
    const l5User = envelope.layers.find((l) => l.id === "L5_USER");
    const l5Text = l5User?.text || "";
    const originalUserPrompt = l5Text || userMessage.originalMessage || userMessage.message;

    // Extract user content (L3 smart references + L5) from base messages
    const userMessageContent = baseMessages.find((m) => m.role === "user");
    if (userMessageContent) {
      const isMultimodal = this.isMultimodalModel(chatModel);

      // Apply adapter enhancement to restore model-specific tool reminders
      // (e.g., "REMINDER: Use the <use_tool> XML format" for GPT models)
      const requiresTools = messageRequiresTools(l5Text);
      const enhancedUserContent = adapter.enhanceUserMessage(
        userMessageContent.content,
        requiresTools
      );

      const content: string | MessageContent[] = isMultimodal
        ? await this.buildMessageContent(enhancedUserContent, userMessage)
        : enhancedUserContent;

      conversationMessages.push({
        role: "user",
        content,
      });
    }

    return {
      conversationMessages,
      iterationHistory,
      collectedSources,
      originalUserPrompt,
      loopDeps,
    };
  }

  /**
   * Execute the autonomous agent iteration loop until completion, handling
   * streaming updates, tool execution, and sanitized response tracking.
   *
   * @param params - Mutable conversation context and runtime dependencies.
   * @returns The final response text and metadata from the executed loop.
   */
  private async executeAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
    const {
      conversationMessages,
      iterationHistory: initialIterationHistory,
      collectedSources: initialCollectedSources,
      originalUserPrompt,
      loopDeps,
      adapter,
      abortController,
      updateCurrentAiMessage,
    } = params;

    const iterationHistory = [...initialIterationHistory];
    const collectedSources = [...initialCollectedSources];
    const llmMessages: string[] = [];
    const { availableTools } = loopDeps;
    const maxIterations = getSettings().autonomousAgentMaxIterations;
    let iteration = 0;
    let fullAIResponse = "";
    let responseMetadata: ResponseMetadata | undefined;

    while (iteration < maxIterations) {
      if (this.isAbortRequested(abortController)) {
        break;
      }

      iteration += 1;
      logInfo(`=== Autonomous Agent Iteration ${iteration} ===`);

      const currentIterationToolCallMessages: string[] = [];

      const response = await this.streamResponse(
        conversationMessages,
        abortController,
        (fullMessage) =>
          this.updateStreamingDisplay(
            fullMessage,
            iterationHistory,
            currentIterationToolCallMessages,
            updateCurrentAiMessage,
            loopDeps
          ),
        adapter
      );

      responseMetadata = {
        wasTruncated: response.wasTruncated,
        tokenUsage: response.tokenUsage ?? undefined,
      };

      const responseContent = response.content;
      if (!responseContent) {
        break;
      }

      const toolCalls = parseXMLToolCalls(responseContent);
      const prematureResponseResult = adapter.detectPrematureResponse?.(responseContent);
      if (prematureResponseResult?.hasPremature && iteration === 1) {
        if (prematureResponseResult.type === "before") {
          logWarn("⚠️  Model provided premature response BEFORE tool calls!");
          logWarn("Sanitizing response to keep only tool calls for first iteration");
        } else if (prematureResponseResult.type === "after") {
          logWarn("⚠️  Model provided hallucinated response AFTER tool calls!");
          logWarn("Truncating response at last tool call for first iteration");
        }
      }

      if (toolCalls.length === 0) {
        const cleanedResponse = stripToolCallXML(responseContent);
        const allParts = [...iterationHistory];
        if (cleanedResponse.trim()) {
          allParts.push(cleanedResponse);
        }
        fullAIResponse = allParts.join("\n\n");

        const safeAssistantMessage = ensureEncodedToolCallMarkerResults(responseContent);
        conversationMessages.push({
          role: "assistant",
          content: safeAssistantMessage,
        });

        llmMessages.push(responseContent);
        break;
      }

      let sanitizedResponse = responseContent;
      if (adapter.sanitizeResponse && prematureResponseResult?.hasPremature) {
        sanitizedResponse = adapter.sanitizeResponse(responseContent, iteration);
      }

      const responseForHistory = stripToolCallXML(sanitizedResponse);
      if (responseForHistory.trim()) {
        iterationHistory.push(responseForHistory);
      }

      const toolResults: ToolExecutionResult[] = [];
      const toolCallIdMap = new Map<number, string>(); // Map index to tool call ID
      currentIterationToolCallMessages.splice(toolCalls.length);

      for (let i = 0; i < toolCalls.length; i += 1) {
        const toolCall = toolCalls[i];
        if (this.isAbortRequested(abortController)) {
          break;
        }

        logToolCall(toolCall, iteration);

        const tool = availableTools.find((availableTool) => availableTool.name === toolCall.name);
        const isBackgroundTool = tool?.isBackground || false;

        let toolCallId: string | undefined;
        if (!isBackgroundTool) {
          const toolEmoji = getToolEmoji(toolCall.name);
          let toolDisplayName = getToolDisplayName(toolCall.name);
          if (toolCall.name === "readNote") {
            const notePath =
              typeof toolCall.args?.notePath === "string" ? toolCall.args.notePath : null;
            if (notePath && notePath.trim().length > 0) {
              toolDisplayName = deriveReadNoteDisplayName(notePath);
            }
          }
          const confirmationMessage = getToolConfirmtionMessage(toolCall.name);

          // Generate unique ID for this tool call
          toolCallId = `${toolCall.name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
          toolCallIdMap.set(i, toolCallId);

          const toolCallMarker = createToolCallMarker(
            toolCallId,
            toolCall.name,
            toolDisplayName,
            toolEmoji,
            confirmationMessage || "",
            true,
            "",
            ""
          );

          const existingIndex = currentIterationToolCallMessages.findIndex((message) =>
            message.includes(loopDeps.getTemporaryToolCallId(toolCall.name, i))
          );
          if (existingIndex !== -1) {
            currentIterationToolCallMessages[existingIndex] = toolCallMarker;
          } else {
            currentIterationToolCallMessages.push(toolCallMarker);
            logWarn(
              "Created tool call marker for tool call that was not created during streaming",
              toolCall.name
            );
          }

          updateCurrentAiMessage(
            [...iterationHistory, ...currentIterationToolCallMessages].join("\n\n")
          );
        }

        const result = await executeSequentialToolCall(
          toolCall,
          availableTools,
          originalUserPrompt
        );

        // Handle tool execution error - format error for UI display
        if (!result.success) {
          // Format error with errorChunk tags for proper UI display
          result.displayResult = formatErrorChunk(result.result, "Tool execution failed");
          // Keep the original result for LLM processing (don't modify result.result)
        }

        if (toolCall.name === "localSearch") {
          if (result.success) {
            const processed = loopDeps.processLocalSearchResult(result);
            collectedSources.push(...processed.sources);
            result.result = loopDeps.applyCiCOrderingToLocalSearchResult(
              processed.formattedForLLM,
              originalUserPrompt || ""
            );
            result.displayResult = processed.formattedForDisplay;
          }
        } else if (toolCall.name === "readNote") {
          if (result.success) {
            result.displayResult = ToolResultFormatter.format("readNote", result.result);
          }
        }

        toolResults.push(result);

        if (toolCallId && !isBackgroundTool) {
          const markerIndex = currentIterationToolCallMessages.findIndex((message) =>
            message.includes(toolCallId)
          );
          if (markerIndex !== -1) {
            currentIterationToolCallMessages[markerIndex] = updateToolCallMarker(
              currentIterationToolCallMessages[markerIndex],
              toolCallId,
              result.displayResult ?? result.result
            );
          }

          updateCurrentAiMessage(
            [...iterationHistory, ...currentIterationToolCallMessages].join("\n\n")
          );
        }

        logToolResult(toolCall.name, result);
      }

      if (currentIterationToolCallMessages.length > 0) {
        iterationHistory.push(currentIterationToolCallMessages.join("\n"));
      }

      const assistantMemoryContent = sanitizedResponse;
      llmMessages.push(assistantMemoryContent);

      if (toolResults.length > 0) {
        const toolResultsForLLM = processToolResults(toolResults, true);
        if (toolResultsForLLM) {
          llmMessages.push(toolResultsForLLM);
        }
      }

      const safeAssistantContent = ensureEncodedToolCallMarkerResults(sanitizedResponse);
      conversationMessages.push({
        role: "assistant",
        content: safeAssistantContent,
      });

      const toolResultsForConversation = processToolResults(toolResults, false);
      conversationMessages.push({
        role: "user",
        content: toolResultsForConversation,
      });

      logInfo("Tool results added to conversation");
    }

    if (iteration >= maxIterations && !fullAIResponse) {
      logWarn(
        `Autonomous agent reached maximum iterations (${maxIterations}) without completing the task`
      );

      const limitMessage =
        "\n\nI've reached the maximum number of iterations (" +
        `${maxIterations}` +
        ") for this task. " +
        "I attempted to gather information using various tools but couldn't complete the analysis within the iteration limit. " +
        "You may want to try a more specific question or break down your request into smaller parts.";

      fullAIResponse = iterationHistory.join("\n\n") + limitMessage;
      conversationMessages.push({
        role: "assistant",
        content: fullAIResponse,
      });
    }

    return {
      fullAIResponse,
      responseMetadata,
      iterationHistory,
      collectedSources,
      llmMessages,
    };
  }

  /**
   * Handle streaming updates by maintaining tool call markers and refreshing the
   * in-progress message display.
   */
  private updateStreamingDisplay(
    fullMessage: string,
    iterationHistory: string[],
    currentIterationToolCallMessages: string[],
    updateCurrentAiMessage: (message: string) => void,
    loopDeps: AgentLoopDeps
  ): void {
    const cleanedMessage = stripToolCallXML(fullMessage);
    const displayParts: string[] = [...iterationHistory];

    if (cleanedMessage.trim()) {
      displayParts.push(cleanedMessage);
    }

    const toolCalls = parseXMLToolCalls(fullMessage);
    const backgroundToolNames = new Set(
      loopDeps.availableTools.filter((tool) => tool.isBackground).map((tool) => tool.name)
    );

    // Remove any accidental background-tool markers to avoid orphaned spinners
    if (currentIterationToolCallMessages.length > 0 && backgroundToolNames.size > 0) {
      const backgroundPrefixes = Array.from(backgroundToolNames).map(
        (name) => `temporary-tool-call-id-${name}-`
      );
      for (let i = currentIterationToolCallMessages.length - 1; i >= 0; i -= 1) {
        const message = currentIterationToolCallMessages[i];
        if (backgroundPrefixes.some((prefix) => message.includes(prefix))) {
          currentIterationToolCallMessages.splice(i, 1);
        }
      }
    }

    const visibleToolNames: string[] = [];
    toolCalls.forEach((toolCall) => {
      if (!backgroundToolNames.has(toolCall.name)) {
        visibleToolNames.push(toolCall.name);
      }
    });

    const partialToolName = extractToolNameFromPartialBlock(fullMessage);
    if (partialToolName) {
      const lastToolNameIndex = fullMessage.lastIndexOf(partialToolName);
      if (fullMessage.length - lastToolNameIndex > STREAMING_TRUNCATE_THRESHOLD) {
        if (!backgroundToolNames.has(partialToolName)) {
          visibleToolNames.push(partialToolName);
        }
      }
    }

    const uniqueVisibleNames = Array.from(new Set(visibleToolNames));

    uniqueVisibleNames.forEach((toolName, index) => {
      const toolCallId = loopDeps.getTemporaryToolCallId(toolName, index);
      const existingIndex = currentIterationToolCallMessages.findIndex((message) =>
        message.includes(toolCallId)
      );
      if (existingIndex !== -1) {
        return;
      }

      const toolCallMarker = createToolCallMarker(
        toolCallId,
        toolName,
        getToolDisplayName(toolName),
        getToolEmoji(toolName),
        "",
        true,
        "",
        ""
      );

      currentIterationToolCallMessages.push(toolCallMarker);
    });

    if (currentIterationToolCallMessages.length > 0) {
      displayParts.push(currentIterationToolCallMessages.join("\n"));
    }

    const currentDisplay = displayParts.join("\n\n");
    this.lastDisplayedContent = currentDisplay; // Save for error handling
    updateCurrentAiMessage(currentDisplay);
  }

  private isAbortRequested(abortController: AbortController): boolean {
    return abortController.signal.aborted;
  }

  /**
   * Finalize the run by persisting prompt payloads, updating memory, and
   * returning the final response string to the caller.
   *
   * @param params - Finalization metadata including conversation context.
   * @returns The finalized AI response presented to the user.
   */
  private async finalizeAgentRun(params: AgentFinalizationParams): Promise<string> {
    const {
      conversationMessages,
      iterationHistory,
      collectedSources,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      modelNameForLog,
      responseMetadata,
      fullAIResponse,
    } = params;

    let finalResponse = fullAIResponse;
    const uniqueSources = deduplicateSources(collectedSources);

    if (!finalResponse && iterationHistory.length > 0) {
      logWarn("fullAIResponse was empty, using iteration history");
      finalResponse = iterationHistory.join("\n\n");
    }

    if (conversationMessages.length > 0) {
      recordPromptPayload({
        messages: [...conversationMessages],
        modelName: modelNameForLog,
        contextEnvelope: userMessage.contextEnvelope,
      });
    }

    await import("./utils/toolCallParser");

    const llmFormattedOutput = this.llmFormattedMessages.join("\n\n");

    await this.handleResponse(
      finalResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      uniqueSources.length > 0 ? uniqueSources : undefined,
      llmFormattedOutput,
      responseMetadata
    );

    // Reset after successful completion to prevent state leakage
    this.lastDisplayedContent = "";

    return finalResponse;
  }

  private async streamResponse(
    messages: ConversationMessage[],
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    adapter: ModelAdapter
  ): Promise<StreamingResult> {
    // Check if the current model has reasoning capability
    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const hasReasoning = this.hasCapability(chatModel, ModelCapability.REASONING);
    const excludeThinking = !hasReasoning;

    const streamer = new ThinkBlockStreamer(updateCurrentAiMessage, adapter, excludeThinking);

    const maxRetries = 2;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        // Convert ConversationMessage to LangChain BaseMessage format
        const langchainMessages: BaseMessage[] = messages.map((msg) => {
          if (msg.role === "user") {
            return new HumanMessage(msg.content);
          } else {
            return new AIMessage(msg.content);
          }
        });

        const chatStream = await withSuppressedTokenWarnings(() =>
          this.chainManager.chatModelManager.getChatModel().stream(langchainMessages, {
            signal: abortController.signal,
          })
        );

        for await (const chunk of chatStream) {
          if (abortController.signal.aborted) {
            break;
          }
          streamer.processChunk(chunk);
        }

        const result = streamer.close();

        return {
          content: result.content,
          wasTruncated: result.wasTruncated,
          tokenUsage: result.tokenUsage,
        };
      } catch (error) {
        if (error.name === "AbortError" || abortController.signal.aborted) {
          const result = streamer.close();
          return {
            content: result.content,
            wasTruncated: result.wasTruncated,
            tokenUsage: result.tokenUsage,
          };
        }

        // Check if this is an overloaded error that we should retry
        const isOverloadedError =
          error?.message?.includes("overloaded") ||
          error?.message?.includes("Overloaded") ||
          error?.error?.type === "overloaded_error";

        if (isOverloadedError && retryCount < maxRetries) {
          retryCount++;
          logInfo(
            `Retrying autonomous agent request (attempt ${retryCount}/${maxRetries + 1}) due to overloaded error`
          );

          // Wait before retrying (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
          continue;
        }

        throw error;
      }
    }

    // This should never be reached, but just in case
    const result = streamer.close();
    return {
      content: result.content,
      wasTruncated: result.wasTruncated,
      tokenUsage: result.tokenUsage,
    };
  }
}
