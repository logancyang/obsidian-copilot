import type { ServerFrame } from "@/agentMode/protocol/frames";
import type { SessionOp, TranscriptOp } from "@/agentMode/protocol/ops";
import type { NoteRef, SessionState, WireMessage } from "@/agentMode/protocol/state";
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

// Stands in for an image a frame cannot carry, so the message still shows where the image was.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
const OMITTED_IMAGE_URL = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='72'><rect width='240' height='72' rx='8' fill='#888' fill-opacity='.2'/><text x='120' y='41' text-anchor='middle' font-family='sans-serif' font-size='13' fill='#888'>Image not shown on this device</text></svg>"
)}`;

function omitImages(message: WireMessage): WireMessage {
  const { content } = message;
  if (!content?.some(isInlineImage)) return message;
  return {
    ...message,
    content: content.map((item) =>
      isInlineImage(item) ? { type: "image_url", image_url: { url: OMITTED_IMAGE_URL } } : item
    ),
  };
}

function isInlineImage(item: unknown): boolean {
  return (
    typeof item === "object" && item !== null && (item as { type?: unknown }).type === "image_url"
  );
}

/**
 * The frame with every inline image of its transcript replaced by a placeholder. A user message
 * carries its images as data URLs, so a long chat of photos can outgrow what one frame may hold;
 * the phone then shows the transcript with the images marked instead of never loading it.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/613
 * @param frame - The frame the connection refuses to send at its full size.
 */
export function withoutInlineImages(frame: ServerFrame): ServerFrame {
  if (frame.type === "snapshot" && frame.state !== null && "transcript" in frame.state) {
    const state: SessionState = frame.state;
    return { ...frame, state: { ...state, transcript: state.transcript.map(omitImages) } };
  }
  if (frame.type !== "ops") return frame;
  const ops = frame.ops.map((op): typeof op => {
    const sessionOp = op as SessionOp;
    if (sessionOp.t === "msg.add") return { ...sessionOp, message: omitImages(sessionOp.message) };
    if (sessionOp.t === "transcript.set") {
      return { ...sessionOp, messages: sessionOp.messages.map(omitImages) };
    }
    return op;
  });
  return { ...frame, ops };
}
