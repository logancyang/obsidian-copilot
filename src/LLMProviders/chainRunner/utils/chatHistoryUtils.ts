/**
 * Utility functions for safely processing chat history from LangChain memory
 */

export interface ProcessedMessage {
  role: "user" | "assistant";
  content: any; // string or MessageContent[]
}

/**
 * Safely process raw history from LangChain memory, handling both BaseMessage
 * objects and legacy formats while preserving multimodal content
 *
 * @param rawHistory Array of messages from memory.loadMemoryVariables()
 * @returns Array of processed messages safe for LLM consumption
 */
export function processRawChatHistory(rawHistory: any[]): ProcessedMessage[] {
  const messages: ProcessedMessage[] = [];

  for (const message of rawHistory) {
    if (!message) continue;

    // Check if this is a BaseMessage with _getType method
    if (typeof message._getType === "function") {
      const messageType = message._getType();

      // Only process human and AI messages
      if (messageType === "human") {
        messages.push({ role: "user", content: message.content });
      } else if (messageType === "ai") {
        messages.push({ role: "assistant", content: message.content });
      }
      // Skip system messages and unknown types
    } else if (message.content !== undefined) {
      // Fallback for other message formats - try to infer role
      const role = inferMessageRole(message);
      if (role) {
        messages.push({ role, content: message.content });
      }
    }
  }

  return messages;
}

/**
 * Try to infer the role from various message format properties
 * @returns 'user' | 'assistant' | null
 */
function inferMessageRole(message: any): "user" | "assistant" | null {
  // Check various properties that might indicate the role
  if (message.role === "human" || message.role === "user" || message.sender === "user") {
    return "user";
  } else if (message.role === "ai" || message.role === "assistant" || message.sender === "AI") {
    return "assistant";
  }

  // Can't determine role
  return null;
}

/**
 * Add processed chat history to messages array for LLM consumption
 * This is a convenience function that combines processing and adding
 *
 * @param rawHistory Raw history from memory
 * @param messages Target messages array to add to
 */
export function addChatHistoryToMessages(rawHistory: any[], messages: any[]): void {
  const processedHistory = processRawChatHistory(rawHistory);
  for (const msg of processedHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }
}

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
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
  return processedMessages.map((msg) => {
    let textContent: string;

    if (typeof msg.content === "string") {
      textContent = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Extract text from multimodal content
      const textParts = msg.content
        .filter((item: any) => item.type === "text")
        .map((item: any) => item.text || "")
        .join(" ");
      textContent = textParts || "[Image content]";
    } else {
      textContent = String(msg.content || "");
    }

    return {
      role: msg.role,
      content: textContent,
    };
  });
}
