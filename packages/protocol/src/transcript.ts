import type {
  AgentCancelCause,
  AgentMessagePart,
  MessageExtension,
  StopReason,
  TranscriptMessage,
  TurnFileChange,
} from "@copilot/protocol/messages";
import type { AgentToolCallOutput } from "@copilot/protocol/toolCalls";

export type SavedMessageFields<M extends TranscriptMessage> = Partial<
  Pick<M, "timestamp" | "message" | "context" | "toolsUsed"> & MessageExtension<M>
>;

export type TranscriptOp<M extends TranscriptMessage> =
  | { type: "add"; message: M }
  | { type: "replaceAll"; messages: readonly M[] }
  | { type: "remove"; id: string }
  | { type: "appendText"; id: string; text: string; atMs: number }
  | { type: "appendThought"; id: string; text: string; atMs: number }
  | { type: "upsertPart"; id: string; part: AgentMessagePart; atMs: number }
  | { type: "completeTurn"; id: string; stopReason: StopReason; durationMs: number; atMs: number }
  | { type: "extendTurnDuration"; id: string; durationMs: number }
  | { type: "markError"; id: string; errorText: string; durationMs?: number; atMs: number }
  | { type: "settleOpenParts"; id: string; status: "cancelled" | "failed" }
  | { type: "stopToolCalls"; id: string; keepToolCallIds: readonly string[] }
  | { type: "setCancelCause"; id: string; cause: AgentCancelCause }
  | { type: "setFileChanges"; id: string; changes: TurnFileChange[] }
  | {
      type: "restoreSavedFields";
      rows: readonly { id: string; fields: SavedMessageFields<M> }[];
    }
  | { type: "patchExtension"; id: string; patch: Partial<MessageExtension<M>> };

type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;
type PlanPart = Extract<AgentMessagePart, { kind: "plan" }>;

const MAX_COMPARE_JSON_CHARS = 8_000;
const MAX_COMPARE_EDGE_CHARS = 512;
const MAX_COMPARE_TEXT_EDGE_CHARS = 128;

// A pending tool call never started, while an in-progress one may be a background task that reports after its turn.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/739
function isOpenPart(part: AgentMessagePart): boolean {
  if (part.kind === "compaction") return part.status === "in_progress";
  return part.kind === "tool_call" && part.status === "pending";
}

function agentPartId(part: AgentMessagePart): string | undefined {
  if (part.kind === "tool_call") return `tool:${part.id}`;
  if (part.kind === "plan") return "plan";
  if (part.kind === "compaction") return `compaction:${part.id}`;
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
    case "compaction":
      if (b.kind !== "compaction") return false;
      return (
        a.status === b.status &&
        a.trigger === b.trigger &&
        a.error === b.error &&
        a.preTokens === b.preTokens &&
        a.postTokens === b.postTokens &&
        a.startedAtMs === b.startedAtMs
      );
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

function withLast(parts: AgentMessagePart[], last: AgentMessagePart): AgentMessagePart[] {
  const next = parts.slice();
  next[next.length - 1] = last;
  return next;
}

// The latest reasoning block ends at the event that ended it. React can batch over this transition, so render-time clocks cannot recover it later.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/336
function finishTrailingThought(
  parts: AgentMessagePart[],
  turnStopReason: StopReason | undefined,
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
  return withLast(parts, { ...last, durationMs });
}

function appendText(parts: AgentMessagePart[], text: string): AgentMessagePart[] {
  const last = parts[parts.length - 1];
  if (last && last.kind === "text") return withLast(parts, { ...last, text: last.text + text });
  return [...parts, { kind: "text", text }];
}

function appendThought(
  parts: AgentMessagePart[],
  turnStopReason: StopReason | undefined,
  text: string,
  atMs: number
): AgentMessagePart[] {
  const last = parts[parts.length - 1];
  // A completed message can receive its final thought chunks after the prompt result. Extend a trailing span when possible; otherwise start a frozen span because another event may never arrive to finish it.
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
    return withLast(parts, extended);
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

function upsertPart<M extends TranscriptMessage>(
  msg: M,
  part: AgentMessagePart,
  atMs: number
): M | undefined {
  const parts = msg.parts ?? [];
  const partId = agentPartId(part);
  const idx = partId === undefined ? -1 : parts.findIndex((p) => agentPartId(p) === partId);
  if (idx === -1) {
    return { ...msg, parts: [...finishTrailingThought(parts, msg.turnStopReason, atMs), part] };
  }
  // A fresh plan snapshot can replace its earlier singleton while still ending the reasoning block at the live edge.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
  const settled =
    part.kind === "plan" ? finishTrailingThought(parts, msg.turnStopReason, atMs) : parts;
  if (partsEqual(settled[idx], part)) {
    return settled === parts ? undefined : { ...msg, parts: settled };
  }
  const replaced = settled.slice();
  replaced[idx] = part;
  return { ...msg, parts: replaced };
}

function changedParts<M extends TranscriptMessage>(
  msg: M,
  changes: (part: AgentMessagePart) => AgentMessagePart | undefined
): M | undefined {
  if (!msg.parts?.some((part) => changes(part) !== undefined)) return undefined;
  return { ...msg, parts: msg.parts.map((part) => changes(part) ?? part) };
}

function applyToMessage<M extends TranscriptMessage>(
  msg: M,
  op: Exclude<TranscriptOp<M>, { type: "add" | "replaceAll" | "remove" | "restoreSavedFields" }>
): M | undefined {
  switch (op.type) {
    case "appendText":
      return {
        ...msg,
        message: msg.message + op.text,
        parts: appendText(
          finishTrailingThought(msg.parts ?? [], msg.turnStopReason, op.atMs),
          op.text
        ),
      };
    case "appendThought":
      return {
        ...msg,
        parts: appendThought(msg.parts ?? [], msg.turnStopReason, op.text, op.atMs),
      };
    case "upsertPart":
      return upsertPart(msg, op.part, op.atMs);
    case "completeTurn":
      if (msg.turnStopReason !== undefined) return undefined;
      return {
        ...msg,
        parts: msg.parts && finishTrailingThought(msg.parts, undefined, op.atMs),
        turnStopReason: op.stopReason,
        turnDurationMs: Math.max(0, op.durationMs),
      };
    case "extendTurnDuration": {
      if (msg.turnDurationMs === undefined) return undefined;
      const durationMs = Math.max(0, op.durationMs);
      return durationMs > msg.turnDurationMs ? { ...msg, turnDurationMs: durationMs } : undefined;
    }
    case "markError":
      return {
        ...msg,
        parts: msg.parts && finishTrailingThought(msg.parts, msg.turnStopReason, op.atMs),
        isErrorMessage: true,
        ...(op.durationMs !== undefined ? { turnDurationMs: Math.max(0, op.durationMs) } : {}),
        message: `${msg.message}${msg.message.length > 0 ? "\n\n" : ""}**Error:** ${op.errorText}`,
      };
    // A spinner must not outlive the turn that started it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/633
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/739
    case "settleOpenParts":
      return changedParts(msg, (part) => {
        if (!isOpenPart(part)) return undefined;
        return part.kind === "compaction"
          ? { ...part, status: op.status }
          : { ...part, status: "failed" as const };
      });
    case "stopToolCalls":
      return changedParts(msg, (part) =>
        part.kind === "tool_call" &&
        (part.status === "pending" || part.status === "in_progress") &&
        !op.keepToolCallIds.includes(part.id)
          ? { ...part, status: "cancelled" as const }
          : undefined
      );
    case "setCancelCause":
      return { ...msg, agentCancelCause: op.cause };
    case "setFileChanges":
      return { ...msg, fileChanges: op.changes };
    case "patchExtension":
      return { ...msg, ...op.patch };
  }
}

function replaceAt<M>(messages: readonly M[], index: number, next: M): readonly M[] {
  const copy = messages.slice();
  copy[index] = next;
  return copy;
}

export function applyTranscriptOp<M extends TranscriptMessage>(
  messages: readonly M[],
  op: TranscriptOp<M>
): readonly M[] {
  switch (op.type) {
    case "add":
      return [...messages, op.message];
    case "replaceAll":
      return op.messages;
    case "remove": {
      const index = messages.findIndex((m) => m.id === op.id);
      return index === -1 ? messages : messages.filter((_, i) => i !== index);
    }
    case "restoreSavedFields": {
      let next = messages;
      for (const row of op.rows) {
        const index = next.findIndex((m) => m.id === row.id);
        if (index !== -1) next = replaceAt(next, index, { ...next[index], ...row.fields });
      }
      return next;
    }
    default: {
      const index = messages.findIndex((m) => m.id === op.id);
      if (index === -1) return messages;
      const changed = applyToMessage(messages[index], op);
      return changed ? replaceAt(messages, index, changed) : messages;
    }
  }
}
