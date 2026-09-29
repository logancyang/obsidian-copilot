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

interface ParsedMessage {
  segments: Array<{
    type: "text" | "toolCall" | "error";
    content: string;
    toolCall?: ToolCallMarker;
    error?: ErrorMarker;
  }>;
}

const TOOL_RESULT_UI_MAX_LENGTH = 5000;
const TOOL_RESULT_OMITTED_THRESHOLD_MESSAGE = `Result omitted to keep the UI responsive (payload exceeded ${TOOL_RESULT_UI_MAX_LENGTH.toLocaleString()} characters).`;

function encodeResultForMarker(result: string): string {
  try {
    return `ENC:${encodeURIComponent(result)}`;
  } catch {
    return result;
  }
}

function decodeResultFromMarker(result: string | undefined): string | undefined {
  if (typeof result !== "string") return result;
  if (!result.startsWith("ENC:")) return result;
  try {
    return decodeURIComponent(result.slice(4));
  } catch {
    return result;
  }
}

function buildOmittedResultMessage(toolName: string): string {
  return `Tool '${toolName}' ${TOOL_RESULT_OMITTED_THRESHOLD_MESSAGE}`;
}

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
    if (match.index > lastIndex) {
      errorChunks.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

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

  if (lastIndex < text.length) {
    errorChunks.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  if (errorChunks.length === 0) {
    errorChunks.push({
      type: "text",
      content: text,
    });
  }

  return errorChunks;
}

export function parseToolCallMarkers(message: string, messageId?: string): ParsedMessage {
  const segments: ParsedMessage["segments"] = [];
  const toolCallRegex =
    /<!--TOOL_CALL_START:([^:]+):([^:]+):([^:]+):([^:]+):([^:]*):([^:]+)-->([\s\S]*?)<!--TOOL_CALL_END:\1:([\s\S]*?)-->/g;

  let lastIndex = 0;
  let match;

  while ((match = toolCallRegex.exec(message)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = message.slice(lastIndex, match.index);
      const parsedChunks = parseErrorChunks(textBefore, lastIndex, messageId);

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
