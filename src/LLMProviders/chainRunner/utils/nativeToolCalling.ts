import { ToolMessage } from "@langchain/core/messages";
import { logError } from "@/logger";

export interface NativeToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallChunk {
  id?: string;
  name: string;
  args: string;
}

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

export function generateToolCallId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `call_${timestamp}_${random}`;
}

export interface RawToolCallChunk {
  index?: number;
  id?: string;
  name?: string;
  args?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

export function accumulateToolCallChunk(
  toolCallChunks: Map<number, ToolCallChunk>,
  rawChunk: RawToolCallChunk
): void {
  const idx = rawChunk.index ?? 0;
  const existing = toolCallChunks.get(idx) || { name: "", args: "" };
  if (rawChunk.id) existing.id = rawChunk.id;
  const chunkName = rawChunk.name ?? rawChunk.functionCall?.name;
  if (chunkName) existing.name += chunkName;
  if (rawChunk.args) existing.args += rawChunk.args;
  toolCallChunks.set(idx, existing);
}

export function buildToolCallsFromChunks(chunks: Map<number, ToolCallChunk>): NativeToolCall[] {
  const toolCalls: NativeToolCall[] = [];

  for (const chunk of chunks.values()) {
    if (!chunk.name) {
      continue;
    }

    let args: Record<string, unknown> = {};
    if (chunk.args) {
      try {
        args = JSON.parse(chunk.args);
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
