/**
 * Utility functions for safely processing chat history from LangChain memory
 */

import { logInfo } from "@/logger";

export interface ProcessedMessage {
  role: "user" | "assistant";
  content: string | unknown[]; // string or MessageContent[]
}

/**
 * Safely process raw history from LangChain memory, handling both BaseMessage
 * objects and legacy formats while preserving multimodal content
 *
 * @param rawHistory Array of messages from memory.loadMemoryVariables()
 * @returns Array of processed messages safe for LLM consumption
 */
export function processRawChatHistory(rawHistory: unknown[]): ProcessedMessage[] {
  const messages: ProcessedMessage[] = [];

  for (const message of rawHistory) {
    if (!message) continue;
    const msg = message as Record<string, unknown>;

    // BaseMessage exposes its role as `type`; legacy formats fall through below
    if (typeof msg.type === "string") {
      const messageType = msg.type;

      // Only process human and AI messages
      if (messageType === "human") {
        messages.push({ role: "user", content: msg.content as string | unknown[] });
      } else if (messageType === "ai") {
        messages.push({ role: "assistant", content: msg.content as string | unknown[] });
      }
      // Skip system messages and unknown types
    } else if (msg.content !== undefined) {
      // Fallback for other message formats - try to infer role
      const role = inferMessageRole(msg);
      if (role) {
        messages.push({ role, content: msg.content as string | unknown[] });
      }
    }
  }

  return messages;
}

/**
 * Try to infer the role from various message format properties
 * @returns 'user' | 'assistant' | null
 */
function inferMessageRole(message: Record<string, unknown>): "user" | "assistant" | null {
  // Check various properties that might indicate the role
  if (message.role === "human" || message.role === "user" || message.sender === "user") {
    return "user";
  } else if (message.role === "ai" || message.role === "assistant" || message.sender === "AI") {
    return "assistant";
  }

  // Can't determine role
  return null;
}

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

/**
 * Extract text content from potentially multimodal message content.
 * Replaces non-text content (images) with placeholder.
 */
function extractTextContent(content: string | unknown[]): string {
  if (typeof content === "string") {
    return content;
  } else if (Array.isArray(content)) {
    // Extract text from multimodal content, skip image_url payloads
    const textParts: string = content
      .filter(
        (item): item is { type: string; text?: string } =>
          typeof item === "object" && item !== null && (item as { type?: unknown }).type === "text"
      )
      .map((item): string => item.text || "")
      .join(" ");
    return textParts || "[Image content]";
  }
  return String(content || "");
}

/**
 * Convert processed messages to text-only format for question condensing
 * This extracts just the text content from potentially multimodal messages
 *
 * @param processedMessages Messages processed by processRawChatHistory
 * @returns Array of text-only chat history entries
 */
export function processedMessagesToTextOnly(
  processedMessages: ProcessedMessage[]
): ChatHistoryEntry[] {
  return processedMessages.map((msg) => ({
    role: msg.role,
    content: extractTextContent(msg.content),
  }));
}

/**
 * Load chat history from memory and add to messages array.
 * This is the single entry point for all chain runners to use.
 *
 * Note: Chat history is already compacted at save time (in MemoryManager.saveContext)
 * so tool results (localSearch, readNote, etc.) are stored as compact summaries.
 *
 * @param memory - LangChain memory instance
 * @param messages - Target messages array (system message should already be added)
 * @returns The processed history that was added
 */
export async function loadAndAddChatHistory(
  memory: {
    loadMemoryVariables: (vars: Record<string, unknown>) => Promise<{ history?: unknown[] }>;
  },
  messages: Array<{ role: string; content: string | unknown[] }>
): Promise<ProcessedMessage[]> {
  const memoryVariables = await memory.loadMemoryVariables({});
  const rawHistory = memoryVariables.history || [];

  const processedHistory = rawHistory.length ? processRawChatHistory(rawHistory) : [];

  // Add history messages directly (already compacted at save time)
  for (const msg of processedHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Log per-layer token estimates when payload is large (>3M chars ≈ 750k tokens).
  // Only use string .length (O(1)) — skip non-string content entirely.
  let systemChars = 0;
  for (const m of messages) {
    if (typeof m.content === "string" && m.role === "system") {
      systemChars += m.content.length;
    }
  }
  let historyChars = 0;
  for (const m of processedHistory) {
    if (typeof m.content === "string") {
      historyChars += m.content.length;
    }
  }
  const totalChars = systemChars + historyChars;
  // ~500k tokens — log when approaching context window limits to help diagnose overflow reports
  if (totalChars > 2_000_000) {
    logInfo("[Token Budget] Large payload detected (excluding user message):", {
      "L1+L2 (system)": `${Math.round(systemChars / 4000)}k tokens`,
      "L4 (history)": `${Math.round(historyChars / 4000)}k tokens (${processedHistory.length} msgs)`,
      total: `${Math.round(totalChars / 4000)}k tokens`,
    });
  }

  return processedHistory;
}
