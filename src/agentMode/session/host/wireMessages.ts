import type { TranscriptOp } from "@/agentMode/protocol/ops";
import type { NoteRef, WireMessage } from "@/agentMode/protocol/state";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type { MessageContext } from "@/types/message";
import type { TFile } from "obsidian";

const wireByMessage = new WeakMap<AgentChatMessage, WireMessage>();

function toNoteRef(file: TFile): NoteRef {
  return { path: file.path, basename: file.basename };
}

function toWireContext(context: MessageContext): NonNullable<WireMessage["context"]> {
  return { ...context, notes: context.notes.map(toNoteRef) };
}

export function toWireMessage(message: AgentChatMessage): WireMessage {
  if (!message.context) return message;
  const cached = wireByMessage.get(message);
  if (cached) return cached;
  const wire: WireMessage = { ...message, context: toWireContext(message.context) };
  wireByMessage.set(message, wire);
  return wire;
}

export function toWireTranscript(messages: readonly AgentChatMessage[]): readonly WireMessage[] {
  if (!messages.some((message) => message.context)) return messages;
  return messages.map(toWireMessage);
}

export function toWireOp(
  op: TranscriptOp<MessageContext>
): TranscriptOp<NonNullable<WireMessage["context"]>> {
  if (op.t === "msg.add") return { t: "msg.add", message: toWireMessage(op.message) };
  if (op.t === "transcript.set")
    return { t: "transcript.set", messages: toWireTranscript(op.messages) };
  return op;
}
