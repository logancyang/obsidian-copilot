import type { ContextDeliveryCursor } from "@/agentMode/session/ContextDeliveryCursor";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";

/**
 * Char cap on the voice context block. The backend session already holds every
 * prompt it ran, so this block only carries speech it never saw; a bound keeps
 * a long call from pushing a single prompt past the model's window. Newest
 * entries win, and the block says so when older ones were left out.
 */
export const VOICE_CONTEXT_MAX_CHARS = 8_000;

/** Frozen "nothing pending" ids, so an all-delivered conversation is stable. */
const EMPTY_MESSAGE_IDS: readonly string[] = Object.freeze([]);

/**
 * The voice exchanges a prompt should carry, and the entries it speaks for.
 * The ids are what advances the delivery cursor — only after the backend has
 * accepted the prompt, never when the request was composed.
 */
export interface VoiceContextSelection {
  /** Public entries the block carries, oldest first. */
  readonly messageIds: readonly string[];
  /** The rendered block, or null when the backend has already heard everything. */
  readonly block: string | null;
}

/** Nothing left to tell the backend. */
const NO_VOICE_CONTEXT: VoiceContextSelection = Object.freeze({
  messageIds: EMPTY_MESSAGE_IDS,
  block: null,
});

/** The cursor operations this selection needs; the rest of it is irrelevant here. */
type DeliverySelector = Pick<ContextDeliveryCursor, "selectUndelivered">;

/**
 * Pick the spoken exchanges this backend session has not been given yet.
 *
 * A local agent only knows the prompts it received; everything the user and
 * the voice frontend said out loud is invisible to it until a prompt carries
 * it. Entries covered by the request being sent are excluded — the prompt
 * already states them — and uncertain entries are held back by the cursor so a
 * disconnect can never make the agent read the same request twice.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Text and voice context continuity".
 *
 * @param messages - The public transcript, oldest first.
 * @param cursor - This backend session's delivery bookkeeping.
 * @param excludeIds - Entries the outgoing request already speaks for.
 */
export function selectVoiceContext(
  messages: readonly AgentChatMessage[],
  cursor: DeliverySelector,
  excludeIds: readonly string[]
): VoiceContextSelection {
  const excluded = new Set(excludeIds);
  const spoken = messages.filter(
    (message) =>
      !excluded.has(message.id) &&
      (message.origin === "voice-user" || message.origin === "voice-assistant") &&
      message.message.trim().length > 0
  );
  if (spoken.length === 0) return NO_VOICE_CONTEXT;
  const pending = new Set(cursor.selectUndelivered(spoken.map((message) => message.id)));
  const selected = spoken.filter((message) => pending.has(message.id));
  if (selected.length === 0) return NO_VOICE_CONTEXT;

  const turns: string[] = [];
  const messageIds: string[] = [];
  let chars = 0;
  // Newest first while filling, so the bound drops the oldest exchanges rather
  // than the request's immediate context.
  for (let i = selected.length - 1; i >= 0; i -= 1) {
    const message = selected[i];
    const turn = renderVoiceTurn(message);
    if (chars + turn.length > VOICE_CONTEXT_MAX_CHARS && turns.length > 0) break;
    chars += turn.length;
    turns.unshift(turn);
    messageIds.unshift(message.id);
  }
  const omitted = selected.length - turns.length;
  return {
    messageIds,
    block: renderVoiceContextBlock(turns, omitted),
  };
}

/** One spoken entry, labelled with who said it. */
function renderVoiceTurn(message: AgentChatMessage): string {
  const role = message.origin === "voice-user" ? "user" : "voice-assistant";
  const interrupted = message.interrupted ? ' status="interrupted"' : "";
  return `<voice_turn speaker="${role}"${interrupted}>\n${escapeXml(message.message)}\n</voice_turn>`;
}

/**
 * Frame the spoken exchanges as reference material. The framing is what stops
 * a transcript line from reading as a fresh instruction, and it says plainly
 * that speech recognition can be wrong.
 */
function renderVoiceContextBlock(turns: readonly string[], omitted: number): string {
  const omission =
    omitted > 0
      ? `\n${omitted} earlier spoken exchange(s) are omitted because this block is length-bounded.`
      : "";
  return (
    "<voice_conversation>\n" +
    "The user has been talking to Copilot's voice assistant in this same conversation. " +
    "The entries below are speech-to-text output you have not received before, so they " +
    "may contain recognition errors. Treat them as historical reference for continuity: " +
    "do not redo work they describe and do not answer them again. The request to act on " +
    `is the user message that follows.${omission}\n` +
    `${turns.join("\n")}\n` +
    "</voice_conversation>"
  );
}
