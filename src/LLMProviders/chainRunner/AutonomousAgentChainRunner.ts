import { ModelCapability } from "@/constants";
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
import { createToolResultMessage, generateToolCallId } from "./utils/nativeToolCalling";

import { ensureCiCOrderingWithQuestion } from "./utils/cicPromptUtils";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { buildAgentPromptDebugReport } from "./utils/promptDebugService";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import { PromptDebugReport } from "./utils/toolPromptDebugger";

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
   * Generate system prompt for the autonomous agent.
   * Note: Tool schemas are handled by bindTools(), so we only include
   * semantic guidance from tool metadata here.
   */
  public static async generateSystemPrompt(
    availableTools: StructuredTool[],
    adapter: ModelAdapter,
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
    const thinkStreamer = new ThinkBlockStreamer(updateCurrentAiMessage, adapter, excludeThinking);

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
   * @param updateLoadingMessage - Optional callback to show loading status.
   * @returns Context required for the ReAct agent loop.
   */
  private async prepareAgentConversation(
    userMessage: ChatMessage,
    chatModel: any,
    updateLoadingMessage?: (message: string) => void
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

    let iteration = 0;
    let responseMetadata: ResponseMetadata | undefined;
    let fullContent = "";

    while (iteration < maxIterations) {
      if (abortController.signal.aborted) break;
      iteration++;

      // Stream response from bound model
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
        messages.push(aiMessage);
        fullContent += content;
        return {
          finalResponse: fullContent,
          sources: collectedSources,
          responseMetadata,
        };
      }

      // Add AI message with tool calls
      messages.push(aiMessage);
      fullContent += content + "\n\n";
      updateCurrentAiMessage(fullContent);

      // Execute each tool
      for (const tc of toolCalls) {
        if (abortController.signal.aborted) break;

        const toolCall = {
          name: tc.name,
          args: tc.args as Record<string, unknown>,
        };

        logToolCall(toolCall, iteration);

        // Execute the tool
        const result = await executeSequentialToolCall(toolCall, tools, originalPrompt);

        // Special handling for localSearch
        if (tc.name === "localSearch" && result.success) {
          const processed = processLocalSearchResult(result);
          collectedSources.push(...processed.sources);
          result.result = applyCiCOrderingToLocalSearchResult(
            processed.formattedForLLM,
            originalPrompt || ""
          );
        }

        logToolResult(tc.name, result);

        // Add ToolMessage to conversation
        const toolMessage = createToolResultMessage(
          tc.id || generateToolCallId(),
          tc.name,
          result.result
        );
        messages.push(toolMessage);
      }
    }

    // Max iterations reached
    logWarn(`Agent reached max iterations (${maxIterations})`);
    return {
      finalResponse: fullContent + "\n\n(Reached max iterations)",
      sources: collectedSources,
      responseMetadata,
    };
  }

  /**
   * Stream response from the bound model and accumulate tool call chunks.
   */
  private async streamModelResponse(
    boundModel: Runnable,
    messages: BaseMessage[],
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void
  ): Promise<{ content: string; aiMessage: AIMessage; streamingResult: StreamingResult }> {
    let fullContent = "";
    const toolCallChunks: Map<number, { id?: string; name: string; args: string }> = new Map();

    try {
      const stream = await withSuppressedTokenWarnings(() =>
        boundModel.stream(messages, {
          signal: abortController.signal,
        })
      );

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;

        // Check for MALFORMED_FUNCTION_CALL error
        const finishReason = chunk.response_metadata?.finish_reason;
        if (finishReason === "MALFORMED_FUNCTION_CALL") {
          logWarn("Backend returned MALFORMED_FUNCTION_CALL - native tool calling not supported");
        }

        // Extract content
        if (typeof chunk.content === "string") {
          fullContent += chunk.content;
          updateCurrentAiMessage(fullContent);
        } else if (Array.isArray(chunk.content)) {
          for (const item of chunk.content) {
            if (item.type === "text" && item.text) {
              fullContent += item.text;
              updateCurrentAiMessage(fullContent);
            }
          }
        }

        // Extract tool_call_chunks (LangChain streaming format)
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
      }

      // Build tool calls from accumulated chunks
      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
      for (const chunk of toolCallChunks.values()) {
        if (!chunk.name) continue;
        let args: Record<string, unknown> = {};
        if (chunk.args) {
          try {
            args = JSON.parse(chunk.args);
          } catch {
            logWarn(`Failed to parse tool args: ${chunk.args}`);
          }
        }
        toolCalls.push({
          id: chunk.id || generateToolCallId(),
          name: chunk.name,
          args,
        });
      }

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
