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
  const TOOL_TIMEOUT = 30000; // 30 seconds timeout per tool

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

    // Execute the tool with timeout
    const result = await Promise.race([
      ToolManager.callTool(tool, toolCall.args),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool execution timed out after ${TOOL_TIMEOUT}ms`)),
          TOOL_TIMEOUT
        )
      ),
    ]);

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
    pomodoroTool: "pomodoro timer",
    simpleYoutubeTranscriptionTool: "YouTube transcription",
    indexTool: "index",
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
    pomodoroTool: "⏱️",
    simpleYoutubeTranscriptionTool: "📺",
    indexTool: "📚",
  };

  return emojiMap[toolName] || "🔧";
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
 * Deduplicate sources by title, keeping highest score
 */
export function deduplicateSources(
  sources: { title: string; score: number }[]
): { title: string; score: number }[] {
  const uniqueSources = new Map<string, { title: string; score: number }>();

  for (const source of sources) {
    const existing = uniqueSources.get(source.title);
    if (!existing || source.score > existing.score) {
      uniqueSources.set(source.title, source);
    }
  }

  return Array.from(uniqueSources.values()).sort((a, b) => b.score - a.score);
}
