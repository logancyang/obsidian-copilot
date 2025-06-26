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
 * Strips XML tool call blocks and various code blocks from text
 */
export function stripToolCallXML(text: string): string {
  // Remove all <use_tool>...</use_tool> blocks
  let cleaned = text.replace(/<use_tool>[\s\S]*?<\/use_tool>/g, "");

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
