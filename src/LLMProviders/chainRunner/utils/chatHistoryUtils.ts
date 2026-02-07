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
export function addChatHistoryToMessages(
  rawHistory: any[],
  messages: Array<{ role: string; content: any }>
): void {
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
 * Extract text content from potentially multimodal message content.
 * Replaces non-text content (images) with placeholder.
 */
function extractTextContent(content: any): string {
  if (typeof content === "string") {
    return content;
  } else if (Array.isArray(content)) {
    // Extract text from multimodal content, skip image_url payloads
    const textParts = content
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.text || "")
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
 * Tool output structure for size estimation
 */
export interface ToolOutput {
  tool: string;
  output: string | object;
}

/**
 * Estimates the size of formatted tool outputs without actually formatting them.
 * Used to include tool output size in compaction threshold calculations.
 *
 * Tool outputs are formatted as:
 * ```
 * # Additional context:
 *
 * <toolName>
 * {content}
 * </toolName>
 * ```
 *
 * @param toolOutputs - Array of tool outputs with tool name and output content
 * @returns Estimated character count of formatted tool outputs
 */
export function estimateToolOutputSize(toolOutputs: ToolOutput[]): number {
  if (toolOutputs.length === 0) return 0;

  // Estimate: "# Additional context:\n\n" prefix
  let size = "# Additional context:\n\n".length;

  for (let i = 0; i < toolOutputs.length; i++) {
    const output = toolOutputs[i];
    const content =
      typeof output.output === "string" ? output.output : JSON.stringify(output.output);
    // Format: <tool>\n{content}\n</tool>
    size += `<${output.tool}>\n`.length + content.length + `\n</${output.tool}>`.length;
    // Join separator: \n\n between outputs
    if (i < toolOutputs.length - 1) {
      size += 2;
    }
  }

  return size;
}

/**
 * Result of extracting conversation turns from processed history.
 */
export interface ExtractedTurns {
  /** Complete user-assistant turn pairs */
  turns: Array<{ user: string; assistant: string }>;
  /** Trailing user message without assistant response (e.g., after aborted generation) */
  trailingUserMessage: string | null;
}

/**
 * Extract conversation turns from processed chat history.
 * Handles both complete turn pairs and trailing unpaired user messages.
 * Scans sequentially for user→assistant pairs to handle histories that may
 * start with an assistant message (e.g., when BufferWindowMemory slices mid-conversation).
 *
 * @param processedHistory - Processed chat history messages
 * @returns Object with turns array and optional trailing user message
 */
export function extractConversationTurns(processedHistory: ProcessedMessage[]): ExtractedTurns {
  const turns: Array<{ user: string; assistant: string }> = [];
  let trailingUserMessage: string | null = null;

  // Scan sequentially for user→assistant pairs
  let i = 0;
  while (i < processedHistory.length) {
    const msg = processedHistory[i];

    if (msg?.role === "user") {
      // Found a user message, look for the following assistant message
      const nextMsg = processedHistory[i + 1];
      if (nextMsg?.role === "assistant") {
        turns.push({
          user: extractTextContent(msg.content),
          assistant: extractTextContent(nextMsg.content),
        });
        i += 2; // Skip both messages
      } else {
        // User message without following assistant (trailing or orphaned)
        // If this is the last message, it's a trailing user message
        if (i === processedHistory.length - 1) {
          trailingUserMessage = extractTextContent(msg.content);
        }
        i += 1;
      }
    } else {
      // Skip assistant messages that aren't paired with a preceding user message
      // (e.g., at the start of a window slice)
      i += 1;
    }
  }

  return { turns, trailingUserMessage };
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
  memory: any,
  messages: Array<{ role: string; content: any }>
): Promise<ProcessedMessage[]> {
  const memoryVariables = await memory.loadMemoryVariables({});
  const rawHistory = memoryVariables.history || [];

  if (!rawHistory.length) {
    return [];
  }

  const processedHistory = processRawChatHistory(rawHistory);

  // Add history messages directly (already compacted at save time)
  for (const msg of processedHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  return processedHistory;
}
