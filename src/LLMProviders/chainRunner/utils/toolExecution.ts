import { logError, logInfo, logWarn } from "@/logger";
import { ToolManager } from "@/tools/toolManager";
import { err2String } from "@/utils";
import { ToolCall } from "./xmlParsing";

export interface ToolExecutionResult {
  toolName: string;
  result: string;
  success: boolean;
}

/**
 * Executes a single tool call with timeout and error handling
 */
export async function executeSequentialToolCall(
  toolCall: ToolCall,
  availableTools: any[]
): Promise<ToolExecutionResult> {
  const DEFAULT_TOOL_TIMEOUT = 30000; // 30 seconds timeout per tool

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
        result: `Error: Tool '${toolCall.name}' not found. Available tools: ${availableToolNames}`,
        success: false,
      };
    }

    // Determine timeout for this tool
    let timeout = DEFAULT_TOOL_TIMEOUT;
    if (typeof tool.timeoutMs === "number") {
      timeout = tool.timeoutMs;
    }

    let result;
    if (!timeout || timeout === Infinity) {
      // No timeout for this tool
      result = await ToolManager.callTool(tool, toolCall.args);
    } else {
      // Use timeout
      result = await Promise.race([
        ToolManager.callTool(tool, toolCall.args),
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

/**
 * Get display name for tool (user-friendly version)
 */
export function getToolDisplayName(toolName: string): string {
  const displayNameMap: Record<string, string> = {
    localSearch: "vault search",
    webSearch: "web search",
    getFileTree: "file tree",
    getCurrentTime: "current time",
    getTimeRangeMs: "time range",
    getTimeInfoByEpoch: "time info",
    startPomodoro: "pomodoro timer",
    pomodoroTool: "pomodoro timer",
    simpleYoutubeTranscriptionTool: "YouTube transcription",
    youtubeTranscription: "YouTube transcription",
    indexVault: "vault indexing",
    indexTool: "index",
    writeToFile: "file editor",
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
    startPomodoro: "⏱️",
    pomodoroTool: "⏱️",
    simpleYoutubeTranscriptionTool: "📺",
    youtubeTranscription: "📺",
    indexVault: "📚",
    indexTool: "📚",
    writeToFile: "✏️",
  };

  return emojiMap[toolName] || "🔧";
}

/**
 * Get user confirmation message for tool call
 */
export function getToolConfirmtionMessage(toolName: string): string | null {
  if (toolName == "writeToFile") {
    return "Please accept or reject the changes in the Preview UI";
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
  const displayName = getToolDisplayName(toolName);
  const emoji = getToolEmoji(toolName);
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

/**
 * Deduplicate sources by path, keeping highest score
 * If path is not available, falls back to title
 */
export function deduplicateSources(
  sources: { title: string; path: string; score: number }[]
): { title: string; path: string; score: number }[] {
  const uniqueSources = new Map<string, { title: string; path: string; score: number }>();

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
