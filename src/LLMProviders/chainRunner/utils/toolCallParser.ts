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

export interface ErrorMarker {
  id: string;
  errorContent: string;
  startIndex: number;
  endIndex: number;
}

export interface ParsedMessage {
  segments: Array<{
    type: "text" | "toolCall" | "error";
    content: string;
    toolCall?: ToolCallMarker;
    error?: ErrorMarker;
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
 * Parse error chunks from a text segment
 * Format: <errorChunk>error content</errorChunk>
 */
function parseErrorChunks(
  text: string,
  baseIndex: number = 0,
  messagePrefix: string = ""
): Array<{ type: "text" | "error"; content: string; error?: ErrorMarker }> {
  const errorChunks: Array<{ type: "text" | "error"; content: string; error?: ErrorMarker }> = [];
  const errorRegex = /<errorChunk>([\s\S]*?)<\/errorChunk>/g;

  let lastIndex = 0;
  let match;

  while ((match = errorRegex.exec(text)) !== null) {
    // Add text before the error chunk
    if (match.index > lastIndex) {
      errorChunks.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

    // Add the error chunk
    // Use position-based ID for stability across re-renders
    const [fullMatch, errorContent] = match;
    const startIndex = baseIndex + match.index;
    const errorId = messagePrefix ? `${messagePrefix}-error-${startIndex}` : `error-${startIndex}`;

    errorChunks.push({
      type: "error",
      content: errorContent,
      error: {
        id: errorId,
        errorContent: errorContent,
        startIndex: startIndex,
        endIndex: baseIndex + match.index + fullMatch.length,
      },
    });

    lastIndex = match.index + fullMatch.length;
  }

  // Add any remaining text
  if (lastIndex < text.length) {
    errorChunks.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  // If no error chunks found, return the entire text
  if (errorChunks.length === 0) {
    errorChunks.push({
      type: "text",
      content: text,
    });
  }

  return errorChunks;
}

/**
 * Parse tool call markers and error chunks from a message
 * Format: <!--TOOL_CALL_START:id:toolName:displayName:emoji:confirmationMessage:isExecuting-->content<!--TOOL_CALL_END:id:result-->
 * Error Format: <errorChunk>error content</errorChunk>
 * @param message - The message string to parse
 * @param messageId - Optional message ID to ensure error IDs are unique across messages
 */
export function parseToolCallMarkers(message: string, messageId?: string): ParsedMessage {
  const segments: ParsedMessage["segments"] = [];
  // Use [\s\S] instead of . with 's' flag for compatibility with ES6
  const toolCallRegex =
    /<!--TOOL_CALL_START:([^:]+):([^:]+):([^:]+):([^:]+):([^:]*):([^:]+)-->([\s\S]*?)<!--TOOL_CALL_END:\1:([\s\S]*?)-->/g;

  let lastIndex = 0;
  let match;

  while ((match = toolCallRegex.exec(message)) !== null) {
    // Add text before the tool call (and parse any error chunks in it)
    if (match.index > lastIndex) {
      const textBefore = message.slice(lastIndex, match.index);
      const parsedChunks = parseErrorChunks(textBefore, lastIndex, messageId);

      // Only add non-empty text segments
      parsedChunks.forEach((chunk) => {
        if (chunk.type === "text" && chunk.content.trim()) {
          segments.push({
            type: "text",
            content: chunk.content,
          });
        } else if (chunk.type === "error" && chunk.error) {
          segments.push({
            type: "error",
            content: chunk.content,
            error: chunk.error,
          });
        }
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

    // Decode the result and check if it's too large for UI display
    const rawResult = typeof result === "string" ? result : "";
    const decodedResult = decodeResultFromMarker(rawResult);
    const resultLength = typeof decodedResult === "string" ? decodedResult.length : 0;

    const safeResult =
      resultLength > TOOL_RESULT_UI_MAX_LENGTH
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

  // Add any remaining text (and parse any error chunks in it)
  if (lastIndex < message.length) {
    const remainingText = message.slice(lastIndex);
    const parsedChunks = parseErrorChunks(remainingText, lastIndex, messageId);

    parsedChunks.forEach((chunk) => {
      if (chunk.type === "text" && chunk.content.trim()) {
        segments.push({
          type: "text",
          content: chunk.content,
        });
      } else if (chunk.type === "error" && chunk.error) {
        segments.push({
          type: "error",
          content: chunk.content,
          error: chunk.error,
        });
      }
    });
  }

  // If no segments found, return the entire message as text (after checking for errors)
  if (segments.length === 0) {
    const parsedChunks = parseErrorChunks(message, 0, messageId);

    parsedChunks.forEach((chunk) => {
      if (chunk.type === "text") {
        segments.push({
          type: "text",
          content: chunk.content,
        });
      } else if (chunk.type === "error" && chunk.error) {
        segments.push({
          type: "error",
          content: chunk.content,
          error: chunk.error,
        });
      }
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
