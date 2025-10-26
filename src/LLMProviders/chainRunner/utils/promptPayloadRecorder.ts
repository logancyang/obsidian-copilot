import { PromptContextEnvelope } from "@/context/PromptContextTypes";
import { logMarkdownBlock } from "@/logger";

interface PromptPayloadSnapshot {
  timestamp: string;
  modelName?: string;
  serializedMessages: string;
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
 * Format the layered context envelope for human-readable debugging.
 * Shows each layer (L1-L5) clearly with clean, minimal formatting.
 */
function formatLayeredContext(envelope: PromptContextEnvelope): string {
  const lines: string[] = [];

  // Metadata line
  lines.push(
    `msg:${envelope.messageId ?? "N/A"} | conv:${envelope.conversationId ?? "N/A"} | v${envelope.version}`
  );
  lines.push("");

  // Show each layer
  for (const layer of envelope.layers) {
    const stableIcon = layer.stable ? "🔒" : "⚡";
    const hashShort = layer.hash.substring(0, 8);

    lines.push(`${stableIcon} ${layer.id} (${hashShort})`);

    // Show layer text
    if (layer.text) {
      lines.push(layer.text);
    } else {
      lines.push("(empty)");
    }
    lines.push("");
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
      contextEnvelope,
    };
  } catch {
    // Fall back to best-effort stringification to avoid blocking logging entirely.
    latestSnapshot = {
      timestamp: new Date().toISOString(),
      modelName,
      serializedMessages: String(messages),
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

  const { timestamp, modelName, serializedMessages, contextEnvelope } = latestSnapshot;

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

  // If we have a context envelope, also show the layered breakdown for context
  if (contextEnvelope) {
    const layeredView = formatLayeredContext(contextEnvelope);
    lines.push("**Layered Context Metadata:**");
    lines.push("");
    lines.push("```");
    lines.push(layeredView);
    lines.push("```");
    lines.push("");
  }

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
