import { StructuredTool } from "@langchain/core/tools";
import { logError, logInfo, logWarn } from "@/logger";
import { checkIsPaidUser, isSelfHostModeValid } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { ToolManager } from "@/tools/toolManager";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { err2String } from "@/utils";

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface ToolExecutionResult {
  toolName: string;
  result: string;
  success: boolean;
  displayResult?: string;
}

export async function executeSequentialToolCall(
  toolCall: ToolCall,
  availableTools: Pick<StructuredTool, "name" | "invoke">[],
  originalUserMessage?: string
): Promise<ToolExecutionResult> {
  const DEFAULT_TOOL_TIMEOUT = 120000;

  try {
    if (!toolCall || !toolCall.name) {
      return {
        toolName: toolCall?.name || "unknown",
        result: "Error: Invalid tool call - missing tool name",
        success: false,
      };
    }

    const tool = availableTools.find((t) => t.name === toolCall.name);

    if (!tool) {
      const availableToolNames = availableTools.map((t): string => t.name).join(", ");
      return {
        toolName: toolCall.name,
        result: `Error: Tool '${toolCall.name}' not found. Available tools: ${availableToolNames}. Make sure you have the tool enabled in the Agent settings.`,
        success: false,
      };
    }

    const registry = ToolRegistry.getInstance();
    const metadata = registry.getToolMetadata(toolCall.name);

    if (metadata?.isPlusOnly) {
      const isPaidUser = await checkIsPaidUser(undefined, { trigger: "tool_call" });
      if (!isPaidUser && !isSelfHostModeValid()) {
        return {
          toolName: toolCall.name,
          result: `Error: ${getToolDisplayName(toolCall.name)} requires a Copilot Plus subscription`,
          success: false,
        };
      }
    }

    const toolArgs = { ...toolCall.args };

    if (metadata?.requiresUserMessageContent && originalUserMessage) {
      toolArgs._userMessageContent = originalUserMessage;
    }

    let timeout = DEFAULT_TOOL_TIMEOUT;
    if (typeof metadata?.timeoutMs === "number") {
      timeout = metadata.timeoutMs;
    }

    let result;
    if (!timeout || timeout === Infinity) {
      result = await ToolManager.callTool(tool, toolArgs);
    } else {
      result = await Promise.race([
        ToolManager.callTool(tool, toolArgs),
        new Promise((_, reject) =>
          window.setTimeout(
            () => reject(new Error(`Tool execution timed out after ${timeout}ms`)),
            timeout
          )
        ),
      ]);
    }

    if (result === null || result === undefined) {
      logWarn(`Tool ${toolCall.name} returned null/undefined result`);
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
    const errorMsg = err2String(error);
    const isSchemaError = errorMsg.includes("schema");
    if (isSchemaError) {
      logError(
        `[ToolCall] Schema validation failed for "${toolCall.name}". Args: ${JSON.stringify(toolCall.args, null, 2)}`
      );
    } else {
      logError(`[ToolCall] Error executing "${toolCall.name}": ${errorMsg}`);
    }
    return {
      toolName: toolCall.name,
      result: `Error: ${errorMsg}`,
      success: false,
    };
  }
}

function getToolDisplayName(toolName: string): string {
  if (toolName === "localSearch") {
    const settings = getSettings();
    return settings.enableMiyo ? "vault search (Miyo)" : "vault search (index-free)";
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
    youtubeTranscription: "YouTube transcription",
    writeFile: "file editor",
    editFile: "file editor",
    obsidianDailyNote: "daily note (CLI)",
    obsidianRandomRead: "random note (CLI)",
    obsidianProperties: "properties (CLI)",
    obsidianTasks: "tasks (CLI)",
    obsidianLinks: "links (CLI)",
    obsidianTemplates: "templates (CLI)",
    obsidianBases: "bases (CLI)",
  };

  return displayNameMap[toolName] || toolName;
}

function getToolEmoji(toolName: string): string {
  const emojiMap: Record<string, string> = {
    localSearch: "🔍",
    webSearch: "🌐",
    getFileTree: "📁",
    getCurrentTime: "🕒",
    getTimeRangeMs: "📅",
    getTimeInfoByEpoch: "🕰️",
    convertTimeBetweenTimezones: "🌍",
    youtubeTranscription: "📺",
    writeFile: "✏️",
    editFile: "🔄",
    readNote: "🔍",
    obsidianDailyNote: "📅",
    obsidianRandomRead: "🎲",
    obsidianProperties: "🏷️",
    obsidianTasks: "✅",
    obsidianLinks: "🔗",
    obsidianTemplates: "📄",
    obsidianBases: "🗄️",
  };

  return emojiMap[toolName] || "🔧";
}

export function logToolCall(toolCall: ToolCall, iteration: number): void {
  const displayName = getToolDisplayName(toolCall.name);
  const emoji = getToolEmoji(toolCall.name);

  const paramDisplay =
    Object.keys(toolCall.args).length > 0
      ? JSON.stringify(toolCall.args, null, 2)
      : "(no parameters)";

  logInfo(`${emoji} [Iteration ${iteration}] ${displayName.toUpperCase()}`);
  logInfo(`Parameters:`, paramDisplay);
  logInfo("---");
}

export function logToolResult(toolName: string, result: ToolExecutionResult): void {
  if (toolName === "localSearch") {
    return;
  }

  const displayName = getToolDisplayName(toolName);
  const emoji = getToolEmoji(toolName);
  const status = result.success ? "✅ SUCCESS" : "❌ FAILED";

  logInfo(`${emoji} ${displayName.toUpperCase()} RESULT: ${status}`);

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

export function deduplicateSources(
  sources: { title: string; path: string; score: number; explanation?: unknown }[]
): { title: string; path: string; score: number; explanation?: unknown }[] {
  const uniqueSources = new Map<
    string,
    { title: string; path: string; score: number; explanation?: unknown }
  >();

  for (const source of sources) {
    const key = source.path || source.title;
    const existing = uniqueSources.get(key);
    if (!existing || source.score > existing.score) {
      uniqueSources.set(key, source);
    }
  }

  return Array.from(uniqueSources.values()).sort((a, b) => b.score - a.score);
}
