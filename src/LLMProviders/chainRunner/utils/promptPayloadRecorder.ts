import { PromptContextEnvelope } from "@/context/PromptContextTypes";
import { logMarkdownBlock } from "@/logger";
import { ToolRegistry } from "@/tools/ToolRegistry";

interface PromptPayloadSnapshot {
  timestamp: string;
  modelName?: string;
  serializedMessages: string;
  messagesArray: unknown[]; // Store for intelligent analysis
  contextEnvelope?: PromptContextEnvelope;
}

let latestSnapshot: PromptPayloadSnapshot | null = null;

/**
 * Safely serialize the model conversation payload for logging while preserving readability.
 *
 * @param value - Messages array destined for the LLM.
 * @returns Pretty-printed JSON representation with circular references handled.
 */
function safeSerialize(value: unknown): string {
  const seen = new WeakSet();

  return JSON.stringify(
    value,
    (key, val) => {
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

/**
 * Intelligently builds a layered view from the actual messages array.
 * Detects tool injections, maps content to envelope layers, and shows structure.
 */
function buildLayeredViewFromMessages(
  messages: unknown[],
  envelope?: PromptContextEnvelope
): string {
  const lines: string[] = [];

  // Metadata line
  if (envelope) {
    lines.push(
      `msg:${envelope.messageId ?? "N/A"} | conv:${envelope.conversationId ?? "N/A"} | v${envelope.version}`
    );
    lines.push("");
  }

  // Get all registered tool names from the registry
  const registry = ToolRegistry.getInstance();
  const registeredToolNames = new Set(registry.getAllTools().map((def) => def.tool.name));

  // Helper to detect and extract tool markers
  const detectTools = (content: string): { tool: string; preview: string }[] => {
    const tools: { tool: string; preview: string }[] = [];
    const toolPattern = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let match;

    while ((match = toolPattern.exec(content)) !== null) {
      const toolName = match[1];
      const toolContent = match[2];
      // Check if this is a registered tool
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

  // Helper to extract text content from message
  const getTextContent = (msg: any): string => {
    if (typeof msg.content === "string") {
      return msg.content;
    }
    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((item: any) => item.type === "text")
        .map((item: any) => item.text);
      return textParts.join("\n");
    }
    return "";
  };

  // Process messages array
  const messageArray = Array.isArray(messages) ? messages : [];
  let historyCount = 0;

  for (let i = 0; i < messageArray.length; i++) {
    const msg: any = messageArray[i];
    const content = getTextContent(msg);

    if (msg.role === "system") {
      lines.push("━━━ SYSTEM MESSAGE ━━━");
      lines.push("");

      // Try to identify L1, L2 from envelope
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

        // Check for L2
        if (l2 && l2.text) {
          const hashShort = l2.hash.substring(0, 8);
          lines.push(`🔒 L2_PREVIOUS (${hashShort}) [CACHEABLE]`);
          const preview =
            l2.text.length > 300 ? l2.text.substring(0, 300) + "...[truncated]" : l2.text;
          lines.push(preview);
          lines.push("");
        }

        // Detect tools in system message (e.g., localSearch RAG - turn-specific)
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
        // Fallback: just show content with tool detection
        const tools = detectTools(content);
        if (tools.length > 0) {
          // Split content before first tool
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
      // Count history messages (skip the last user message)
      if (i < messageArray.length - 1) {
        historyCount++;
      }
    }
  }

  // Chat history summary
  if (historyCount > 0) {
    lines.push("━━━ CHAT HISTORY (L4) ━━━");
    lines.push("");
    lines.push(`${historyCount} message(s)`);
    lines.push("");
  }

  // Last user message
  const lastMsg: any = messageArray[messageArray.length - 1];
  if (lastMsg && lastMsg.role === "user") {
    lines.push("━━━ USER MESSAGE ━━━");
    lines.push("");

    const content = getTextContent(lastMsg);

    // Detect tools in user message (turn-specific)
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

    // Try to find L3, L5 from envelope
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

/**
 * Record the latest prompt payload destined for the LLM so it can be shared on demand.
 *
 * @param params - Metadata describing the payload, message array, and optional context envelope.
 */
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
      messagesArray: messages, // Store for analysis
      contextEnvelope,
    };
  } catch {
    // Fall back to best-effort stringification to avoid blocking logging entirely.
    latestSnapshot = {
      timestamp: new Date().toISOString(),
      modelName,
      serializedMessages: String(messages),
      messagesArray: messages,
      contextEnvelope,
    };
  }
}

/**
 * Clear the stored prompt payload so stale data is not shared after a reset/new chat.
 */
export function clearRecordedPromptPayload(): void {
  latestSnapshot = null;
}

/**
 * Flush the recorded payload into the Copilot log file using a markdown block.
 * Shows the ACTUAL messages sent to the LLM, plus layered metadata if available.
 */
export async function flushRecordedPromptPayloadToLog(): Promise<void> {
  if (!latestSnapshot) {
    return;
  }

  const { timestamp, modelName, serializedMessages, messagesArray, contextEnvelope } =
    latestSnapshot;

  // Always show the actual messages JSON (what really gets sent to the LLM)
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

  // Intelligently build layered view from actual messages + envelope
  // This automatically detects tool injections and maps to layers
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

/**
 * Internal helper exposed for tests to inspect the stored snapshot state.
 *
 * @returns The current snapshot or null if none is stored.
 */
export function __getLatestPromptPayloadSnapshotForTests(): PromptPayloadSnapshot | null {
  return latestSnapshot;
}
