import { AGENT_LOOP_TIMEOUT_MS, ModelCapability } from "@/constants";
import { MessageContent } from "@/imageProcessing/imageProcessor";
import { logError, logInfo, logWarn } from "@/logger";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { checkIsPlusUser } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { getSystemPromptWithMemory } from "@/system-prompts/systemPromptBuilder";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { StructuredTool } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import { ChatMessage, ResponseMetadata, StreamingResult } from "@/types/message";
import { err2String, withSuppressedTokenWarnings } from "@/utils";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { CopilotPlusChainRunner } from "./CopilotPlusChainRunner";
import { loadAndAddChatHistory } from "./utils/chatHistoryUtils";
import { ModelAdapter, ModelAdapterFactory } from "./utils/modelAdapter";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import {
  deduplicateSources,
  executeSequentialToolCall,
  logToolCall,
  logToolResult,
} from "./utils/toolExecution";
import {
  createToolResultMessage,
  generateToolCallId,
  buildToolCallsFromChunks,
  ToolCallChunk,
} from "./utils/nativeToolCalling";

import { ensureCiCOrderingWithQuestion } from "./utils/cicPromptUtils";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { buildAgentPromptDebugReport } from "./utils/promptDebugService";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import { PromptDebugReport } from "./utils/toolPromptDebugger";
import {
  AgentReasoningState,
  createInitialReasoningState,
  extractFirstSentence,
  LocalSearchSourceInfo,
  serializeReasoningBlock,
  summarizeToolCall,
  summarizeToolResult,
  QueryExpansionInfo,
} from "./utils/AgentReasoningState";
import { QueryExpander } from "@/search/v3/QueryExpander";

type AgentSource = {
  title: string;
  path: string;
  score: number;
  explanation?: any;
};

/**
 * Dependencies for the ReAct agent loop - simplified for native tool calling
 */
interface AgentLoopDeps {
  availableTools: StructuredTool[];
  boundModel: Runnable; // Model with tools bound via bindTools()
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

/**
 * Context for agent run - uses BaseMessage[] for native tool calling
 */
interface AgentRunContext {
  messages: BaseMessage[]; // Native LangChain messages
  collectedSources: AgentSource[];
  originalUserPrompt: string;
  loopDeps: AgentLoopDeps;
}

/**
 * Parameters for the ReAct loop
 */
interface ReActLoopParams {
  boundModel: Runnable;
  tools: StructuredTool[];
  messages: BaseMessage[];
  originalPrompt: string;
  abortController: AbortController;
  updateCurrentAiMessage: (message: string) => void;
  processLocalSearchResult: AgentLoopDeps["processLocalSearchResult"];
  applyCiCOrderingToLocalSearchResult: AgentLoopDeps["applyCiCOrderingToLocalSearchResult"];
  adapter: ModelAdapter;
}

/**
 * Result from the ReAct loop
 */
interface ReActLoopResult {
  finalResponse: string;
  sources: AgentSource[];
  responseMetadata?: ResponseMetadata;
}

export class AutonomousAgentChainRunner extends CopilotPlusChainRunner {
  private llmFormattedMessages: string[] = []; // Track LLM-formatted messages for memory
  private lastDisplayedContent = ""; // Track the last content displayed to user for error recovery

  // Agent Reasoning Block state
  private reasoningState: AgentReasoningState = createInitialReasoningState();
  private reasoningTimerInterval: ReturnType<typeof setInterval> | null = null;
  private accumulatedContent = ""; // Track content to include in timer updates
  private allReasoningSteps: Array<{ timestamp: number; summary: string; toolName?: string }> = []; // Full history of all steps
  private abortHandledByTimer = false; // Flag to prevent duplicate interrupted messages

  private getAvailableTools(): StructuredTool[] {
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

  /**
   * Start the reasoning timer and initialize reasoning state.
   * Timer runs independently and always includes accumulated content.
   * Also monitors abort signal to show interrupted message immediately.
   *
   * @param updateFn - Function to call with updated message content
   * @param abortController - AbortController to monitor for user interruption
   */
  private startReasoningTimer(
    updateFn: (message: string) => void,
    abortController?: AbortController
  ): void {
    this.reasoningState = {
      status: "reasoning",
      startTime: Date.now(),
      elapsedSeconds: 0,
      steps: [],
    };
    this.accumulatedContent = "";
    this.allReasoningSteps = []; // Reset full history
    this.abortHandledByTimer = false; // Reset abort flag

    // Add initial step immediately for better UX (randomized for variety)
    const initialSteps = [
      "Understanding your question",
      "Analyzing your request",
      "Processing your query",
      "Thinking about this",
      "Considering your question",
      "Working on this",
      "Pondering the possibilities",
      "Diving into your request",
      "Let me think about this",
      "Exploring your question",
      "Getting my thoughts together",
      "Examining the details",
      "Looking into this",
      "Mulling this over",
      "On it",
      "Firing up the neurons",
      "Connecting the dots",
      "Brewing some ideas",
      "Spinning up the gears",
      "Warming up the engines",
      "Crunching the details",
      "Putting on my thinking cap",
      "Consulting my notes",
      "Gathering my thoughts",
      "Rolling up my sleeves",
    ];
    const randomStep = initialSteps[Math.floor(Math.random() * initialSteps.length)];
    this.addReasoningStep(randomStep);

    // Update every 100ms for smooth timer - always includes accumulated content
    this.reasoningTimerInterval = setInterval(() => {
      // Check for abort and show interrupted message immediately
      if (abortController?.signal.aborted && this.reasoningState.status === "reasoning") {
        this.stopReasoningTimer();
        this.reasoningState.status = "complete";
        this.abortHandledByTimer = true; // Mark that we've handled the abort
        const reasoningBlock = this.buildReasoningBlockMarkup();
        const interruptedMessage = "The response was interrupted.";
        const finalResponse = reasoningBlock
          ? reasoningBlock + "\n\n" + interruptedMessage
          : interruptedMessage;
        updateFn(finalResponse);
        return;
      }

      if (this.reasoningState.startTime && this.reasoningState.status === "reasoning") {
        this.reasoningState.elapsedSeconds = Math.floor(
          (Date.now() - this.reasoningState.startTime) / 1000
        );
        // Always update with reasoning block + any accumulated content
        const reasoningBlock = this.buildReasoningBlockMarkup();
        const fullMessage = reasoningBlock
          ? reasoningBlock + (this.accumulatedContent ? "\n\n" + this.accumulatedContent : "")
          : this.accumulatedContent;
        updateFn(fullMessage);
      }
    }, 100);
  }

  /**
   * Add a reasoning step to the display.
   * During reasoning: shows rolling window of last 4 steps.
   * After completion: full history is available for expanded view.
   *
   * @param summary - Human-readable summary of the step
   * @param toolName - Optional name of the tool associated with this step
   */
  private addReasoningStep(summary: string, toolName?: string, detailedOnly = false): void {
    const step = {
      timestamp: Date.now(),
      summary,
      toolName,
    };
    // Always add to full history
    this.allReasoningSteps.push(step);

    // For detailed-only steps, skip the rolling display
    if (detailedOnly) {
      return;
    }

    // Add to display state (rolling window)
    this.reasoningState.steps.push(step);
    // Keep only last 4 steps for rolling window display during reasoning
    if (this.reasoningState.steps.length > 4) {
      this.reasoningState.steps.shift();
    }
  }

  /**
   * Stop the reasoning timer and mark reasoning as collapsed.
   */
  private stopReasoningTimer(): void {
    if (this.reasoningTimerInterval) {
      clearInterval(this.reasoningTimerInterval);
      this.reasoningTimerInterval = null;
    }
    this.reasoningState.status = "collapsed";
  }

  /**
   * Get early feedback message for a tool that may take a while to stream.
   * This provides immediate UX feedback while the model generates content.
   *
   * @param toolName - Name of the tool being called
   * @returns Early feedback message, or null if no early feedback needed
   */
  /**
   * Build the reasoning block markup for embedding in the message.
   * During reasoning: uses rolling window (last 4 steps).
   * When complete: uses full history so expanded view shows all steps.
   *
   * @returns Markup string for the reasoning block
   */
  private buildReasoningBlockMarkup(): string {
    // When complete, use full history for the expanded view
    if (this.reasoningState.status === "complete" || this.reasoningState.status === "collapsed") {
      const stateWithFullHistory: AgentReasoningState = {
        ...this.reasoningState,
        steps: this.allReasoningSteps,
      };
      return serializeReasoningBlock(stateWithFullHistory);
    }
    // During reasoning, use the rolling window
    return serializeReasoningBlock(this.reasoningState);
  }

  /**
   * Generate system prompt for the autonomous agent.
   * Note: Tool schemas are handled by bindTools(), so we only include
   * semantic guidance from tool metadata here.
   */
  public static async generateSystemPrompt(
    availableTools: StructuredTool[],
    _adapter?: ModelAdapter, // Unused, kept for backwards compatibility with tests
    userMemoryManager?: UserMemoryManager
  ): Promise<string> {
    const basePrompt = await getSystemPromptWithMemory(userMemoryManager);

    // Get tool metadata for custom instructions (semantic guidance only)
    const registry = ToolRegistry.getInstance();
    const toolMetadata = availableTools
      .map((tool) => registry.getToolMetadata(tool.name))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);

    // Build tool-specific instructions from metadata (no XML format needed)
    const toolInstructions = toolMetadata
      .filter((meta) => meta.customPromptInstructions)
      .map((meta) => `For ${meta.displayName}: ${meta.customPromptInstructions}`)
      .join("\n");

    if (toolInstructions) {
      return `${basePrompt}\n\n## Tool Guidelines\n${toolInstructions}`;
    }
    return basePrompt;
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
    // Tool descriptions are now handled natively by bindTools()
    const toolDescriptions = availableTools.map((t) => `${t.name}: ${t.description}`).join("\n");

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

  /**
   * Execute the autonomous agent workflow end-to-end using native tool calling.
   * Follows the ReAct pattern: Reasoning → Acting → Observation → Iteration
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
    this.lastDisplayedContent = "";

    const isPlusUser = await checkIsPlusUser({
      isAutonomousAgent: true,
    });

    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const adapter = ModelAdapterFactory.createAdapter(chatModel);
    const hasReasoning = this.hasCapability(chatModel, ModelCapability.REASONING);
    const excludeThinking = !hasReasoning;
    const thinkStreamer = new ThinkBlockStreamer(updateCurrentAiMessage, excludeThinking);

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
        undefined
      );
    }

    const modelNameForLog = (chatModel as { modelName?: string } | undefined)?.modelName;

    const envelope = userMessage.contextEnvelope;
    if (!envelope) {
      throw new Error(
        "[Agent] Context envelope is required but not available. Cannot proceed with autonomous agent."
      );
    }

    logInfo("[Agent] Using native tool calling with ReAct pattern");

    const context = await this.prepareAgentConversation(
      userMessage,
      chatModel,
      options.updateLoadingMessage
    );

    try {
      // Start reasoning timer just before the ReAct loop (so timer starts at 0)
      this.startReasoningTimer(updateCurrentAiMessage, abortController);

      // Run the simplified ReAct loop with native tool calling
      const loopResult = await this.runReActLoop({
        boundModel: context.loopDeps.boundModel,
        tools: context.loopDeps.availableTools,
        messages: context.messages,
        originalPrompt: context.originalUserPrompt,
        abortController,
        updateCurrentAiMessage,
        processLocalSearchResult: context.loopDeps.processLocalSearchResult,
        applyCiCOrderingToLocalSearchResult: context.loopDeps.applyCiCOrderingToLocalSearchResult,
        adapter,
      });

      // If abort was already handled by timer, skip further processing
      if (this.abortHandledByTimer) {
        this.lastDisplayedContent = "";
        return "";
      }

      // Finalize and return
      const uniqueSources = deduplicateSources(loopResult.sources);

      if (context.messages.length > 0) {
        recordPromptPayload({
          messages: [...context.messages],
          modelName: modelNameForLog,
          contextEnvelope: userMessage.contextEnvelope,
        });
      }

      await this.handleResponse(
        loopResult.finalResponse,
        userMessage,
        abortController,
        addMessage,
        updateCurrentAiMessage,
        uniqueSources.length > 0 ? uniqueSources : undefined,
        this.llmFormattedMessages.join("\n\n"),
        loopResult.responseMetadata
      );

      this.lastDisplayedContent = "";
      return loopResult.finalResponse;
    } catch (error: any) {
      // Always stop the reasoning timer on error
      this.stopReasoningTimer();

      if (error.name === "AbortError" || abortController.signal.aborted) {
        logInfo("Autonomous agent stream aborted by user", {
          reason: abortController.signal.reason,
        });
        return "";
      }

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

        if (this.lastDisplayedContent) {
          thinkStreamer.processChunk({ content: this.lastDisplayedContent });
        }

        const autonomousAgentErrorMsg = err2String(error);
        const fallbackErrorMsg =
          `\n\nFallback to regular Plus mode also failed: ` + err2String(fallbackError);

        await this.handleError(
          new Error(autonomousAgentErrorMsg + fallbackErrorMsg),
          thinkStreamer.processErrorChunk.bind(thinkStreamer)
        );

        const fullAIResponse = thinkStreamer.close().content;
        return this.handleResponse(
          fullAIResponse,
          userMessage,
          abortController,
          addMessage,
          updateCurrentAiMessage,
          undefined,
          fullAIResponse
        );
      }
    }
  }

  /**
   * Prepare the base conversation state for native tool calling.
   * Creates a bound model with tools and builds initial messages.
   *
   * @param userMessage - The initiating user message from the UI.
   * @param chatModel - The active chat model instance.
   * @param _updateLoadingMessage - Unused, kept for potential future use.
   * @returns Context required for the ReAct agent loop.
   */
  private async prepareAgentConversation(
    userMessage: ChatMessage,
    chatModel: any,
    _updateLoadingMessage?: (message: string) => void // Unused, kept for potential future use
  ): Promise<AgentRunContext> {
    const messages: BaseMessage[] = [];
    const availableTools = this.getAvailableTools();

    // Bind tools to the model for native function calling
    const modelName = (chatModel as any).modelName || (chatModel as any).model || "unknown";
    if (typeof chatModel.bindTools !== "function") {
      throw new Error(
        `Model ${modelName} does not support native tool calling (bindTools not available). ` +
          `Agent mode requires a model with tool calling support.`
      );
    }
    const boundModel = chatModel.bindTools(availableTools);

    const loopDeps: AgentLoopDeps = {
      availableTools,
      boundModel,
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

    // Get memory for chat history loading
    const memory = this.chainManager.memoryManager.getMemory();

    // Build system message: L1+L2 from envelope + tool guidelines from metadata
    const systemMessage = baseMessages.find((m) => m.role === "system");

    // Get tool metadata for semantic guidance (no XML format instructions needed)
    const registry = ToolRegistry.getInstance();
    const toolMetadata = availableTools
      .map((tool) => registry.getToolMetadata(tool.name))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);

    // Build tool-specific instructions from metadata
    const toolInstructions = toolMetadata
      .filter((meta) => meta.customPromptInstructions)
      .map((meta) => `For ${meta.displayName}: ${meta.customPromptInstructions}`)
      .join("\n");

    // Combine system message with tool guidelines
    const systemContent = [
      systemMessage?.content || "",
      toolInstructions ? `\n## Tool Guidelines\n${toolInstructions}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    // Use SystemMessage for better provider compatibility
    if (systemContent) {
      messages.push(new SystemMessage({ content: systemContent }));
    }

    // Extract L5 for original prompt
    const l5User = envelope.layers.find((l) => l.id === "L5_USER");
    const l5Text = l5User?.text || "";
    const originalUserPrompt = l5Text || userMessage.originalMessage || userMessage.message;

    // Insert L4 (chat history) between system and user
    const tempMessages: { role: string; content: string | MessageContent[] }[] = [];
    await loadAndAddChatHistory(memory, tempMessages);
    for (const msg of tempMessages) {
      if (msg.role === "user") {
        messages.push(new HumanMessage(msg.content));
      } else {
        messages.push(new AIMessage(msg.content));
      }
    }

    // Extract user content (L3 smart references + L5) from base messages
    const userMessageContent = baseMessages.find((m) => m.role === "user");
    if (userMessageContent) {
      const isMultimodal = this.isMultimodalModel(chatModel);
      const content: string | MessageContent[] = isMultimodal
        ? await this.buildMessageContent(userMessageContent.content, userMessage)
        : userMessageContent.content;
      messages.push(new HumanMessage(content));
    }

    return {
      messages,
      collectedSources: [],
      originalUserPrompt,
      loopDeps,
    };
  }

  /**
   * ReAct loop for native tool calling.
   * Follows the pattern: Reasoning → Acting → Observation → Iteration
   */
  private async runReActLoop(params: ReActLoopParams): Promise<ReActLoopResult> {
    const {
      boundModel,
      tools,
      messages,
      originalPrompt,
      abortController,
      updateCurrentAiMessage,
      processLocalSearchResult,
      applyCiCOrderingToLocalSearchResult,
    } = params;

    const maxIterations = getSettings().autonomousAgentMaxIterations;
    const collectedSources: AgentSource[] = [];
    const loopStartTime = Date.now();

    let iteration = 0;
    let responseMetadata: ResponseMetadata | undefined;

    while (iteration < maxIterations) {
      if (abortController.signal.aborted) break;

      // Check for loop timeout (5 minutes)
      const elapsedTime = Date.now() - loopStartTime;
      if (elapsedTime >= AGENT_LOOP_TIMEOUT_MS) {
        logWarn(`Agent loop timed out after ${Math.round(elapsedTime / 1000)}s`);
        break;
      }
      iteration++;

      // Stream response - streamModelResponse updates this.accumulatedContent
      // The timer will pick up content changes and display them with the reasoning block
      // Once final response is detected, timer stops and direct updates take over
      const { content, aiMessage, streamingResult } = await this.streamModelResponse(
        boundModel,
        messages,
        abortController,
        updateCurrentAiMessage
      );

      responseMetadata = {
        wasTruncated: streamingResult.wasTruncated,
        tokenUsage: streamingResult.tokenUsage ?? undefined,
      };

      // Check for native tool calls
      const toolCalls = aiMessage.tool_calls || [];

      // No tool calls = final response
      if (toolCalls.length === 0) {
        // Stop reasoning timer and finalize the reasoning block
        this.stopReasoningTimer();
        this.reasoningState.status = "complete";

        messages.push(aiMessage);

        // Final response is ONLY this iteration's content, not accumulated intermediate content
        const finalContent = content;
        const reasoningBlock = this.buildReasoningBlockMarkup();

        // Stream the final response progressively for better UX
        // Since we already have the full content, we'll display it in chunks
        const STREAM_CHUNK_SIZE = 20; // Characters per chunk
        const STREAM_DELAY_MS = 5; // Milliseconds between chunks
        let displayedContent = "";

        for (let i = 0; i < finalContent.length; i += STREAM_CHUNK_SIZE) {
          if (abortController.signal.aborted) break;
          displayedContent += finalContent.slice(i, i + STREAM_CHUNK_SIZE);
          const currentResponse = reasoningBlock
            ? reasoningBlock + "\n\n" + displayedContent
            : displayedContent;
          updateCurrentAiMessage(currentResponse);
          if (i + STREAM_CHUNK_SIZE < finalContent.length) {
            await new Promise((resolve) => setTimeout(resolve, STREAM_DELAY_MS));
          }
        }

        // Final update with complete content
        const finalResponse = reasoningBlock
          ? reasoningBlock + "\n\n" + finalContent
          : finalContent;
        updateCurrentAiMessage(finalResponse);

        return {
          finalResponse,
          sources: collectedSources,
          responseMetadata,
        };
      }

      // Add AI message with tool calls - but DON'T accumulate intermediate content
      // Intermediate content (like "I'll search for..." ) should not appear in final response
      messages.push(aiMessage);

      // For iterations > 1, the model's content often contains its summary of findings
      // from previous tool calls. Extract first sentence as a "finding summary".
      // (Iteration 1 has no previous findings - its content is just "I'll search for...")
      if (iteration > 1 && content && content.trim().length > 0) {
        const findingSummary = extractFirstSentence(content);
        if (findingSummary) {
          this.addReasoningStep(findingSummary);
        }
      }

      // Execute each tool
      for (const tc of toolCalls) {
        if (abortController.signal.aborted) break;

        const toolCall = {
          name: tc.name,
          args: tc.args as Record<string, unknown>,
        };

        // Pre-expand query for localSearch to show expanded terms BEFORE search
        let preExpandedTerms: QueryExpansionInfo | undefined;
        if (tc.name === "localSearch") {
          const query = toolCall.args.query as string | undefined;
          if (query) {
            try {
              const expander = new QueryExpander({
                getChatModel: async () => {
                  return this.chainManager.chatModelManager.getChatModel();
                },
              });
              const expansion = await expander.expand(query);
              // Compute recall terms (all terms used for search)
              const seen = new Set<string>();
              const recallTerms: string[] = [];
              const addTerm = (term: unknown) => {
                if (typeof term !== "string") return;
                const trimmed = term.trim();
                // Filter out invalid terms like "[object Object]"
                if (!trimmed || trimmed === "[object Object]" || trimmed.startsWith("[object "))
                  return;
                const normalized = trimmed.toLowerCase();
                if (!seen.has(normalized)) {
                  seen.add(normalized);
                  recallTerms.push(trimmed);
                }
              };
              if (expansion.originalQuery) addTerm(expansion.originalQuery);
              (expansion.salientTerms || []).forEach(addTerm);
              (expansion.expandedQueries || []).forEach(addTerm);
              (expansion.expandedTerms || []).forEach(addTerm);

              preExpandedTerms = {
                originalQuery: expansion.originalQuery,
                salientTerms: expansion.salientTerms,
                expandedQueries: expansion.expandedQueries,
                expandedTerms: expansion.expandedTerms,
                recallTerms,
              };
            } catch {
              // Ignore expansion errors, fall back to basic summary
            }
          }
        }

        // Add tool call step (shown in both rolling display and expanded view)
        const toolCallSummary = summarizeToolCall(tc.name, toolCall.args, preExpandedTerms);
        this.addReasoningStep(toolCallSummary, tc.name);

        // Inject pre-expanded query data into args to avoid double expansion in search
        if (preExpandedTerms) {
          toolCall.args._preExpandedQuery = preExpandedTerms;
        }

        logToolCall(toolCall, iteration);

        // Execute the tool
        const result = await executeSequentialToolCall(toolCall, tools, originalPrompt);

        // Track source info for reasoning summary
        let sourceInfo: LocalSearchSourceInfo | undefined;

        // Special handling for localSearch
        if (tc.name === "localSearch" && result.success) {
          const processed = processLocalSearchResult(result);
          collectedSources.push(...processed.sources);

          // Extract source info for reasoning summary (just count and titles, no terms needed)
          sourceInfo = {
            titles: processed.sources.map((s) => s.title),
            count: processed.sources.length,
          };

          result.result = applyCiCOrderingToLocalSearchResult(
            processed.formattedForLLM,
            originalPrompt || ""
          );
        }

        logToolResult(tc.name, result);

        // Add tool result step (shown in rolling display - this is the "what was found")
        const resultSummary = summarizeToolResult(tc.name, result, sourceInfo, toolCall.args);
        this.addReasoningStep(resultSummary, tc.name);

        // Add ToolMessage to conversation
        const toolMessage = createToolResultMessage(
          tc.id || generateToolCallId(),
          tc.name,
          result.result
        );
        messages.push(toolMessage);
      }
    }

    // Stop reasoning timer
    this.stopReasoningTimer();
    this.reasoningState.status = "complete";
    const reasoningBlock = this.buildReasoningBlockMarkup();

    // Check if interrupted by user vs max iterations reached
    if (abortController.signal.aborted) {
      logInfo("Agent reasoning interrupted by user");
      // If timer already handled the abort and showed the message, return empty to avoid duplicate
      if (this.abortHandledByTimer) {
        return {
          finalResponse: "",
          sources: collectedSources,
          responseMetadata,
        };
      }
      const interruptedMessage = "The response was interrupted.";
      const finalResponse = reasoningBlock
        ? reasoningBlock + "\n\n" + interruptedMessage
        : interruptedMessage;

      return {
        finalResponse,
        sources: collectedSources,
        responseMetadata,
      };
    }

    // Check if we exited due to timeout or max iterations
    const elapsedTime = Date.now() - loopStartTime;
    const timedOut = elapsedTime >= AGENT_LOOP_TIMEOUT_MS;

    if (timedOut) {
      logWarn(`Agent loop timed out after ${Math.round(elapsedTime / 1000)}s`);
    } else {
      logWarn(`Agent reached max iterations (${maxIterations})`);
    }

    const limitMessage = timedOut
      ? "I've reached the time limit for reasoning. Here's what I found so far based on the search results."
      : "I've reached the maximum number of tool calls. Here's what I found so far based on the search results.";
    const finalResponse = reasoningBlock ? reasoningBlock + "\n\n" + limitMessage : limitMessage;

    return {
      finalResponse,
      sources: collectedSources,
      responseMetadata,
    };
  }

  /**
   * Stream response from the bound model and accumulate tool call chunks.
   * Does NOT stop the timer - that's handled by runReActLoop when it determines
   * this is the final response (no tool calls).
   */
  private async streamModelResponse(
    boundModel: Runnable,
    messages: BaseMessage[],
    abortController: AbortController,
    _updateCurrentAiMessage: (message: string) => void
  ): Promise<{ content: string; aiMessage: AIMessage; streamingResult: StreamingResult }> {
    let fullContent = "";
    const toolCallChunks: Map<number, ToolCallChunk> = new Map();

    // Helper to handle content updates - don't detect final response here,
    // let runReActLoop decide based on whether there are tool calls
    const handleContentUpdate = (newContent: string) => {
      fullContent += newContent;
      // Don't update accumulatedContent for intermediate responses -
      // intermediate content should not be shown to the user
    };

    try {
      const stream = await withSuppressedTokenWarnings(() =>
        boundModel.stream(messages, {
          signal: abortController.signal,
        })
      );

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;

        // Check for MALFORMED_FUNCTION_CALL error - throw to trigger fallback
        const finishReason = chunk.response_metadata?.finish_reason;
        if (finishReason === "MALFORMED_FUNCTION_CALL") {
          logWarn("Backend returned MALFORMED_FUNCTION_CALL - falling back to non-agent mode");
          throw new Error("MALFORMED_FUNCTION_CALL: Model does not support native tool calling");
        }

        // Extract tool_call_chunks FIRST (before content check)
        const tcChunks = chunk.tool_call_chunks;
        if (tcChunks && Array.isArray(tcChunks)) {
          for (const tc of tcChunks) {
            const idx = tc.index ?? 0;
            const existing = toolCallChunks.get(idx) || { name: "", args: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.name) existing.name += tc.name;
            if (tc.args) existing.args += tc.args;
            toolCallChunks.set(idx, existing);
          }
        }

        // Extract content
        if (typeof chunk.content === "string") {
          handleContentUpdate(chunk.content);
        } else if (Array.isArray(chunk.content)) {
          for (const item of chunk.content) {
            if (item.type === "text" && item.text) {
              handleContentUpdate(item.text);
            }
          }
        }
      }

      // Build tool calls from accumulated chunks (with sanitization for empty objects)
      const toolCalls = buildToolCallsFromChunks(toolCallChunks);

      // Build AIMessage
      const aiMessage = new AIMessage({
        content: fullContent,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
          type: "tool_call" as const,
        })),
      });

      return {
        content: fullContent,
        aiMessage,
        streamingResult: {
          content: fullContent,
          wasTruncated: false,
          tokenUsage: null,
        },
      };
    } catch (error: any) {
      logError(`Stream error: ${error.message}`);
      if (error.name === "AbortError" || abortController.signal.aborted) {
        return {
          content: fullContent,
          aiMessage: new AIMessage({ content: fullContent }),
          streamingResult: { content: fullContent, wasTruncated: false, tokenUsage: null },
        };
      }
      throw error;
    }
  }
}
