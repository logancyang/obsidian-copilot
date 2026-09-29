import type { Command } from "@/agentMode/protocol/commands";
import type { ClientFrame, ServerFrame } from "@/agentMode/protocol/frames";
import { HOST_SCOPE, sessionIdOfScope, type Scope } from "@/agentMode/protocol/state";

const MAX_TEXT_FIELD = 512;

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_FIELD;
}

function isScope(value: unknown): value is Scope {
  return isText(value) && (value === HOST_SCOPE || sessionIdOfScope(value as Scope) !== null);
}

function isCursorPart(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// The shape of a phone's frame is checked here so the host never dispatches on a malformed object;
// the fields of a command are validated by its handler.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export function parseClientFrame(text: string): ClientFrame | null {
  const frame = parseObject(text);
  if (!frame) return null;
  switch (frame.type) {
    case "hello":
      return typeof frame.v === "number" && isText(frame.app)
        ? { type: "hello", v: frame.v, app: frame.app }
        : null;
    case "subscribe": {
      if (!isScope(frame.scope)) return null;
      if (frame.fromSeq === undefined) return { type: "subscribe", scope: frame.scope };
      if (!isCursorPart(frame.fromSeq) || !isText(frame.epoch)) return null;
      return { type: "subscribe", scope: frame.scope, fromSeq: frame.fromSeq, epoch: frame.epoch };
    }
    case "unsubscribe":
      return isScope(frame.scope) ? { type: "unsubscribe", scope: frame.scope } : null;
    case "focus":
      return frame.sessionId === null || isText(frame.sessionId)
        ? { type: "focus", sessionId: frame.sessionId }
        : null;
    case "command": {
      const command = frame.command;
      if (!isText(frame.id) || !command || typeof command !== "object") return null;
      if (typeof (command as { name?: unknown }).name !== "string") return null;
      return { type: "command", id: frame.id, command: command as Command };
    }
    default:
      return null;
  }
}

// The desktop is authenticated, so a server frame is checked only for being one the client can act
// on, not for the contents of its state or ops.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export function parseServerFrame(text: string): ServerFrame | null {
  const frame = parseObject(text);
  if (!frame) return null;
  switch (frame.type) {
    case "hello":
      return typeof frame.v === "number" &&
        typeof frame.app === "string" &&
        typeof frame.hostId === "string" &&
        typeof frame.ok === "boolean"
        ? (frame as unknown as ServerFrame)
        : null;
    case "snapshot":
      return isScope(frame.scope) &&
        typeof frame.epoch === "string" &&
        isCursorPart(frame.seq) &&
        "state" in frame
        ? (frame as unknown as ServerFrame)
        : null;
    case "ops":
      return isScope(frame.scope) &&
        typeof frame.epoch === "string" &&
        isCursorPart(frame.from) &&
        Array.isArray(frame.ops)
        ? (frame as unknown as ServerFrame)
        : null;
    case "result":
      return typeof frame.id === "string" && frame.result && typeof frame.result === "object"
        ? (frame as unknown as ServerFrame)
        : null;
    default:
      return null;
  }
}
