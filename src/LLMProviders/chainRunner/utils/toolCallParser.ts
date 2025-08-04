export interface ToolCallMarker {
  id: string;
  toolName: string;
  displayName: string;
  emoji: string;
  confirmationMessage?: string;
  isExecuting: boolean;
  result?: string;
  startIndex: number;
  endIndex: number;
}

export interface ParsedMessage {
  segments: Array<{
    type: "text" | "toolCall";
    content: string;
    toolCall?: ToolCallMarker;
  }>;
}

/**
 * Parse tool call markers from a message
 * Format: <!--TOOL_CALL_START:id:toolName:displayName:emoji:confirmationMessage:isExecuting-->content<!--TOOL_CALL_END:id:result-->
 */
export function parseToolCallMarkers(message: string): ParsedMessage {
  const segments: ParsedMessage["segments"] = [];
  // Use [\s\S] instead of . with 's' flag for compatibility with ES6
  const toolCallRegex =
    /<!--TOOL_CALL_START:([^:]+):([^:]+):([^:]+):([^:]+):([^:]*):([^:]+)-->([\s\S]*?)<!--TOOL_CALL_END:\1:([\s\S]*?)-->/g;

  let lastIndex = 0;
  let match;

  while ((match = toolCallRegex.exec(message)) !== null) {
    // Add text before the tool call
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: message.slice(lastIndex, match.index),
      });
    }

    // Parse the tool call
    const [
      fullMatch,
      id,
      toolName,
      displayName,
      emoji,
      confirmationMessage,
      isExecuting,
      content,
      result,
    ] = match;

    segments.push({
      type: "toolCall",
      content: content,
      toolCall: {
        id,
        toolName,
        displayName,
        emoji,
        confirmationMessage: confirmationMessage || undefined,
        isExecuting: isExecuting === "true",
        result: result || undefined,
        startIndex: match.index,
        endIndex: match.index + fullMatch.length,
      },
    });

    lastIndex = match.index + fullMatch.length;
  }

  // Add any remaining text
  if (lastIndex < message.length) {
    segments.push({
      type: "text",
      content: message.slice(lastIndex),
    });
  }

  // If no tool calls found, return the entire message as text
  if (segments.length === 0) {
    segments.push({
      type: "text",
      content: message,
    });
  }

  return { segments };
}

/**
 * Create a tool call marker
 */
export function createToolCallMarker(
  id: string,
  toolName: string,
  displayName: string,
  emoji: string,
  confirmationMessage: string = "",
  isExecuting: boolean = true,
  content: string = "",
  result: string = ""
): string {
  return `<!--TOOL_CALL_START:${id}:${toolName}:${displayName}:${emoji}:${confirmationMessage}:${isExecuting}-->${content}<!--TOOL_CALL_END:${id}:${result}-->`;
}

/**
 * Update a tool call marker with result
 */
export function updateToolCallMarker(message: string, id: string, result: string): string {
  // Escape the id to prevent regex injection
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `(<!--TOOL_CALL_START:${escapedId}:[^:]+:[^:]+:[^:]+:[^:]*:)true(-->[\\s\\S]*?<!--TOOL_CALL_END:${escapedId}:)[\\s\\S]*?-->`,
    "g"
  );

  return message.replace(regex, `$1false$2${result}-->`);
}
