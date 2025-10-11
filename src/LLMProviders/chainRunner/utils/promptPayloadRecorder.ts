import { logMarkdownBlock } from "@/logger";

interface PromptPayloadSnapshot {
  timestamp: string;
  modelName?: string;
  serializedMessages: string;
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
 * Record the latest prompt payload destined for the LLM so it can be shared on demand.
 *
 * @param params - Metadata describing the payload and the message array.
 */
export function recordPromptPayload(params: { messages: unknown[]; modelName?: string }): void {
  const { messages, modelName } = params;

  try {
    latestSnapshot = {
      timestamp: new Date().toISOString(),
      modelName,
      serializedMessages: safeSerialize(messages),
    };
  } catch {
    // Fall back to best-effort stringification to avoid blocking logging entirely.
    latestSnapshot = {
      timestamp: new Date().toISOString(),
      modelName,
      serializedMessages: String(messages),
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
 */
export async function flushRecordedPromptPayloadToLog(): Promise<void> {
  if (!latestSnapshot) {
    return;
  }

  const { timestamp, modelName, serializedMessages } = latestSnapshot;
  const headerLines = [
    `### Agent Prompt Payload — ${timestamp}${modelName ? ` (model: ${modelName})` : ""}`,
  ];

  logMarkdownBlock([...headerLines, "```json", serializedMessages, "```", ""]);

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
