/**
 * Native Tool Calling Utilities
 *
 * Utilities for extracting and handling LangChain native tool calls from AIMessage.
 * Replaces XML-based tool calling with structured tool_calls array.
 */

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { ToolCall as LangChainToolCall } from "@langchain/core/messages/tool";
import { logError } from "@/logger";

/**
 * Standardized tool call structure extracted from AIMessage
 */
export interface NativeToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Accumulated tool call chunk during streaming
 */
export interface ToolCallChunk {
  id?: string;
  name: string;
  args: string; // JSON string accumulated from chunks
}

/**
 * Recursively remove empty objects from tool arguments.
 * Some models (e.g., Ollama) return empty objects {} for optional fields,
 * which can fail Zod schema validation when the schema expects specific fields.
 *
 * @param obj - Object to sanitize
 * @returns Sanitized object with empty objects removed
 */
function sanitizeToolArgs(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      // Skip empty objects
      if (Object.keys(nested).length === 0) {
        continue;
      }
      // Recursively sanitize nested objects
      const sanitized = sanitizeToolArgs(nested);
      if (Object.keys(sanitized).length > 0) {
        result[key] = sanitized;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Extract native tool calls from an AIMessage.
 * Returns empty array if no tool calls present.
 *
 * @param message - AIMessage from LLM response
 * @returns Array of standardized tool calls
 */
export function extractNativeToolCalls(message: AIMessage): NativeToolCall[] {
  const toolCalls = message.tool_calls;

  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }

  return toolCalls.map((tc: LangChainToolCall) => ({
    id: tc.id || generateToolCallId(),
    name: tc.name,
    // Sanitize to remove empty objects that can fail schema validation
    args: sanitizeToolArgs((tc.args as Record<string, unknown>) || {}),
  }));
}

/**
 * Check if an AIMessage contains tool calls
 *
 * @param message - AIMessage to check
 * @returns true if message has tool calls
 */
export function hasToolCalls(message: AIMessage): boolean {
  return (message.tool_calls?.length ?? 0) > 0;
}

/**
 * Create a ToolMessage for returning tool execution results to the LLM.
 *
 * @param toolCallId - The ID from the original tool call
 * @param toolName - Name of the tool that was executed
 * @param result - String result from tool execution
 * @returns ToolMessage to add to conversation
 */
export function createToolResultMessage(
  toolCallId: string,
  toolName: string,
  result: string
): ToolMessage {
  return new ToolMessage({
    content: result,
    tool_call_id: toolCallId,
    name: toolName,
  });
}

/**
 * Generate a unique tool call ID for cases where the LLM doesn't provide one.
 * Format: call_<timestamp>_<random>
 */
export function generateToolCallId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `call_${timestamp}_${random}`;
}

/**
 * Build accumulated tool calls from streaming chunks.
 * Call this after streaming is complete to get final tool calls.
 *
 * @param chunks - Map of accumulated tool call chunks (index -> chunk)
 * @returns Array of parsed tool calls
 */
export function buildToolCallsFromChunks(chunks: Map<number, ToolCallChunk>): NativeToolCall[] {
  const toolCalls: NativeToolCall[] = [];

  for (const chunk of chunks.values()) {
    // Skip incomplete chunks (no name)
    if (!chunk.name) {
      continue;
    }

    let args: Record<string, unknown> = {};
    if (chunk.args) {
      try {
        args = JSON.parse(chunk.args);
        // Sanitize to remove empty objects that can fail schema validation
        args = sanitizeToolArgs(args);
      } catch {
        logError(`[ToolCall] Failed to parse args for tool "${chunk.name}": ${chunk.args}`);
        args = {};
      }
    }

    toolCalls.push({
      id: chunk.id || generateToolCallId(),
      name: chunk.name,
      args,
    });
  }

  return toolCalls;
}

/**
 * Create an AIMessage with tool calls for conversation history.
 * Used when we need to reconstruct the AIMessage after streaming.
 *
 * @param content - Text content of the message
 * @param toolCalls - Tool calls to include
 * @returns AIMessage with tool_calls
 */
export function createAIMessageWithToolCalls(
  content: string,
  toolCalls: NativeToolCall[]
): AIMessage {
  return new AIMessage({
    content,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: tc.args,
      type: "tool_call" as const,
    })),
  });
}
