import { logInfo, logWarn } from "@/logger";
import { v4 as uuidv4 } from "uuid";
import { createToolCallMarker, updateToolCallMarker } from "./toolCallParser";
import {
  CoordinatorToolCall,
  ExecHooks,
  ToolResult,
  ToolExecutionResult,
  executeToolCallsInParallel,
} from "./toolExecution";
import { getToolConfirmtionMessage, getToolDisplayName, getToolEmoji } from "./toolExecution";
import { emitToolSpan } from "./observability";
import { resolveParallelToolConfig } from "./parallelConfig";

export interface ParallelExecutionParams {
  toolCalls: { name: string; args: any; id?: string }[];
  iteration: number;
  iterationHistory: string[];
  currentIterationToolCallMessages: string[];
  updateCurrentAiMessage: (message: string) => void;
  originalUserPrompt?: string;
  collectedSources: {
    title: string;
    path: string;
    score: number;
    explanation?: any;
  }[];
  abortController: AbortController;
  availableTools: Array<{ name: string; isBackground?: boolean }>;
  getTemporaryToolCallId: (name: string, index: number) => string;
  processLocalSearchResult: (result: { result: string; success: boolean }) => {
    formattedForLLM: string;
    formattedForDisplay: string;
    sources: {
      title: string;
      path: string;
      score: number;
      explanation?: any;
    }[];
  };
}

export async function executeCoordinatorFlow(params: ParallelExecutionParams): Promise<{
  toolResults: ToolExecutionResult[];
  updatedMessages: string[];
}> {
  const {
    toolCalls,
    iteration,
    iterationHistory,
    currentIterationToolCallMessages,
    updateCurrentAiMessage,
    originalUserPrompt,
    collectedSources,
    abortController,
    availableTools,
    getTemporaryToolCallId,
    processLocalSearchResult,
  } = params;

  const toolsByName = new Map(availableTools.map((tool) => [tool.name, tool]));
  const toolResults: ToolExecutionResult[] = [];
  const toolResultsByIndex: Array<ToolExecutionResult | undefined> = [];
  const toolCallIdMap = new Map<number, string>();

  currentIterationToolCallMessages.splice(toolCalls.length);

  const coordinatorCalls: CoordinatorToolCall[] = toolCalls.map((toolCall, index) => {
    logInfo(`Coordinating tool call ${toolCall.name} at index ${index}`);
    const matchedTool = toolsByName.get(toolCall.name);
    const augmentedCall: CoordinatorToolCall = {
      ...toolCall,
      index,
      background: matchedTool?.isBackground ?? false,
    };

    if (!augmentedCall.background) {
      const toolEmoji = getToolEmoji(toolCall.name);
      const toolDisplayName = getToolDisplayName(toolCall.name);
      const confirmationMessage = (getToolConfirmtionMessage(toolCall.name) || "")
        .replace(/[:\r\n]/g, " ")
        .trim();
      const toolCallId = `${toolCall.name}-${uuidv4()}`;
      toolCallIdMap.set(index, toolCallId);

      const marker = createToolCallMarker(
        toolCallId,
        toolCall.name,
        toolDisplayName,
        toolEmoji,
        confirmationMessage,
        true,
        "",
        ""
      );

      const placeholderIndex = currentIterationToolCallMessages.findIndex((msg) =>
        msg.includes(getTemporaryToolCallId(toolCall.name, index))
      );

      if (placeholderIndex !== -1) {
        currentIterationToolCallMessages[placeholderIndex] = marker;
      } else {
        currentIterationToolCallMessages.push(marker);
        logWarn(
          "Created tool call marker for tool call that was not created during streaming",
          toolCall.name
        );
      }
    }

    return augmentedCall;
  });

  if (toolCallIdMap.size > 0) {
    const currentDisplay = [...iterationHistory, ...currentIterationToolCallMessages].join("\n\n");
    updateCurrentAiMessage(currentDisplay);
  }

  const { useParallel, concurrency } = resolveParallelToolConfig(toolCalls.length);
  const toolStartTimes = new Map<number, number>();
  const toolDurations = new Map<number, number>();

  const updateMarkerForResult = (index: number, executionResult: ToolExecutionResult) => {
    const toolCallId = toolCallIdMap.get(index);
    if (!toolCallId) {
      return;
    }

    const messageIndex = currentIterationToolCallMessages.findIndex((msg) =>
      msg.includes(toolCallId)
    );

    if (messageIndex === -1) {
      return;
    }

    currentIterationToolCallMessages[messageIndex] = updateToolCallMarker(
      currentIterationToolCallMessages[messageIndex],
      toolCallId,
      executionResult.displayResult ?? executionResult.result
    );

    const currentDisplay = [...iterationHistory, ...currentIterationToolCallMessages].join("\n\n");
    updateCurrentAiMessage(currentDisplay);
  };

  const hooks: ExecHooks = {
    onStart: (index, meta) => {
      if (abortController.signal.aborted) {
        return;
      }

      const call = coordinatorCalls[index];
      if (call) {
        toolStartTimes.set(index, Date.now());
        emitToolSpan({
          event: "tool.start",
          index,
          name: call.name,
          background: call.background,
          concurrency: useParallel ? concurrency : 1,
        });
      }

      const callId = toolCallIdMap.get(index);
      if (!callId) {
        return;
      }

      const messageIndex = currentIterationToolCallMessages.findIndex((msg) =>
        msg.includes(callId)
      );

      if (messageIndex !== -1) {
        const currentDisplay = [...iterationHistory, ...currentIterationToolCallMessages].join(
          "\n\n"
        );
        updateCurrentAiMessage(currentDisplay);
      }
    },
    onSettle: (index, result) => {
      if (abortController.signal.aborted) {
        return;
      }

      const call = coordinatorCalls[index];
      if (!call) {
        return;
      }

      const startedAt = toolStartTimes.get(index);
      if (typeof startedAt === "number") {
        toolStartTimes.delete(index);
        toolDurations.set(index, Date.now() - startedAt);
      }

      emitToolSpan({
        event: "tool.settle",
        index,
        name: call.name,
        status: result.status,
        durationMs: typeof startedAt === "number" ? Date.now() - startedAt : undefined,
        background: call.background,
        error: result.error,
      });

      const executionResult = mapToolResultToExecutionResult(
        call,
        result,
        collectedSources,
        processLocalSearchResult
      );
      toolResultsByIndex[index] = executionResult;
      logInfo(`${call.name} execution logged`, executionResult);

      if (!call.background && !abortController.signal.aborted) {
        updateMarkerForResult(index, executionResult);
      }
    },
  };

  try {
    await executeToolCallsInParallel(coordinatorCalls, {
      availableTools,
      originalUserMessage: originalUserPrompt,
      signal: abortController.signal,
      concurrency: useParallel ? concurrency : 1,
      hooks,
    });
  } catch (error: any) {
    if (error?.name === "AbortError" || abortController.signal.aborted) {
      throw error;
    }

    logWarn(
      "[parallel] executeToolCallsInParallel threw unexpectedly; proceeding with fallbacks",
      error
    );
  }

  coordinatorCalls.forEach((call) => {
    const targetIndex = call.index ?? 0;
    let executionResult = toolResultsByIndex[targetIndex];

    if (!executionResult) {
      const fallbackMessage = abortController.signal.aborted
        ? "Aborted"
        : "Tool call did not complete";
      executionResult = {
        toolName: call.name,
        result: fallbackMessage,
        success: false,
        displayResult: fallbackMessage,
      };

      if (!call.background) {
        updateMarkerForResult(targetIndex, executionResult);
      }
    }

    toolResults.push(executionResult);
  });

  if (toolDurations.size > 0) {
    const summary = Array.from(toolDurations.entries()).map(([idx, duration]) => ({
      index: idx,
      durationMs: duration,
    }));
    logInfo("[parallel] execution summary", {
      toolCount: toolCalls.length,
      concurrency: useParallel ? concurrency : 1,
      durations: summary,
    });
  }

  return {
    toolResults,
    updatedMessages: currentIterationToolCallMessages,
  };
}

function mapToolResultToExecutionResult(
  call: CoordinatorToolCall,
  result: ToolResult,
  collectedSources: {
    title: string;
    path: string;
    score: number;
    explanation?: any;
  }[],
  processLocalSearchResult: ParallelExecutionParams["processLocalSearchResult"]
): ToolExecutionResult {
  if (result.status === "ok") {
    const payload = result.payload;
    const normalized =
      typeof payload === "string" ? payload : payload === undefined ? "" : JSON.stringify(payload);

    if (call.name === "localSearch") {
      const processed = processLocalSearchResult({
        result: normalized,
        success: true,
      });
      collectedSources.push(...processed.sources);
      return {
        toolName: call.name,
        result: processed.formattedForLLM,
        displayResult: processed.formattedForDisplay,
        success: true,
      };
    }

    return {
      toolName: call.name,
      result: normalized,
      success: true,
      displayResult: result.displayResult ?? normalized,
    };
  }

  const errorMessage =
    result.error ||
    (typeof result.payload === "string"
      ? result.payload
      : result.payload !== undefined
        ? JSON.stringify(result.payload)
        : `Tool ${call.name} ${result.status}`);

  return {
    toolName: call.name,
    result: errorMessage,
    success: false,
    displayResult: result.displayResult ?? errorMessage,
  };
}
