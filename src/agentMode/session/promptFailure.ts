import type { BackendId, StopReason } from "@/agentMode/session/types";
import { err2String } from "@/utils";

export function buildEmptyTurnMessage(backendId: BackendId, stopReason: StopReason): string {
  return `${backendId} finished the turn without returning any assistant text or tool activity (stop reason: ${stopReason}). Try again, or switch models if this repeats.`;
}

export function formatPromptFailure(err: unknown): string {
  const base = err2String(err);
  const providerMessage = extractProviderErrorMessage(err);
  if (!providerMessage || base.includes(providerMessage)) return base;
  return `${base}\n${providerMessage}`;
}

function extractProviderErrorMessage(err: unknown): string | null {
  const found = findProviderErrorPayload(err, new Set<unknown>());
  if (!found) return null;
  const type = typeof found.type === "string" ? found.type : "ProviderError";
  const message = typeof found.message === "string" ? found.message : null;
  if (!message) return type;
  return `${type}: ${message}`;
}

function findProviderErrorPayload(
  value: unknown,
  seen: Set<unknown>
): { type?: unknown; message?: unknown } | null {
  if (value === null || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const record = value as Record<string, unknown>;
  const directError = record.error;
  if (directError && typeof directError === "object") {
    const errorRecord = directError as Record<string, unknown>;
    if (typeof errorRecord.message === "string" || typeof errorRecord.type === "string") {
      return { type: errorRecord.type, message: errorRecord.message };
    }
  }
  if (typeof record.message === "string") {
    const parsed = tryParseJsonObject(record.message);
    if (parsed) {
      const nested = findProviderErrorPayload(parsed, seen);
      if (nested) return nested;
    }
  }
  if (record.data) {
    const nested = findProviderErrorPayload(record.data, seen);
    if (nested) return nested;
  }
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      const nested = findProviderErrorPayload(item, seen);
      if (nested) return nested;
    }
  }
  const cause = record.cause;
  if (cause) return findProviderErrorPayload(cause, seen);
  return null;
}

function tryParseJsonObject(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
