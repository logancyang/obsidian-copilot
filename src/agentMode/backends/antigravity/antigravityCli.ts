import type { BackendModelInfo } from "@/agentMode/session/types";

export type AntigravityStreamEvent =
  | { kind: "init"; conversationId?: string }
  | { kind: "step_update"; textDelta?: string }
  | {
      kind: "result";
      status?: string;
      response?: string;
      conversationId?: string;
      usage?: Record<string, unknown>;
    };

const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-?]*[ -/]*[@-~]`, "g");

/** Parse the human-readable model table printed by `agy models`. */
export function parseAntigravityModels(stdout: string): BackendModelInfo[] {
  const models: BackendModelInfo[] = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_ESCAPE_RE, "").trim();
    if (!line || line.startsWith("[") || /^[-=]+$/.test(line)) continue;

    const match = line.match(/^([^\s]+)(?:\t+|\s{2,}|\s+-\s+)(.+)$/);
    if (!match) continue;
    const modelId = match[1].trim();
    const name = match[2].trim();
    if (!modelId || !name || /^(available\s+models?|model|slug)$/i.test(modelId)) continue;
    if (seen.has(modelId)) continue;
    seen.add(modelId);
    models.push({ modelId, name });
  }
  return models;
}

/** Parse one NDJSON line from `agy --output-format stream-json`. */
export function parseAntigravityStreamLine(line: string): AntigravityStreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const root = value as Record<string, unknown>;
  const eventName = typeof root.event === "string" ? root.event : root.type;
  if (eventName !== "init" && eventName !== "step_update" && eventName !== "result") {
    return null;
  }

  const payload =
    root[eventName] && typeof root[eventName] === "object"
      ? (root[eventName] as Record<string, unknown>)
      : root;
  const conversationId = stringValue(
    payload.conversation_id ?? payload.conversationId ?? root.conversation_id ?? root.conversationId
  );

  if (eventName === "init") {
    return { kind: "init", ...(conversationId ? { conversationId } : {}) };
  }
  if (eventName === "step_update") {
    const textDelta = stringValue(payload.text_delta ?? payload.textDelta ?? root.text_delta);
    return { kind: "step_update", ...(textDelta !== undefined ? { textDelta } : {}) };
  }

  const status = stringValue(payload.status ?? root.status);
  const responseValue = stringValue(payload.response ?? root.response);
  const error = stringValue(payload.error ?? root.error);
  const response = responseValue || error;
  const usage = objectValue(payload.usage ?? root.usage);
  return {
    kind: "result",
    ...(status ? { status } : {}),
    ...(response !== undefined || error !== undefined ? { response: response ?? error } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(usage ? { usage } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
