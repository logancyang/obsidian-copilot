import { logError, logWarn } from "@/logger";

export interface ToolCall {
  name: string;
  args: any;
}

/**
 * Parses XML tool call blocks from AI responses
 * Format: <use_tool><name>toolName</name><args>{...}</args></use_tool>
 */
export function parseXMLToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  try {
    const regex = /<use_tool>([\s\S]*?)<\/use_tool>/g;

    let match;
    while ((match = regex.exec(text)) !== null) {
      const content = match[1];
      const nameMatch = content.match(/<name>([\s\S]*?)<\/name>/);
      const argsMatch = content.match(/<args>([\s\S]*?)<\/args>/);

      if (nameMatch) {
        const name = nameMatch[1].trim();

        // Validate tool name
        if (!name || name.length === 0) {
          logWarn("Skipping tool call with empty name");
          continue;
        }

        let args = {};

        if (argsMatch) {
          try {
            const argsText = argsMatch[1].trim();
            if (argsText) {
              args = JSON.parse(argsText);
            }
          } catch (e) {
            logError("Failed to parse tool arguments:", e);
            // Use the raw string as args if JSON parsing fails
            args = { raw: argsMatch[1].trim() };
          }
        }

        toolCalls.push({ name, args });
      }
    }
  } catch (error) {
    logError("Error parsing XML tool calls:", error);
    // Return empty array if parsing fails completely
    return [];
  }

  return toolCalls;
}

/**
 * Extracts tool names from tool call blocks for display purposes
 */
function extractToolNamesFromXML(text: string): string[] {
  const toolNames: string[] = [];
  const regex = /<use_tool>([\s\S]*?)<\/use_tool>/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1];
    const nameMatch = content.match(/<name>([\s\S]*?)<\/name>/);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      if (name) {
        toolNames.push(name);
      }
    }
  }

  return toolNames;
}

/**
 * Maps tool names to display names for better user experience
 */
function getToolDisplayName(toolName: string): string {
  const displayNames: Record<string, string> = {
    localSearch: "vault search",
    webSearch: "web search",
    getFileTree: "file explorer",
    getCurrentTime: "time check",
    pomodoroTimer: "pomodoro timer",
    simpleYoutubeTranscription: "YouTube transcript",
    indexVault: "vault indexing",
  };
  return displayNames[toolName] || toolName;
}

/**
 * Strips XML tool call blocks, thinking blocks, and various code blocks from text.
 * @param text - The text to clean
 * @param options - Options for stripping behavior
 * @returns The cleaned text
 */
export function stripToolCallXML(
  text: string,
  options: { preserveToolIndicators?: boolean } = {}
): string {
  let cleaned = text;

  // Handle tool calls based on options
  if (options.preserveToolIndicators) {
    // Replace tool calls with visible indicators
    const toolNames = extractToolNamesFromXML(text);
    let toolIndex = 0;

    cleaned = cleaned.replace(/<use_tool>[\s\S]*?<\/use_tool>/g, () => {
      if (toolIndex < toolNames.length) {
        const toolName = toolNames[toolIndex];
        const displayName = getToolDisplayName(toolName);
        toolIndex++;
        return `\n[🔧 Tool call: ${displayName}]\n`;
      }
      return "";
    });
  } else {
    // Remove all <use_tool>...</use_tool> blocks completely
    cleaned = cleaned.replace(/<use_tool>[\s\S]*?<\/use_tool>/g, "");
  }

  // Keep thinking blocks in autonomous agent mode as they provide valuable context
  // They are only removed in other contexts where they add noise

  // Remove empty code blocks that might appear
  cleaned = cleaned.replace(/```\w*\s*```/g, "");

  // Remove tool_code blocks (both empty and with content)
  cleaned = cleaned.replace(/```tool_code[\s\S]*?```/g, "");

  // Remove any remaining empty code blocks with various languages
  cleaned = cleaned.replace(/```[\w]*[\s\n]*```/g, "");

  // Clean up excessive whitespace and trim
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, "\n\n").trim();

  return cleaned;
}
