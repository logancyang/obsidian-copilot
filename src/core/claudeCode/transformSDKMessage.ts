/**
 * SDK Message Transformer
 *
 * Transforms SDK messages from the Claude Agent SDK into StreamChunks
 * for rendering in the UI.
 */

import {
  ContentBlock,
  ErrorChunk,
  isSDKAssistantMessage,
  isSDKPartialAssistantMessage,
  isSDKResultMessage,
  isSDKSystemMessage,
  isSDKUserMessage,
  isTextBlock,
  isThinkingBlock,
  isToolResultBlock,
  isToolUseBlock,
  SDKAssistantMessage,
  SDKCompactBoundaryMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  SessionInitChunk,
  StreamChunk,
  TextChunk,
  ThinkingChunk,
  ToolResultChunk,
  ToolUseChunk,
  UsageChunk,
} from "./types";

/**
 * Transform a system init message to SessionInitChunk
 *
 * @param message - The SDK system message
 * @yields SessionInitChunk
 */
function* transformSystemMessage(
  message: SDKSystemMessage | SDKCompactBoundaryMessage
): Generator<StreamChunk> {
  if (message.subtype === "init") {
    const initMessage = message as SDKSystemMessage;
    const chunk: SessionInitChunk = {
      type: "session_init",
      sessionId: initMessage.session_id,
      model: initMessage.model,
      tools: initMessage.tools,
      cwd: initMessage.cwd,
      permissionMode: initMessage.permissionMode,
    };
    yield chunk;
  }
  // compact_boundary messages are informational and don't produce chunks for the UI
}

/**
 * Transform content blocks from an assistant message
 *
 * @param blocks - Array of content blocks
 * @yields StreamChunk for each content block
 */
function* transformContentBlocks(blocks: ContentBlock[]): Generator<StreamChunk> {
  for (const block of blocks) {
    if (isTextBlock(block)) {
      const chunk: TextChunk = {
        type: "text",
        text: block.text,
        isPartial: false,
      };
      yield chunk;
    } else if (isThinkingBlock(block)) {
      const chunk: ThinkingChunk = {
        type: "thinking",
        thinking: block.thinking,
        isPartial: false,
      };
      yield chunk;
    } else if (isToolUseBlock(block)) {
      const chunk: ToolUseChunk = {
        type: "tool_use",
        toolUseId: block.id,
        toolName: block.name,
        input: block.input,
        isPartial: false,
      };
      yield chunk;
    } else if (isToolResultBlock(block)) {
      // Tool results appear in user messages (after tool execution)
      const chunk: ToolResultChunk = {
        type: "tool_result",
        toolUseId: block.tool_use_id,
        content: typeof block.content === "string" ? block.content : null,
        isError: block.is_error ?? false,
      };
      yield chunk;
    }
  }
}

/**
 * Transform an assistant message to StreamChunks
 *
 * @param message - The SDK assistant message
 * @yields StreamChunk for each content block
 */
function* transformAssistantMessage(message: SDKAssistantMessage): Generator<StreamChunk> {
  yield* transformContentBlocks(message.message.content);
}

/**
 * Transform a user message (containing tool results) to StreamChunks
 *
 * @param message - The SDK user message
 * @yields StreamChunk for tool results
 */
function* transformUserMessage(
  message: SDKUserMessage | SDKUserMessageReplay
): Generator<StreamChunk> {
  const content = message.message.content;

  // User messages can contain tool results (after tool execution)
  if (Array.isArray(content)) {
    yield* transformContentBlocks(content as ContentBlock[]);
  }
  // String content from user messages is not yielded as it's the user's input
}

/**
 * Transform a result message to UsageChunk
 *
 * @param message - The SDK result message
 * @yields UsageChunk with usage information
 */
function* transformResultMessage(message: SDKResultMessage): Generator<StreamChunk> {
  const chunk: UsageChunk = {
    type: "usage",
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens,
    },
    totalCostUsd: message.total_cost_usd,
    durationMs: message.duration_ms,
    numTurns: message.num_turns,
    isError: message.is_error,
  };

  // Include errors if present (for error result types)
  if (message.subtype !== "success" && "errors" in message) {
    chunk.errors = message.errors;
  }

  yield chunk;
}

/**
 * Transform a stream event (partial message) to StreamChunks
 *
 * @param message - The SDK partial assistant message
 * @yields StreamChunk for partial content
 */
function* transformStreamEvent(message: SDKPartialAssistantMessage): Generator<StreamChunk> {
  const event = message.event;

  // Handle different stream event types
  switch (event.type) {
    case "content_block_start":
      if (event.content_block) {
        const block = event.content_block;
        if (isTextBlock(block)) {
          const chunk: TextChunk = {
            type: "text",
            text: block.text,
            isPartial: true,
          };
          yield chunk;
        } else if (isThinkingBlock(block)) {
          const chunk: ThinkingChunk = {
            type: "thinking",
            thinking: block.thinking,
            isPartial: true,
          };
          yield chunk;
        } else if (isToolUseBlock(block)) {
          const chunk: ToolUseChunk = {
            type: "tool_use",
            toolUseId: block.id,
            toolName: block.name,
            input: block.input,
            isPartial: true,
          };
          yield chunk;
        }
      }
      break;

    case "content_block_delta":
      if (event.delta) {
        if (event.delta.type === "text_delta" && event.delta.text) {
          const chunk: TextChunk = {
            type: "text",
            text: event.delta.text,
            isPartial: true,
          };
          yield chunk;
        } else if (event.delta.type === "thinking_delta" && event.delta.thinking) {
          const chunk: ThinkingChunk = {
            type: "thinking",
            thinking: event.delta.thinking,
            isPartial: true,
          };
          yield chunk;
        } else if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
          // For tool use, we emit partial JSON updates
          // The UI should accumulate these until content_block_stop
          const chunk: ToolUseChunk = {
            type: "tool_use",
            toolUseId: "", // Will be filled by the block start
            toolName: "",
            input: { _partial: event.delta.partial_json },
            isPartial: true,
          };
          yield chunk;
        }
      }
      break;

    case "message_delta":
      // Message-level updates (stop_reason, usage) - usage handled in result
      if (event.usage) {
        const chunk: UsageChunk = {
          type: "usage",
          usage: event.usage,
        };
        yield chunk;
      }
      break;

    // content_block_stop and message_stop don't yield new chunks
    // They signal the end of streaming for a particular block/message
  }
}

/**
 * Transform an SDK message to StreamChunks
 *
 * This is the main entry point for transforming SDK messages.
 * It handles all message types and yields appropriate StreamChunks.
 *
 * @param message - The SDK message to transform
 * @yields StreamChunk for each piece of content in the message
 */
export function* transformSDKMessage(message: SDKMessage): Generator<StreamChunk> {
  try {
    if (isSDKSystemMessage(message)) {
      yield* transformSystemMessage(message);
    } else if (isSDKAssistantMessage(message)) {
      yield* transformAssistantMessage(message);
    } else if (isSDKUserMessage(message)) {
      yield* transformUserMessage(message);
    } else if (isSDKResultMessage(message)) {
      yield* transformResultMessage(message);
    } else if (isSDKPartialAssistantMessage(message)) {
      yield* transformStreamEvent(message);
    }
    // Unknown message types are silently ignored
  } catch (error) {
    // Yield an error chunk if transformation fails
    const errorChunk: ErrorChunk = {
      type: "error",
      message: error instanceof Error ? error.message : "Unknown transformation error",
      code: "TRANSFORM_ERROR",
    };
    yield errorChunk;
  }
}

/**
 * Transform multiple SDK messages to StreamChunks
 *
 * Convenience function for transforming an array of messages.
 *
 * @param messages - Array of SDK messages to transform
 * @yields StreamChunk for each piece of content across all messages
 */
export function* transformSDKMessages(messages: SDKMessage[]): Generator<StreamChunk> {
  for (const message of messages) {
    yield* transformSDKMessage(message);
  }
}

/**
 * Async generator for transforming SDK messages from an async iterable
 *
 * This is useful when consuming messages from the SDK's query function
 * which returns an AsyncGenerator.
 *
 * @param messages - Async iterable of SDK messages
 * @yields StreamChunk for each piece of content
 */
export async function* transformSDKMessagesAsync(
  messages: AsyncIterable<SDKMessage>
): AsyncGenerator<StreamChunk> {
  for await (const message of messages) {
    yield* transformSDKMessage(message);
  }
}
