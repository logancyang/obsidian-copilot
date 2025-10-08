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

const TOOL_RESULT_UI_MAX_LENGTH = 5000;
const TOOL_RESULT_OMITTED_THRESHOLD_MESSAGE = `Result omitted to keep the UI responsive (payload exceeded ${TOOL_RESULT_UI_MAX_LENGTH.toLocaleString()} characters).`;

/**
 * Safely encode tool result so it can be embedded inside an HTML comment
 * We use URI encoding with a prefix to avoid introducing `-->` in the payload
 */
function encodeResultForMarker(result: string): string {
  try {
    return `ENC:${encodeURIComponent(result)}`;
  } catch {
    // Fallback to original if encoding fails
    return result;
  }
}

/**
 * Decode tool result previously encoded for marker embedding
 */
export function decodeResultFromMarker(result: string | undefined): string | undefined {
  if (typeof result !== "string") return result;
  if (!result.startsWith("ENC:")) return result;
  try {
    return decodeURIComponent(result.slice(4));
  } catch {
    return result;
  }
}

/**
 * Build a short placeholder message when a tool payload is too large for the UI.
 *
 * @param toolName - Name of the tool that produced the payload.
 * @returns Placeholder string for banner rendering.
 */
function buildOmittedResultMessage(toolName: string): string {
  return `Tool '${toolName}' ${TOOL_RESULT_OMITTED_THRESHOLD_MESSAGE}`;
}

/**
 * For logging only: decode any encoded tool results embedded in markers
 */
export function decodeToolCallMarkerResults(message: string): string {
  if (!message || typeof message !== "string") return message;
  return message.replace(
    /<!--TOOL_CALL_END:([^:]+):(ENC:[\s\S]*?)-->/g,
    (_match, id: string, encoded: string) => {
      const decoded = decodeResultFromMarker(encoded) || encoded;
      return `<!--TOOL_CALL_END:${id}:${decoded}-->`;
    }
  );
}

/**
 * Ensure any TOOL_CALL_END results are encoded. Useful for sanitizing messages
 * that might contain unencoded results due to legacy or partial updates.
 */
export function ensureEncodedToolCallMarkerResults(message: string): string {
  if (!message || typeof message !== "string") return message;
  return message.replace(
    /<!--TOOL_CALL_END:([^:]+):([\s\S]*?)-->/g,
    (_match, id: string, content: string) => {
      if (content.startsWith("ENC:")) {
        return _match;
      }
      const safe = encodeResultForMarker(content);
      return `<!--TOOL_CALL_END:${id}:${safe}-->`;
    }
  );
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

    const rawResult = typeof result === "string" ? result : "";
    const decodedResult = decodeResultFromMarker(rawResult);
    const effectiveLength =
      typeof decodedResult === "string" ? decodedResult.length : rawResult.length;
    const shouldSuppressResult = effectiveLength > TOOL_RESULT_UI_MAX_LENGTH;
    const safeResult = shouldSuppressResult
      ? buildOmittedResultMessage(toolName)
      : (decodedResult ?? undefined);

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
        result: safeResult,
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
  const safeResult = result ? encodeResultForMarker(result) : result;
  return `<!--TOOL_CALL_START:${id}:${toolName}:${displayName}:${emoji}:${confirmationMessage}:${isExecuting}-->${content}<!--TOOL_CALL_END:${id}:${safeResult}-->`;
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
  const safeResult = encodeResultForMarker(result);
  return message.replace(regex, `$1false$2${safeResult}-->`);
}
