import { logInfo } from "@/logger";

export interface ProcessedMessage {
  role: "user" | "assistant";
  content: string | unknown[];
}

export function processRawChatHistory(rawHistory: unknown[]): ProcessedMessage[] {
  const messages: ProcessedMessage[] = [];

  for (const message of rawHistory) {
    if (!message) continue;
    const msg = message as Record<string, unknown>;

    if (typeof msg.type === "string") {
      const messageType = msg.type;

      if (messageType === "human") {
        messages.push({ role: "user", content: msg.content as string | unknown[] });
      } else if (messageType === "ai") {
        messages.push({ role: "assistant", content: msg.content as string | unknown[] });
      }
    } else if (msg.content !== undefined) {
      const role = inferMessageRole(msg);
      if (role) {
        messages.push({ role, content: msg.content as string | unknown[] });
      }
    }
  }

  return messages;
}

function inferMessageRole(message: Record<string, unknown>): "user" | "assistant" | null {
  if (message.role === "human" || message.role === "user" || message.sender === "user") {
    return "user";
  } else if (message.role === "ai" || message.role === "assistant" || message.sender === "AI") {
    return "assistant";
  }

  return null;
}

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

function extractTextContent(content: string | unknown[]): string {
  if (typeof content === "string") {
    return content;
  } else if (Array.isArray(content)) {
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

export function processedMessagesToTextOnly(
  processedMessages: ProcessedMessage[]
): ChatHistoryEntry[] {
  return processedMessages.map((msg) => ({
    role: msg.role,
    content: extractTextContent(msg.content),
  }));
}

export async function loadAndAddChatHistory(
  memory: {
    loadMemoryVariables: (vars: Record<string, unknown>) => Promise<{ history?: unknown[] }>;
  },
  messages: Array<{ role: string; content: string | unknown[] }>
): Promise<ProcessedMessage[]> {
  const memoryVariables = await memory.loadMemoryVariables({});
  const rawHistory = memoryVariables.history || [];

  const processedHistory = rawHistory.length ? processRawChatHistory(rawHistory) : [];

  for (const msg of processedHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

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
  if (totalChars > 2_000_000) {
    logInfo("[Token Budget] Large payload detected (excluding user message):", {
      "L1+L2 (system)": `${Math.round(systemChars / 4000)}k tokens`,
      "L4 (history)": `${Math.round(historyChars / 4000)}k tokens (${processedHistory.length} msgs)`,
      total: `${Math.round(totalChars / 4000)}k tokens`,
    });
  }

  return processedHistory;
}
