import { AGENT_LOOP_TIMEOUT_MS } from "@/constants";
import { MessageContent } from "@/imageProcessing/imageProcessor";
import { logError, logInfo, logWarn } from "@/logger";
import { checkIsPaidUser } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { StructuredTool } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
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
  accumulateToolCallChunk,
  ToolCallChunk,
  type RawToolCallChunk,
} from "./utils/nativeToolCalling";

import { ensureCiCOrderingWithQuestion } from "./utils/cicPromptUtils";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import {
  AgentReasoningState,
  createInitialReasoningState,
  extractFirstSentence,
  LocalSearchSourceInfo,
  serializeReasoningBlock,
  summarizeToolCall,
  summarizeToolResult,
} from "./utils/AgentReasoningState";
import { findDuplicateQuery, stripLeakedRoleLines } from "./utils/queryDeduplication";

const AGENT_LOOP_GUIDANCE = `## Agent Behavior
- You have a limited number of tool calls. Use them wisely.
- NEVER search for the same or very similar query twice. If results were insufficient, try substantially different terms.
- After 1-2 searches, synthesize an answer from the results you have. Do not keep searching unless the results are clearly insufficient.
- If you have enough information to answer, respond directly without calling any more tools.`;

type AgentSource = {
  title: string;
  path: string;
  score: number;
  explanation?: unknown;
};

interface AgentLoopDeps {
  availableTools: StructuredTool[];
  boundModel: Runnable;
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
  messages: BaseMessage[];
  collectedSources: AgentSource[];
  originalUserPrompt: string;
  loopDeps: AgentLoopDeps;
}

interface ReActLoopParams {
  boundModel: Runnable;
  chatModel: Runnable;
  tools: StructuredTool[];
  messages: BaseMessage[];
  originalPrompt: string;
  abortController: AbortController;
  updateCurrentAiMessage: (message: string) => void;
  processLocalSearchResult: AgentLoopDeps["processLocalSearchResult"];
  applyCiCOrderingToLocalSearchResult: AgentLoopDeps["applyCiCOrderingToLocalSearchResult"];
  adapter: ModelAdapter;
}

interface ReActLoopResult {
  finalResponse: string;
  sources: AgentSource[];
  responseMetadata?: ResponseMetadata;
}

export class AutonomousAgentChainRunner extends CopilotPlusChainRunner {
  private llmFormattedMessages: string[] = [];
  private lastDisplayedContent = "";

  private reasoningState: AgentReasoningState = createInitialReasoningState();
  private reasoningTimerInterval: number | null = null;
  private accumulatedContent = "";
  private allReasoningSteps: Array<{ timestamp: number; summary: string; toolName?: string }> = [];
  private abortHandledByTimer = false;

  private getAvailableTools(): StructuredTool[] {
    const settings = getSettings();
    const registry = ToolRegistry.getInstance();

    if (registry.getAllTools().length === 0) {
      initializeBuiltinTools(this.chainManager.app);
    }

    const enabledToolIds = new Set(settings.autonomousAgentEnabledToolIds || []);

    return registry.getEnabledTools(enabledToolIds, !!this.chainManager.app?.vault);
  }

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
    this.allReasoningSteps = [];
    this.abortHandledByTimer = false;

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

    this.reasoningTimerInterval = window.setInterval(() => {
      if (abortController?.signal.aborted && this.reasoningState.status === "reasoning") {
        this.stopReasoningTimer();
        this.reasoningState.status = "complete";
        this.abortHandledByTimer = true;
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
        const reasoningBlock = this.buildReasoningBlockMarkup();
        const fullMessage = reasoningBlock
          ? reasoningBlock + (this.accumulatedContent ? "\n\n" + this.accumulatedContent : "")
          : this.accumulatedContent;
        updateFn(fullMessage);
      }
    }, 100);
  }

  private addReasoningStep(summary: string, toolName?: string): void {
    const step = {
      timestamp: Date.now(),
      summary,
      toolName,
    };
    this.allReasoningSteps.push(step);

    this.reasoningState.steps.push(step);
    if (this.reasoningState.steps.length > 4) {
      this.reasoningState.steps.shift();
    }
  }

  private stopReasoningTimer(): void {
    if (this.reasoningTimerInterval) {
      window.clearInterval(this.reasoningTimerInterval);
      this.reasoningTimerInterval = null;
    }
    this.reasoningState.status = "collapsed";
  }

  private buildReasoningBlockMarkup(): string {
    if (this.reasoningState.status === "complete" || this.reasoningState.status === "collapsed") {
      const stateWithFullHistory: AgentReasoningState = {
        ...this.reasoningState,
        steps: this.allReasoningSteps,
      };
      return serializeReasoningBlock(stateWithFullHistory);
    }
    return serializeReasoningBlock(this.reasoningState);
  }

  protected applyCiCOrderingToLocalSearchResult(
    localSearchPayload: string,
    originalPrompt: string
  ): string {
    return ensureCiCOrderingWithQuestion(localSearchPayload, originalPrompt);
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
    this.llmFormattedMessages = [];
    this.lastDisplayedContent = "";

    const isPaidUser = await checkIsPaidUser(this.chainManager.app, {
      trigger: "legacy_chat_turn",
      isAutonomousAgent: true,
    });

    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const adapter = ModelAdapterFactory.createAdapter(chatModel);
    const thinkStreamer = new ThinkBlockStreamer(updateCurrentAiMessage, true);

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

    const modelNameForLog = (chatModel as { modelName?: string } | undefined)?.modelName;

    const envelope = userMessage.contextEnvelope;
    if (!envelope) {
      throw new Error(
        "[Agent] Context envelope is required but not available. Cannot proceed with autonomous agent."
      );
    }

    logInfo("[Agent] Using native tool calling with ReAct pattern");

    const context = await this.prepareAgentConversation(userMessage, chatModel);

    try {
      this.startReasoningTimer(updateCurrentAiMessage, abortController);

      const loopResult = await this.runReActLoop({
        boundModel: context.loopDeps.boundModel,
        chatModel,
        tools: context.loopDeps.availableTools,
        messages: context.messages,
        originalPrompt: context.originalUserPrompt,
        abortController,
        updateCurrentAiMessage,
        processLocalSearchResult: context.loopDeps.processLocalSearchResult,
        applyCiCOrderingToLocalSearchResult: context.loopDeps.applyCiCOrderingToLocalSearchResult,
        adapter,
      });

      if (this.abortHandledByTimer) {
        this.lastDisplayedContent = "";
        return "";
      }

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
    } catch (error: unknown) {
      this.stopReasoningTimer();

      if ((error as { name?: string }).name === "AbortError" || abortController.signal.aborted) {
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

        await this.handleError(new Error(autonomousAgentErrorMsg + fallbackErrorMsg), (message) =>
          thinkStreamer.processErrorChunk(message)
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

  private async prepareAgentConversation(
    userMessage: ChatMessage,
    chatModel: BaseChatModel & {
      modelName?: string;
      model?: string;
      bindTools?: (tools: unknown[]) => unknown;
    }
  ): Promise<AgentRunContext> {
    const messages: BaseMessage[] = [];
    const availableTools = this.getAvailableTools();

    const modelName = chatModel.modelName || chatModel.model || "unknown";
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

    const envelope = userMessage.contextEnvelope!;

    const baseMessages = LayerToMessagesConverter.convert(envelope);

    const memory = this.chainManager.memoryManager.getMemory();

    const systemMessage = baseMessages.find((m) => m.role === "system");

    const registry = ToolRegistry.getInstance();
    const toolMetadata = availableTools
      .map((tool) => registry.getToolMetadata(tool.name))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);

    const toolInstructions = toolMetadata
      .filter((meta) => meta.customPromptInstructions)
      .map((meta) => `For ${meta.displayName}: ${meta.customPromptInstructions}`)
      .join("\n");

    const systemContent = [
      systemMessage?.content || "",
      toolInstructions ? `\n## Tool Guidelines\n${toolInstructions}` : "",
      AGENT_LOOP_GUIDANCE,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (systemContent) {
      messages.push(new SystemMessage({ content: systemContent }));
    }

    const l5User = envelope.layers.find((l) => l.id === "L5_USER");
    const l5Text = l5User?.text || "";
    const originalUserPrompt = l5Text || userMessage.originalMessage || userMessage.message;

    const tempMessages: { role: string; content: string | MessageContent[] }[] = [];
    await loadAndAddChatHistory(memory, tempMessages);
    for (const msg of tempMessages) {
      if (msg.role === "user") {
        messages.push(new HumanMessage(msg.content));
      } else {
        messages.push(new AIMessage(msg.content));
      }
    }

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

    const maxIterations = 32;
    const collectedSources: AgentSource[] = [];
    const loopStartTime = Date.now();

    const previousSearchQueries: string[] = [];
    let consecutiveAllSkipped = 0;
    let iteration = 0;
    let responseMetadata: ResponseMetadata | undefined;

    while (iteration < maxIterations) {
      if (abortController.signal.aborted) break;

      const elapsedTime = Date.now() - loopStartTime;
      if (elapsedTime >= AGENT_LOOP_TIMEOUT_MS) {
        logWarn(`Agent loop timed out after ${Math.round(elapsedTime / 1000)}s`);
        break;
      }
      iteration++;

      const { content, aiMessage, streamingResult } = await this.streamModelResponse(
        boundModel,
        messages,
        abortController
      );

      responseMetadata = {
        wasTruncated: streamingResult.wasTruncated,
        tokenUsage: streamingResult.tokenUsage ?? undefined,
      };

      const trimmedContent = content?.trim();
      logInfo(
        `[Agent] Iteration ${iteration} model output:`,
        trimmedContent ? trimmedContent.slice(0, 200) : "(empty)"
      );

      const toolCalls = aiMessage.tool_calls || [];
      logInfo(`[Agent] Iteration ${iteration}: ${toolCalls.length} tool call(s)`);

      if (toolCalls.length === 0) {
        logInfo(`[Agent] Iteration ${iteration}: Final response (no tool calls)`);
        this.stopReasoningTimer();
        this.reasoningState.status = "complete";

        messages.push(aiMessage);

        let finalContent = content;
        if (!finalContent || finalContent.trim() === "") {
          const rawToolCallChunks =
            (aiMessage as { tool_call_chunks?: unknown[] }).tool_call_chunks ?? [];
          logWarn(
            `[Agent] Empty response detected (iteration ${iteration}). ` +
              `Content length: ${content?.length ?? 0}, ` +
              `tool_call_chunks from model: ${rawToolCallChunks.length}, ` +
              `parsed tool_calls: ${toolCalls.length}. ` +
              `This may indicate tool calls were dropped or the model produced only thinking tokens.`
          );
          finalContent =
            "The model did not produce a response. Please try again or switch to a different model.";
        }
        const reasoningBlock = this.buildReasoningBlockMarkup();

        const STREAM_CHUNK_SIZE = 20;
        const STREAM_DELAY_MS = 5;
        let displayedContent = "";

        for (let i = 0; i < finalContent.length; i += STREAM_CHUNK_SIZE) {
          if (abortController.signal.aborted) break;
          displayedContent += finalContent.slice(i, i + STREAM_CHUNK_SIZE);
          const currentResponse = reasoningBlock
            ? reasoningBlock + "\n\n" + displayedContent
            : displayedContent;
          updateCurrentAiMessage(currentResponse);
          if (i + STREAM_CHUNK_SIZE < finalContent.length) {
            await new Promise((resolve) => window.setTimeout(resolve, STREAM_DELAY_MS));
          }
        }

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

      const cleanedContent = stripLeakedRoleLines(content);
      const intermediateMessage = new AIMessage({
        content: cleanedContent,
        tool_calls: aiMessage.tool_calls,
      });
      messages.push(intermediateMessage);

      if (iteration > 1 && cleanedContent && cleanedContent.trim().length > 0) {
        const findingSummary = extractFirstSentence(cleanedContent);
        if (findingSummary) {
          this.addReasoningStep(findingSummary);
        }
      }

      const uniqueToolCalls: typeof toolCalls = [];
      const batchQueries: string[] = [];
      const uniqueToolCallQueries: Array<string | null> = [];

      for (const tc of toolCalls) {
        if (tc.name === "localSearch") {
          const query = (tc.args as Record<string, unknown>)?.query as string | undefined;
          if (query) {
            const duplicate =
              findDuplicateQuery(query, previousSearchQueries) ??
              findDuplicateQuery(query, batchQueries);
            if (duplicate) {
              logInfo(`[Agent] Dedup: "${query}" (similar to: "${duplicate}")`);
              messages.push(
                createToolResultMessage(
                  tc.id || generateToolCallId(),
                  tc.name,
                  `You already searched for a similar query: "${duplicate}". Synthesize your answer from existing results.`
                )
              );
              continue;
            }
            batchQueries.push(query);
            uniqueToolCallQueries.push(query);
          } else {
            uniqueToolCallQueries.push(null);
          }
        } else {
          uniqueToolCallQueries.push(null);
        }
        uniqueToolCalls.push(tc);
      }

      for (let tcIdx = 0; tcIdx < uniqueToolCalls.length; tcIdx++) {
        const tc = uniqueToolCalls[tcIdx];
        if (abortController.signal.aborted) break;

        const toolCall = {
          name: tc.name,
          args: tc.args as Record<string, unknown>,
        };

        const toolCallSummary = summarizeToolCall(tc.name, toolCall.args);
        this.addReasoningStep(toolCallSummary, tc.name);

        logToolCall(toolCall, iteration);

        const result = await executeSequentialToolCall(toolCall, tools, originalPrompt);

        let sourceInfo: LocalSearchSourceInfo | undefined;

        if (tc.name === "localSearch" && result.success) {
          const processed = processLocalSearchResult(result);
          collectedSources.push(...processed.sources);

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

        if (tc.name === "localSearch" && result.success) {
          const executedQuery = uniqueToolCallQueries[tcIdx];
          if (executedQuery) {
            previousSearchQueries.push(executedQuery);
          }
        }

        const resultSummary = summarizeToolResult(tc.name, result, sourceInfo, toolCall.args);
        if (!result.success || sourceInfo) {
          this.addReasoningStep(resultSummary, tc.name);
        }

        const toolMessage = createToolResultMessage(
          tc.id || generateToolCallId(),
          tc.name,
          result.result
        );
        messages.push(toolMessage);
      }

      if (uniqueToolCalls.length === 0 && toolCalls.length > 0) {
        consecutiveAllSkipped++;
        logInfo(
          `[Agent] All ${toolCalls.length} tool call(s) skipped as duplicates ` +
            `(${consecutiveAllSkipped} consecutive)`
        );

        if (consecutiveAllSkipped >= 2) {
          logInfo("[Agent] Model stuck in search loop, forcing synthesis without tools");
          this.addReasoningStep("Synthesizing answer from search results");

          messages.push(
            new HumanMessage(
              "You have already searched and found relevant results. Do not call any tools. " +
                "Answer the following question now based ONLY on the search results above:\n\n" +
                originalPrompt
            )
          );

          const synthesis = await this.streamModelResponse(
            params.chatModel,
            messages,
            abortController
          );

          responseMetadata = {
            wasTruncated: synthesis.streamingResult.wasTruncated,
            tokenUsage: synthesis.streamingResult.tokenUsage ?? undefined,
          };

          this.stopReasoningTimer();
          this.reasoningState.status = "complete";
          const reasoningBlock = this.buildReasoningBlockMarkup();
          const finalContent =
            synthesis.content || "Unable to synthesize a response from the search results.";
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
      } else {
        consecutiveAllSkipped = 0;
      }
    }

    this.stopReasoningTimer();
    this.reasoningState.status = "complete";
    const reasoningBlock = this.buildReasoningBlockMarkup();

    if (abortController.signal.aborted) {
      logInfo("Agent reasoning interrupted by user");
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

  private async streamModelResponse(
    boundModel: Runnable,
    messages: BaseMessage[],
    abortController: AbortController
  ): Promise<{ content: string; aiMessage: AIMessage; streamingResult: StreamingResult }> {
    const toolCallChunks: Map<number, ToolCallChunk> = new Map();

    const thinkStreamer = new ThinkBlockStreamer(() => {}, true);

    let rawContent = "";

    try {
      const stream = await withSuppressedTokenWarnings(() =>
        boundModel.stream(messages, {
          signal: abortController.signal,
        })
      );

      for await (const rawChunk of stream) {
        if (abortController.signal.aborted) break;

        const chunk = rawChunk as {
          response_metadata?: { finish_reason?: string };
          tool_call_chunks?: unknown;
          content?: unknown;
        };

        const finishReason = chunk.response_metadata?.finish_reason;
        if (finishReason === "MALFORMED_FUNCTION_CALL") {
          logWarn("Backend returned MALFORMED_FUNCTION_CALL - falling back to non-agent mode");
          throw new Error("MALFORMED_FUNCTION_CALL: Model does not support native tool calling");
        }

        const tcChunks = chunk.tool_call_chunks;
        if (tcChunks && Array.isArray(tcChunks)) {
          for (const tc of tcChunks) {
            accumulateToolCallChunk(toolCallChunks, tc as RawToolCallChunk);
          }
        }

        const chunkContent = typeof chunk.content === "string" ? chunk.content : "";
        if (chunkContent) rawContent += chunkContent;

        thinkStreamer.processChunk(chunk as Parameters<typeof thinkStreamer.processChunk>[0]);
      }

      const streamingResult = thinkStreamer.close();
      const fullContent = streamingResult.content;

      const rawTrimmed = rawContent.trim();
      const strippedTrimmed = fullContent.trim();
      if (rawTrimmed && !strippedTrimmed) {
        logInfo(
          `[Agent] Model produced content that was entirely stripped (likely think blocks): ${rawTrimmed.slice(0, 300)}`
        );
      }

      const toolCalls = buildToolCallsFromChunks(toolCallChunks);

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
        streamingResult,
      };
    } catch (error: unknown) {
      logError(`Stream error: ${(error as Error).message}`);
      if ((error as { name?: string }).name === "AbortError" || abortController.signal.aborted) {
        const streamingResult = thinkStreamer.close();
        return {
          content: streamingResult.content,
          aiMessage: new AIMessage({ content: streamingResult.content }),
          streamingResult,
        };
      }
      throw error;
    }
  }
}
