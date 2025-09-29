import { logError, logInfo, logWarn } from "@/logger";
import { checkIsPlusUser } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { ToolManager } from "@/tools/toolManager";
import { err2String } from "@/utils";
import { clampConcurrency } from "./parallelConfig";
import { ToolCall } from "./xmlParsing";

export type ToolStatus = "ok" | "error" | "timeout" | "cancelled";

export interface ToolResult {
  index: number;
  name: string;
  status: ToolStatus;
  payload?: unknown;
  error?: string;
  displayResult?: string;
}

export interface ExecHooks {
  onStart?: (index: number, meta: { name: string; background?: boolean }) => void;
  onSettle?: (index: number, result: ToolResult) => void;
}

export interface ExecOptions {
  concurrency?: number;
  signal?: AbortSignal;
  hooks?: ExecHooks;
}

export interface ExecuteToolCallContext {
  availableTools: any[];
  originalUserMessage?: string;
  signal?: AbortSignal;
}

export interface CoordinatorToolCall extends ToolCall {
  index?: number;
  id?: string;
  background?: boolean;
  timeoutMs?: number;
}

export interface ToolExecutionResult {
  toolName: string;
  result: string;
  success: boolean;
  /**
   * Optional display-friendly version of the tool result for UI rendering.
   * When absent, fallback to `result` for display purposes.
   */
  displayResult?: string;
}

export function clampParallelToolConcurrency(value: number | undefined): number {
  return clampConcurrency(value);
}

function normalizeIndex(call: CoordinatorToolCall, fallback: number): number {
  return typeof call.index === "number" && call.index >= 0 ? call.index : fallback;
}

function createCancelledResult(
  call: CoordinatorToolCall,
  index: number,
  reason = "Aborted"
): ToolResult {
  return {
    index,
    name: call.name,
    status: "cancelled",
    error: reason,
  };
}

function createErrorResult(call: CoordinatorToolCall, index: number, error: unknown): ToolResult {
  return {
    index,
    name: call.name,
    status: "error",
    error: err2String(error),
  };
}

function mapSequentialToToolResult(
  call: CoordinatorToolCall,
  index: number,
  sequential: ToolExecutionResult
): ToolResult {
  if (sequential.success) {
    const mapped: ToolResult = {
      index,
      name: call.name,
      status: "ok",
      payload: sequential.result,
    };

    if (typeof sequential.displayResult === "string") {
      mapped.displayResult = sequential.displayResult;
    }

    return mapped;
  }

  const lowered = sequential.result.toLowerCase();
  if (lowered.includes("timed out")) {
    return {
      index,
      name: call.name,
      status: "timeout",
      error: sequential.result,
    };
  }

  if (lowered.includes("aborted")) {
    return {
      index,
      name: call.name,
      status: "cancelled",
      error: sequential.result,
    };
  }

  return {
    index,
    name: call.name,
    status: "error",
    error: sequential.result,
  };
}

/**
 * Executes a single tool call using the existing sequential pathway while returning
 * the coordinator-friendly ToolResult payload.
 */
export async function executeToolCall(
  toolCall: CoordinatorToolCall,
  context: ExecuteToolCallContext
): Promise<ToolResult> {
  const { availableTools, originalUserMessage, signal } = context;

  const index = normalizeIndex(toolCall, 0);

  if (signal?.aborted) {
    return createCancelledResult(toolCall, index);
  }

  try {
    const result = await executeSequentialToolCall(toolCall, availableTools, originalUserMessage);
    return mapSequentialToToolResult(toolCall, index, result);
  } catch (error) {
    return createErrorResult(toolCall, index, error);
  }
}

export interface ExecuteToolCallsContext extends ExecOptions {
  availableTools: any[];
  originalUserMessage?: string;
}

/**
 * Schedules tool calls with bounded parallelism while preserving input ordering.
 */
export async function executeToolCallsInParallel(
  toolCalls: CoordinatorToolCall[],
  context: ExecuteToolCallsContext
): Promise<ToolResult[]> {
  const { availableTools, originalUserMessage, hooks, signal } = context;
  const concurrency = clampConcurrency(context.concurrency);

  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
  }

  const normalizedCalls = toolCalls.map((call, idx) => ({
    ...call,
    index: normalizeIndex(call, idx),
  }));

  const indices = new Set<number>();
  for (const call of normalizedCalls) {
    const idx = call.index;
    if (typeof idx !== "number") {
      throw new Error("Tool call is missing a normalized index.");
    }

    if (indices.has(idx)) {
      throw new Error(`Duplicate index ${idx} found in tool calls.`);
    }

    indices.add(idx);
  }

  const indexToCall: CoordinatorToolCall[] = [];
  normalizedCalls.forEach((call) => {
    const targetIndex = call.index ?? 0;
    indexToCall[targetIndex] = call;
  });

  const maxIndex = indexToCall.reduce((acc, call, idx) => (call ? Math.max(acc, idx) : acc), 0);
  const resultSize = Math.max(maxIndex + 1, normalizedCalls.length);
  const results: ToolResult[] = new Array(resultSize);

  let next = 0;
  let inFlight = 0;
  let completed = false;
  let aborted = signal?.aborted ?? false;

  const singleCallContext: ExecuteToolCallContext = {
    availableTools,
    originalUserMessage,
    signal,
  };

  return await new Promise<ToolResult[]>((resolve) => {
    let abortCleanup: (() => void) | undefined;

    function markRemainingCancelled(): void {
      if (!aborted) {
        return;
      }

      indexToCall.forEach((call, idx) => {
        if (!call || results[idx]) {
          return;
        }

        const cancelled = createCancelledResult(call, idx, "Aborted");
        results[idx] = cancelled;
        hooks?.onSettle?.(idx, cancelled);
      });

      next = normalizedCalls.length;
    }

    const finalize = () => {
      if (completed) {
        return;
      }

      completed = true;

      if (aborted) {
        markRemainingCancelled();
      }

      abortCleanup?.();

      for (let i = 0; i < resultSize; i += 1) {
        if (results[i]) {
          continue;
        }

        const call = indexToCall[i];
        if (call) {
          const filled = aborted
            ? createCancelledResult(call, i, "Aborted")
            : createErrorResult(call, i, "Tool call did not complete");
          results[i] = filled;
          hooks?.onSettle?.(i, filled);
          continue;
        }

        const orphan: ToolResult = {
          index: i,
          name: "unknown",
          status: aborted ? "cancelled" : "error",
          error: aborted ? "Aborted" : "Missing tool call context",
        };
        results[i] = orphan;
        hooks?.onSettle?.(i, orphan);
      }

      resolve(results as ToolResult[]);
    };

    const settleIfDone = () => {
      if (completed) {
        return;
      }

      if (aborted || (next >= normalizedCalls.length && inFlight === 0)) {
        finalize();
      }
    };

    const startOne = (queueIndex: number) => {
      const call = normalizedCalls[queueIndex];
      const targetIndex = call.index ?? queueIndex;

      if (aborted) {
        if (!results[targetIndex]) {
          const cancelled = createCancelledResult(call, targetIndex);
          results[targetIndex] = cancelled;
          hooks?.onSettle?.(targetIndex, cancelled);
        }
        settleIfDone();
        return;
      }

      try {
        signal?.throwIfAborted?.();
      } catch {
        aborted = true;
        const cancelled = createCancelledResult(call, targetIndex);
        results[targetIndex] = cancelled;
        hooks?.onSettle?.(targetIndex, cancelled);
        markRemainingCancelled();
        settleIfDone();
        return;
      }

      hooks?.onStart?.(targetIndex, { name: call.name, background: call.background });
      inFlight += 1;

      executeToolCall(call, singleCallContext)
        .then((toolResult) => {
          if (aborted) {
            return;
          }

          results[targetIndex] = toolResult;
          hooks?.onSettle?.(targetIndex, toolResult);
        })
        .catch((error) => {
          if (aborted) {
            return;
          }

          const fallback = createErrorResult(call, targetIndex, error);
          results[targetIndex] = fallback;
          hooks?.onSettle?.(targetIndex, fallback);
        })
        .finally(() => {
          inFlight -= 1;
          pump();
        });
    };

    function pump(): void {
      if (completed) {
        return;
      }

      while (inFlight < concurrency && next < normalizedCalls.length) {
        startOne(next);
        next += 1;
      }

      settleIfDone();
    }

    if (signal) {
      const onAbort = () => {
        if (aborted) {
          return;
        }
        aborted = true;
        settleIfDone();
      };

      signal.addEventListener("abort", onAbort);
      abortCleanup = () => {
        signal.removeEventListener("abort", onAbort);
      };
    }

    pump();
  });
}

/**
 * Executes a single tool call with timeout and error handling
 */
export async function executeSequentialToolCall(
  toolCall: ToolCall,
  availableTools: any[],
  originalUserMessage?: string
): Promise<ToolExecutionResult> {
  const DEFAULT_TOOL_TIMEOUT = 60000; // 60 seconds timeout per tool

  try {
    // Validate tool call
    if (!toolCall || !toolCall.name) {
      return {
        toolName: toolCall?.name || "unknown",
        result: "Error: Invalid tool call - missing tool name",
        success: false,
      };
    }

    // Find the tool in the existing tool registry
    const tool = availableTools.find((t) => t.name === toolCall.name);

    if (!tool) {
      const availableToolNames = availableTools.map((t) => t.name).join(", ");
      return {
        toolName: toolCall.name,
        result: `Error: Tool '${toolCall.name}' not found. Available tools: ${availableToolNames}. Make sure you have the tool enabled in the Agent settings.`,
        success: false,
      };
    }

    // Check if tool requires Plus subscription
    if (tool.isPlusOnly) {
      const isPlusUser = await checkIsPlusUser();
      if (!isPlusUser) {
        return {
          toolName: toolCall.name,
          result: `Error: ${getToolDisplayName(toolCall.name)} requires a Copilot Plus subscription`,
          success: false,
        };
      }
    }

    // Prepare tool arguments
    const toolArgs = { ...toolCall.args };

    // If tool requires user message content and it's provided, inject it
    if (tool.requiresUserMessageContent && originalUserMessage) {
      toolArgs._userMessageContent = originalUserMessage;
    }

    // Determine timeout for this tool
    let timeout = DEFAULT_TOOL_TIMEOUT;
    if (typeof tool.timeoutMs === "number") {
      timeout = tool.timeoutMs;
    }

    let result;
    if (!timeout || timeout === Infinity) {
      // No timeout for this tool
      result = await ToolManager.callTool(tool, toolArgs);
    } else {
      // Use timeout
      result = await Promise.race([
        ToolManager.callTool(tool, toolArgs),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool execution timed out after ${timeout}ms`)),
            timeout
          )
        ),
      ]);
    }

    // Validate result
    if (result === null || result === undefined) {
      logWarn(`Tool ${toolCall.name} returned null/undefined result`);
      // Return empty JSON object instead of plain string for better compatibility
      return {
        toolName: toolCall.name,
        result: JSON.stringify({
          message: "Tool executed but returned no result",
          status: "empty",
        }),
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

/**
 * Get display name for tool (user-friendly version)
 */
export function getToolDisplayName(toolName: string): string {
  // Special handling for localSearch to show the actual search type being used
  if (toolName === "localSearch") {
    const settings = getSettings();
    return settings.enableSemanticSearchV3
      ? "vault search (semantic)"
      : "vault search (index-free)";
  }

  const displayNameMap: Record<string, string> = {
    webSearch: "web search",
    getFileTree: "file tree",
    getCurrentTime: "current time",
    getTimeRangeMs: "time range",
    getTimeInfoByEpoch: "time info",
    convertTimeBetweenTimezones: "timezone converter",
    startPomodoro: "pomodoro timer",
    pomodoroTool: "pomodoro timer",
    simpleYoutubeTranscriptionTool: "YouTube transcription",
    youtubeTranscription: "YouTube transcription",
    indexVault: "vault indexing",
    indexTool: "index",
    writeToFile: "file editor",
    replaceInFile: "file editor",
  };

  return displayNameMap[toolName] || toolName;
}

/**
 * Get emoji for tool display
 */
export function getToolEmoji(toolName: string): string {
  const emojiMap: Record<string, string> = {
    localSearch: "🔍",
    webSearch: "🌐",
    getFileTree: "📁",
    getCurrentTime: "🕒",
    getTimeRangeMs: "📅",
    getTimeInfoByEpoch: "🕰️",
    convertTimeBetweenTimezones: "🌍",
    startPomodoro: "⏱️",
    pomodoroTool: "⏱️",
    simpleYoutubeTranscriptionTool: "📺",
    youtubeTranscription: "📺",
    indexVault: "📚",
    indexTool: "📚",
    writeToFile: "✏️",
    replaceInFile: "🔄",
  };

  return emojiMap[toolName] || "🔧";
}

/**
 * Get user confirmation message for tool call
 */
export function getToolConfirmtionMessage(toolName: string, toolArgs?: any): string | null {
  if (toolName == "writeToFile" || toolName == "replaceInFile") {
    return "Accept / reject in the Preview";
  }

  // Display salient terms for lexical search
  if (toolName === "localSearch" && toolArgs?.salientTerms) {
    const settings = getSettings();
    // Only show salient terms for lexical search (index-free)
    if (!settings.enableSemanticSearchV3) {
      const terms = Array.isArray(toolArgs.salientTerms) ? toolArgs.salientTerms : [];
      if (terms.length > 0) {
        return `Terms: ${terms.slice(0, 3).join(", ")}${terms.length > 3 ? "..." : ""}`;
      }
    }
  }

  return null;
}

/**
 * Log tool call details for debugging
 */
export function logToolCall(toolCall: ToolCall, iteration: number): void {
  const displayName = getToolDisplayName(toolCall.name);
  const emoji = getToolEmoji(toolCall.name);

  // Create clean parameter display
  const paramDisplay =
    Object.keys(toolCall.args).length > 0
      ? JSON.stringify(toolCall.args, null, 2)
      : "(no parameters)";

  logInfo(`${emoji} [Iteration ${iteration}] ${displayName.toUpperCase()}`);
  logInfo(`Parameters:`, paramDisplay);
  logInfo("---");
}

/**
 * Log tool execution result
 */
export function logToolResult(toolName: string, result: ToolExecutionResult): void {
  // For localSearch we already emit a structured table elsewhere; avoid redundant logs entirely
  if (toolName === "localSearch") {
    return;
  }

  const displayName = getToolDisplayName(toolName);
  const emoji = getToolEmoji(toolName);
  const status = result.success ? "✅ SUCCESS" : "❌ FAILED";

  logInfo(`${emoji} ${displayName.toUpperCase()} RESULT: ${status}`);

  // Default: log abbreviated result for readability (cap at 300 chars)
  const maxLogLength = 300;
  const text = String(result.result ?? "");
  if (text.length > maxLogLength) {
    logInfo(
      `Result: ${text.substring(0, maxLogLength)}... (truncated, ${text.length} chars total)`
    );
  } else if (text.length > 0) {
    logInfo(`Result:`, text);
  }
}

/**
 * Deduplicate sources by path, keeping highest score
 * If path is not available, falls back to title
 */
export function deduplicateSources(
  sources: { title: string; path: string; score: number; explanation?: any }[]
): { title: string; path: string; score: number; explanation?: any }[] {
  const uniqueSources = new Map<
    string,
    { title: string; path: string; score: number; explanation?: any }
  >();

  for (const source of sources) {
    // Use path as the unique key, falling back to title if path is not available
    const key = source.path || source.title;
    const existing = uniqueSources.get(key);
    if (!existing || source.score > existing.score) {
      uniqueSources.set(key, source);
    }
  }

  return Array.from(uniqueSources.values()).sort((a, b) => b.score - a.score);
}
