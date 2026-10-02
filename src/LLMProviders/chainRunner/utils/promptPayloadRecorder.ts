import { PromptContextEnvelope } from "@/context/PromptContextTypes";
import { logMarkdownBlock } from "@/logger";
import { ToolRegistry } from "@/tools/ToolRegistry";

interface PromptPayloadSnapshot {
  timestamp: string;
  modelName?: string;
  serializedMessages: string;
  messagesArray: unknown[];
  contextEnvelope?: PromptContextEnvelope;
}

let latestSnapshot: PromptPayloadSnapshot | null = null;

function safeSerialize(value: unknown): string {
  const seen = new WeakSet();

  return JSON.stringify(
    value,
    (key, val: unknown): unknown => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) {
          return "[Circular]";
        }
        seen.add(val);
      }

      if (typeof val === "bigint") {
        return val.toString();
      }

      return val;
    },
    2
  );
}

function buildLayeredViewFromMessages(
  messages: unknown[],
  envelope?: PromptContextEnvelope
): string {
  const lines: string[] = [];

  if (envelope) {
    lines.push(
      `msg:${envelope.messageId ?? "N/A"} | conv:${envelope.conversationId ?? "N/A"} | v${envelope.version}`
    );
    lines.push("");
  }

  const registry = ToolRegistry.getInstance();
  const registeredToolNames = new Set(registry.getAllTools().map((def) => def.tool.name));

  const detectTools = (content: string): { tool: string; preview: string }[] => {
    const tools: { tool: string; preview: string }[] = [];
    const toolPattern = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let match;

    while ((match = toolPattern.exec(content)) !== null) {
      const toolName = match[1];
      const toolContent = match[2];
      if (registeredToolNames.has(toolName)) {
        const preview =
          toolContent.length > 200
            ? toolContent.substring(0, 200).trim() + "...[truncated]"
            : toolContent.trim();
        tools.push({ tool: toolName, preview });
      }
    }
    return tools;
  };

  const getTextContent = (msg: { role?: unknown; content?: unknown }): string => {
    if (typeof msg.content === "string") {
      return msg.content;
    }
    if (Array.isArray(msg.content)) {
      const textParts: string[] = (msg.content as Array<{ type?: string; text?: string }>)
        .filter((item) => item.type === "text")
        .map((item): string => item.text ?? "");
      return textParts.join("\n");
    }
    return "";
  };

  const messageArray = Array.isArray(messages) ? messages : [];
  let historyCount = 0;

  for (let i = 0; i < messageArray.length; i++) {
    const msg = messageArray[i] as { role?: unknown; content?: unknown };
    const content = getTextContent(msg);

    if (msg.role === "system") {
      lines.push("━━━ SYSTEM MESSAGE ━━━");
      lines.push("");

      const l1 = envelope?.layers.find((l) => l.id === "L1_SYSTEM");
      const l2 = envelope?.layers.find((l) => l.id === "L2_PREVIOUS");

      if (l1 && content.includes(l1.text)) {
        const hashShort = l1.hash.substring(0, 8);
        lines.push(`🔒 L1_SYSTEM (${hashShort}) [CACHEABLE]`);
        const l1End = content.indexOf(l1.text) + l1.text.length;
        const preview =
          l1.text.length > 300 ? l1.text.substring(0, 300) + "...[truncated]" : l1.text;
        lines.push(preview);
        lines.push("");

        if (l2 && l2.text) {
          const hashShort = l2.hash.substring(0, 8);
          lines.push(`🔒 L2_PREVIOUS (${hashShort}) [CACHEABLE]`);
          const preview =
            l2.text.length > 300 ? l2.text.substring(0, 300) + "...[truncated]" : l2.text;
          lines.push(preview);
          lines.push("");
        }

        const remainingContent = content.substring(l1End);
        const tools = detectTools(remainingContent);
        if (tools.length > 0) {
          lines.push("--- PER-TURN ADDITIONS (not cached) ---");
          lines.push("");
          for (const tool of tools) {
            lines.push(`📦 TOOL: ${tool.tool} (turn-specific RAG)`);
            lines.push(tool.preview);
            lines.push("");
          }
        }
      } else {
        const tools = detectTools(content);
        if (tools.length > 0) {
          const firstToolMatch = content.match(/<(\w+)>/);
          if (firstToolMatch) {
            const beforeTools = content.substring(0, firstToolMatch.index);
            if (beforeTools.trim()) {
              const preview =
                beforeTools.length > 300
                  ? beforeTools.substring(0, 300) + "...[truncated]"
                  : beforeTools;
              lines.push(preview);
              lines.push("");
            }
          }

          lines.push("--- PER-TURN ADDITIONS (not cached) ---");
          lines.push("");
          for (const tool of tools) {
            lines.push(`📦 TOOL: ${tool.tool}`);
            lines.push(tool.preview);
            lines.push("");
          }
        } else {
          const preview =
            content.length > 300 ? content.substring(0, 300) + "...[truncated]" : content;
          lines.push(preview);
          lines.push("");
        }
      }
    } else if (msg.role === "user" || msg.role === "assistant") {
      if (i < messageArray.length - 1) {
        historyCount++;
      }
    }
  }

  if (historyCount > 0) {
    lines.push("━━━ CHAT HISTORY (L4) ━━━");
    lines.push("");
    lines.push(`${historyCount} message(s)`);
    lines.push("");
  }

  const lastMsg = messageArray[messageArray.length - 1] as
    | { role?: unknown; content?: unknown }
    | undefined;
  if (lastMsg && lastMsg.role === "user") {
    lines.push("━━━ USER MESSAGE ━━━");
    lines.push("");

    const content = getTextContent(lastMsg);

    const tools = detectTools(content);
    if (tools.length > 0) {
      lines.push("--- PER-TURN TOOL RESULTS ---");
      lines.push("");
      for (const tool of tools) {
        lines.push(`📦 TOOL: ${tool.tool}`);
        lines.push(tool.preview);
        lines.push("");
      }
    }

    const l3 = envelope?.layers.find((l) => l.id === "L3_TURN");
    const l5 = envelope?.layers.find((l) => l.id === "L5_USER");

    if (l3 && l3.text && content.includes(l3.text)) {
      const hashShort = l3.hash.substring(0, 8);
      lines.push(`⚡ L3_TURN (${hashShort})`);
      const preview = l3.text.length > 300 ? l3.text.substring(0, 300) + "...[truncated]" : l3.text;
      lines.push(preview);
      lines.push("");
    }

    if (l5 && l5.text && content.includes(l5.text)) {
      const hashShort = l5.hash.substring(0, 8);
      lines.push(`⚡ L5_USER (${hashShort})`);
      lines.push(l5.text);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function recordPromptPayload(params: {
  messages: unknown[];
  modelName?: string;
  contextEnvelope?: PromptContextEnvelope;
}): void {
  const { messages, modelName, contextEnvelope } = params;

  try {
    latestSnapshot = {
      timestamp: new Date().toISOString(),
      modelName,
      serializedMessages: safeSerialize(messages),
      messagesArray: messages,
      contextEnvelope,
    };
  } catch {
    latestSnapshot = {
      timestamp: new Date().toISOString(),
      modelName,
      serializedMessages: String(messages),
      messagesArray: messages,
      contextEnvelope,
    };
  }
}

export function clearRecordedPromptPayload(): void {
  latestSnapshot = null;
}

export async function flushRecordedPromptPayloadToLog(): Promise<void> {
  if (!latestSnapshot) {
    return;
  }

  const { timestamp, modelName, serializedMessages, messagesArray, contextEnvelope } =
    latestSnapshot;

  const lines = [
    `### Prompt — ${timestamp}${modelName ? ` — ${modelName}` : ""}`,
    "",
    "**Actual Messages Sent to LLM:**",
    "",
    "```json",
    serializedMessages,
    "```",
    "",
  ];

  const layeredView = buildLayeredViewFromMessages(messagesArray, contextEnvelope);
  lines.push("**Layered Context Metadata:**");
  lines.push("");
  lines.push("```");
  lines.push(layeredView);
  lines.push("```");
  lines.push("");

  logMarkdownBlock(lines);
  latestSnapshot = null;
}
