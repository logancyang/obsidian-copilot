import { logError, logWarn } from "@/logger";
import { getToolDisplayName } from "./toolExecution";

/**
 * Escapes special XML characters in a string to prevent XML injection
 * @param str - The string to escape
 * @returns The escaped string safe for XML content
 */
export function escapeXml(str: string): string {
  if (typeof str !== "string") {
    return "";
  }

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Escapes special XML characters for use in XML attributes
 * @param str - The string to escape for attribute use
 * @returns The escaped string safe for XML attributes
 */
export function escapeXmlAttribute(str: string): string {
  return escapeXml(str);
}

export interface ToolCall {
  name: string;
  args: any;
}

/**
 * Parses XML tool call blocks from AI responses using pure XML format
 * Format: <use_tool><name>toolName</name><param1>value1</param1><arrayParam><item>val1</item><item>val2</item></arrayParam></use_tool>
 */
export function parseXMLToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  try {
    const regex = /<use_tool>([\s\S]*?)<\/use_tool>/g;

    let match;
    while ((match = regex.exec(text)) !== null) {
      const content = match[1];
      const nameMatch = content.match(/<name>([\s\S]*?)<\/name>/);

      if (nameMatch) {
        const name = nameMatch[1].trim();

        // Validate tool name
        if (!name || name.length === 0) {
          logWarn("Skipping tool call with empty name");
          continue;
        }

        // Parse individual XML parameters using pure XML approach
        const args: any = {};

        // Remove the name tag from content to avoid matching it
        const contentWithoutName = content.replace(/<name>[\s\S]*?<\/name>/, "");

        // Find all parameter tags
        const paramRegex = /<([^>]+)>([\s\S]*?)<\/\1>/g;
        let paramMatch;

        while ((paramMatch = paramRegex.exec(contentWithoutName)) !== null) {
          const paramName = paramMatch[1].trim();
          const paramContent = paramMatch[2].trim();

          // Skip empty parameter names
          if (!paramName) continue;

          // Parse parameter content as pure XML
          args[paramName] = parseParameterContent(paramContent, paramName);
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
 * Parses parameter content using hybrid approach
 * - JSON arrays/objects: ["item1", "item2"] or {"key": "value"}
 * - Pure XML arrays: <item>value1</item><item>value2</item>
 * - Pure XML objects: <key1>value1</key1><key2>value2</key2>
 * - Simple strings: just the text value
 * - Empty content: returns appropriate empty value based on parameter name
 */
function parseParameterContent(content: string, parameterName?: string): any {
  if (!content) {
    // Special handling for known array parameters that should default to empty arrays
    if (parameterName === "chatHistory" || parameterName === "salientTerms") {
      return [];
    }
    return "";
  }

  // Check if content contains XML tags
  const hasXmlTags = /<[^>]+>/.test(content);

  if (!hasXmlTags) {
    // Try to parse as JSON if it looks like a JSON array/object
    if (
      (content.startsWith("[") && content.endsWith("]")) ||
      (content.startsWith("{") && content.endsWith("}"))
    ) {
      try {
        return JSON.parse(content);
      } catch {
        // If JSON parsing fails, use as string
        return content;
      }
    }
    // Simple string value
    return content;
  }

  // Check if it's an array format with <item> tags
  const itemMatches = content.match(/<item>([\s\S]*?)<\/item>/g);
  if (itemMatches) {
    return itemMatches.map((match) => {
      const itemContent = match.replace(/<\/?item>/g, "").trim();
      return parseParameterContent(itemContent); // Recursive for nested structures
    });
  }

  // Check if it's an object format with key-value pairs
  const objectRegex = /<([^>]+)>([\s\S]*?)<\/\1>/g;
  const objectEntries: [string, any][] = [];
  let objectMatch;

  while ((objectMatch = objectRegex.exec(content)) !== null) {
    const key = objectMatch[1].trim();
    const value = objectMatch[2].trim();
    objectEntries.push([key, parseParameterContent(value)]);
  }

  if (objectEntries.length > 0) {
    return Object.fromEntries(objectEntries);
  }

  // Fallback to string if we can't parse as structured data
  return content;
}

/**
 * Extracts tool name from a partial tool call block
 */
function extractToolNameFromPartialBlock(partialContent: string): string | null {
  const nameMatch = partialContent.match(/<name>([\s\S]*?)<\/name>/);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    return name || null;
  }
  return null;
}

/**
 * Strips XML tool call blocks, thinking blocks, and various code blocks from text.
 * @param text - The text to clean
 * @returns The cleaned text
 */
export function stripToolCallXML(text: string): string {
  let cleaned = text;

  // Remove all complete <use_tool>...</use_tool> blocks
  cleaned = cleaned.replace(/<use_tool>[\s\S]*?<\/use_tool>/g, "");

  // Replace partial tool calls with calling message
  cleaned = cleaned.replace(/<use_tool>([\s\S]*)$/g, (match, partialContent) => {
    const toolName = extractToolNameFromPartialBlock(partialContent);
    if (toolName) {
      const displayName = getToolDisplayName(toolName);
      return `Calling ${displayName}...`;
    } else {
      return `Calling tool...`;
    }
  });

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
