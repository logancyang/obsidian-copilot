import type { AgentMessagePart, AgentToolCallOutput } from "@/agentMode/session/types";
import type { TranscriptOp } from "@/agentMode/protocol/ops";
import type { MessageOf } from "@/agentMode/protocol/state";

const MAX_COMPARE_JSON_CHARS = 8_000;
const MAX_COMPARE_EDGE_CHARS = 512;
const MAX_COMPARE_TEXT_EDGE_CHARS = 128;

type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;
type PlanPart = Extract<AgentMessagePart, { kind: "plan" }>;

function agentPartId(part: AgentMessagePart): string | undefined {
  if (part.kind === "tool_call") return `tool:${part.id}`;
  if (part.kind === "plan") return "plan";
  return undefined;
}

function partsEqual(a: AgentMessagePart, b: AgentMessagePart): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case "text":
      if (b.kind !== "text") return false;
      return a.text === b.text;
    case "thought":
      if (b.kind !== "thought") return false;
      return a.text === b.text && a.startedAtMs === b.startedAtMs && a.durationMs === b.durationMs;
    case "plan":
      if (b.kind !== "plan") return false;
      return planEntriesEqual(a.entries, b.entries);
    case "tool_call":
      if (b.kind !== "tool_call") return false;
      return (
        a.id === b.id &&
        a.title === b.title &&
        a.toolKind === b.toolKind &&
        a.status === b.status &&
        a.userResponse === b.userResponse &&
        a.vendorToolName === b.vendorToolName &&
        a.parentToolCallId === b.parentToolCallId &&
        toolProgressEqual(a.progress, b.progress) &&
        boundedValueEqual(a.input, b.input) &&
        locationsEqual(a.locations, b.locations) &&
        toolOutputsEqual(a.output, b.output)
      );
  }
}

function toolProgressEqual(a: ToolCallPart["progress"], b: ToolCallPart["progress"]): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (
    a.description === b.description &&
    a.toolName === b.toolName &&
    a.toolUses === b.toolUses &&
    a.durationMs === b.durationMs &&
    a.totalTokens === b.totalTokens
  );
}

function planEntriesEqual(a: PlanPart["entries"], b: PlanPart["entries"]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (entry, index) =>
      entry.content === b[index].content &&
      entry.priority === b[index].priority &&
      entry.status === b[index].status
  );
}

function locationsEqual(a: ToolCallPart["locations"], b: ToolCallPart["locations"]): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  return a.every((loc, index) => loc.path === b[index].path && loc.line === b[index].line);
}

function toolOutputsEqual(
  a: AgentToolCallOutput[] | undefined,
  b: AgentToolCallOutput[] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;

  return a.every((output, index) => {
    const other = b[index];
    if (output.type !== other.type) return false;
    if (output.type === "diff" && other.type === "diff") {
      return (
        output.path === other.path &&
        output.oldText === other.oldText &&
        output.newText === other.newText
      );
    }
    if (output.type === "text" && other.type === "text") {
      return textFingerprint(output.text) === textFingerprint(other.text);
    }
    return false;
  });
}

function boundedValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return valueFingerprint(a) === valueFingerprint(b);
}

function valueFingerprint(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = String(value);
  }
  if (json.length <= MAX_COMPARE_JSON_CHARS) return json;
  return `${json.length}:${json.slice(0, MAX_COMPARE_EDGE_CHARS)}:${json.slice(
    -MAX_COMPARE_EDGE_CHARS
  )}`;
}

function textFingerprint(text: string): string {
  if (text.length <= MAX_COMPARE_TEXT_EDGE_CHARS * 2) return text;
  return `${text.length}:${text.slice(0, MAX_COMPARE_TEXT_EDGE_CHARS)}:${text.slice(
    -MAX_COMPARE_TEXT_EDGE_CHARS
  )}`;
}

function indexOfMessage<C>(messages: readonly MessageOf<C>[], id: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].id === id) return i;
  }
  return -1;
}

function withMessage<C>(
  messages: readonly MessageOf<C>[],
  index: number,
  next: MessageOf<C>
): readonly MessageOf<C>[] {
  const copy = messages.slice();
  copy[index] = next;
  return copy;
}

// A reasoning block ends at the event that follows it. React can batch over that transition, so a
// render-time clock cannot recover the duration later.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/336
function finishTrailingThought(
  parts: AgentMessagePart[],
  turnStopReason: MessageOf<unknown>["turnStopReason"],
  endedAtMs: number
): AgentMessagePart[] {
  const last = parts[parts.length - 1];
  if (
    !last ||
    last.kind !== "thought" ||
    last.startedAtMs === undefined ||
    (last.durationMs !== undefined && turnStopReason === undefined)
  ) {
    return parts;
  }
  const durationMs = Math.max(last.durationMs ?? 0, endedAtMs - last.startedAtMs);
  if (last.durationMs === durationMs) return parts;
  return [...parts.slice(0, -1), { ...last, durationMs }];
}

function appendThoughtPart(
  parts: AgentMessagePart[],
  turnStopReason: MessageOf<unknown>["turnStopReason"],
  text: string,
  atMs: number
): AgentMessagePart[] {
  const last = parts[parts.length - 1];
  // A completed message can receive its final thought chunks after the prompt result. Extend a
  // trailing span when possible; otherwise start a frozen span because no later event may finish it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
  if (
    last &&
    last.kind === "thought" &&
    (last.durationMs === undefined || turnStopReason !== undefined)
  ) {
    const extended = { ...last, text: last.text + text };
    if (turnStopReason !== undefined && last.startedAtMs !== undefined) {
      extended.durationMs = Math.max(0, atMs - last.startedAtMs);
    }
    return [...parts.slice(0, -1), extended];
  }
  return [
    ...parts,
    {
      kind: "thought",
      text,
      startedAtMs: atMs,
      ...(turnStopReason !== undefined ? { durationMs: 0 } : {}),
    },
  ];
}

function upsertPart<C>(
  msg: MessageOf<C>,
  part: AgentMessagePart,
  atMs: number
): MessageOf<C> | null {
  const parts = msg.parts ?? [];
  const partId = agentPartId(part);
  if (partId !== undefined) {
    const idx = parts.findIndex((p) => agentPartId(p) === partId);
    if (idx !== -1) {
      // A fresh plan snapshot can replace its earlier singleton while still ending the reasoning
      // block at the live edge.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
      const settled =
        part.kind === "plan" ? finishTrailingThought(parts, msg.turnStopReason, atMs) : parts;
      if (partsEqual(settled[idx], part)) {
        return settled === parts ? null : { ...msg, parts: settled };
      }
      const replaced = settled.slice();
      replaced[idx] = part;
      return { ...msg, parts: replaced };
    }
  }
  const settled = finishTrailingThought(parts, msg.turnStopReason, atMs);
  return { ...msg, parts: [...settled, part] };
}

export function applyTranscriptOp<C>(
  messages: readonly MessageOf<C>[],
  op: TranscriptOp<C>
): readonly MessageOf<C>[] {
  if (op.t === "msg.add") return [...messages, op.message];
  if (op.t === "transcript.set") return op.messages;

  const index = indexOfMessage(messages, op.id);
  if (index === -1) return messages;
  const msg = messages[index];

  switch (op.t) {
    case "msg.turnComplete": {
      if (msg.turnStopReason !== undefined) return messages;
      const settled = finishTrailingThought(msg.parts ?? [], undefined, op.atMs);
      return withMessage(messages, index, {
        ...msg,
        ...(msg.parts && settled !== msg.parts ? { parts: settled } : {}),
        turnStopReason: op.stopReason,
        turnDurationMs: Math.max(0, op.durationMs),
      });
    }
    case "msg.extendDuration": {
      if (msg.turnDurationMs === undefined) return messages;
      const next = Math.max(0, op.durationMs);
      if (next <= msg.turnDurationMs) return messages;
      return withMessage(messages, index, { ...msg, turnDurationMs: next });
    }
    case "msg.setFanout":
      return withMessage(messages, index, { ...msg, fanout: op.turn });
    case "msg.appendText": {
      const settled = finishTrailingThought(msg.parts ?? [], msg.turnStopReason, op.atMs);
      const last = settled[settled.length - 1];
      const parts: AgentMessagePart[] =
        last && last.kind === "text"
          ? [...settled.slice(0, -1), { ...last, text: last.text + op.text }]
          : [...settled, { kind: "text", text: op.text }];
      return withMessage(messages, index, { ...msg, message: msg.message + op.text, parts });
    }
    case "msg.appendThought":
      return withMessage(messages, index, {
        ...msg,
        parts: appendThoughtPart(msg.parts ?? [], msg.turnStopReason, op.text, op.atMs),
      });
    case "msg.upsertPart": {
      const next = upsertPart(msg, op.part, op.atMs);
      return next === null ? messages : withMessage(messages, index, next);
    }
    case "msg.markError": {
      const settled = finishTrailingThought(msg.parts ?? [], msg.turnStopReason, op.atMs);
      const suffix = msg.message.length > 0 ? "\n\n" : "";
      return withMessage(messages, index, {
        ...msg,
        ...(msg.parts && settled !== msg.parts ? { parts: settled } : {}),
        isErrorMessage: true,
        ...(op.durationMs !== undefined ? { turnDurationMs: Math.max(0, op.durationMs) } : {}),
        message: `${msg.message}${suffix}**Error:** ${op.errorText}`,
      });
    }
  }
}
