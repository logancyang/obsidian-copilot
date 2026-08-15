import { AI_SENDER, USER_SENDER } from "@/constants";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { stripUserMessageWrapper } from "@/agentMode/session/promptEnvelope";
import type { AgentChatMessage } from "@/agentMode/session/types";

/**
 * In-progress reconstruction of a replayed conversation.
 *
 * ACP agents answer `session/load` by replaying the whole transcript as
 * `session/update` notifications before the request resolves. Those frames
 * arrive with no live turn to attach to, so the normal streaming path drops
 * them; this state accumulates them into display messages instead.
 */
export interface ReplayTranscriptState {
  messages: AgentChatMessage[];
  /**
   * The message currently being accumulated, or null before the first chunk.
   * `wireId` is the backend's message id and is tracked for user messages only —
   * see the boundary rule on {@link consumeReplayUpdate}.
   */
  current: { sender: string; wireId: string | undefined; text: string } | null;
}

export function createReplayTranscriptState(): ReplayTranscriptState {
  return { messages: [], current: null };
}

/**
 * Feed one replayed `session/update` into `state`.
 *
 * Only user and assistant text is rebuilt. Thoughts and tool activity are
 * consumed and dropped so a reopened chat matches what the Claude and markdown
 * loaders restore — `parseClaudeTranscript` documents the same sender+text
 * contract, and the trail UI takes over an assistant message's whole body as
 * soon as it carries any parts, so partial tool restoration would hide the
 * answer text itself.
 *
 * DESIGN NOTE — the boundary rule is deliberately asymmetric, because the two
 * senders map onto ACP's `messageId` differently.
 *
 * A *user* bubble is one prompt (`AgentSession.sendPrompt` adds exactly one per
 * prompt), so a user chunk continues the current message only when it repeats
 * that message's id, and starts a new one otherwise. Defaulting to "new" is what
 * keeps two prompts apart when the agent emitted nothing between them — what a
 * turn cancelled, refused, or failed before it spoke leaves behind — which
 * sender alone cannot do. The id is optional, so a replay can carry user chunks
 * without one, and defaulting to "continue" would then run two prompts together
 * into a single bubble. The joining branch earns its place because the protocol
 * lets one message arrive as several chunks that share a `messageId`.
 *
 * An *assistant* bubble is one turn, deliberately coarser than the protocol's
 * message. Every chunk of a turn is appended to a single placeholder whatever
 * its id (`AgentSession.resolveContentTarget`), so an answer either side of a
 * tool call is one bubble live. Honouring id changes here would invent bubbles
 * the user never saw, so assistant ids are ignored and the sender switch ends
 * the message.
 *
 * If a future review proposes making the two senders behave the same, point
 * them at this note.
 *
 * @param state - Accumulator to mutate.
 * @param update - The wire-shaped update from the replay burst.
 * @returns Whether this update belonged to the replay and was consumed.
 *   `false` means the caller must keep routing it normally — a replay burst
 *   also carries session-level updates (mode, config, usage, title) that the
 *   resumed session still needs. Note this answers "was it consumed", NOT
 *   "did it produce text": a thought, or a chunk carrying an image instead of
 *   text, is consumed for its sender alone.
 */
export function consumeReplayUpdate(
  state: ReplayTranscriptState,
  update: SessionNotification["update"]
): boolean {
  let sender: string;
  // Tracked for user chunks only; assistant ids never move a boundary.
  let wireId: string | undefined;
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      sender = USER_SENDER;
      wireId = update.messageId ?? undefined;
      break;
    // A frame whose content is dropped still marks the agent as the sender. A
    // turn that only thought, or only ran a tool, is a complete turn in the
    // live view (`hasAssistantActivity` counts a tool part as activity), so it
    // has to separate the prompts on either side of it even though it leaves
    // no visible message behind.
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "tool_call":
    case "plan":
      sender = AI_SENDER;
      break;
    // An update names a tool call that may belong to an *earlier* turn — a
    // background tool settling during a later one is a case this codebase
    // supports — so it says nothing about who is speaking now. The `tool_call`
    // that opened it already marked the boundary; letting the update mark one
    // too would split a user message that a late arrival landed in the middle
    // of.
    case "tool_call_update":
      return true;
    default:
      return false;
  }

  if (startsNewMessage(state.current, sender, wireId)) flushCurrent(state);
  const current = (state.current ??= { sender, wireId, text: "" });
  // Only conversation text is rebuilt; dropping the rest is also what keeps it
  // away from the live handler, where a replayed `plan` (or the `todowrite`
  // tool call opencode synthesizes one from) would overwrite the resumed
  // session's todo snapshot, and a replayed `ExitPlanMode` would raise a
  // plan-approval card for a decision the user already made.
  if (
    update.sessionUpdate === "user_message_chunk" ||
    update.sessionUpdate === "agent_message_chunk"
  ) {
    const { content } = update;
    if (content?.type === "text") current.text += content.text;
  }
  return true;
}

/**
 * Close the final message and hand back the transcript, or `undefined` when the
 * replay produced nothing displayable. Safe to call more than once.
 */
export function finishReplayTranscript(
  state: ReplayTranscriptState
): AgentChatMessage[] | undefined {
  flushCurrent(state);
  return state.messages.length > 0 ? state.messages : undefined;
}

/**
 * Whether this chunk ends the message being accumulated. A sender switch always
 * does. Within one sender, only a *user* chunk repeating the current message's
 * id continues it; an absent or different id starts a new prompt — see the
 * boundary rule on {@link consumeReplayUpdate}.
 */
function startsNewMessage(
  current: ReplayTranscriptState["current"],
  sender: string,
  wireId: string | undefined
): boolean {
  if (!current) return true;
  if (current.sender !== sender) return true;
  if (sender !== USER_SENDER) return false;
  return wireId === undefined || wireId !== current.wireId;
}

function flushCurrent(state: ReplayTranscriptState): void {
  const current = state.current;
  state.current = null;
  if (!current) return;
  // The agent stored the prompt with its context envelope; the user only ever
  // typed what is inside it.
  const message =
    current.sender === USER_SENDER ? stripUserMessageWrapper(current.text) : current.text;
  // A turn whose chunks carried only whitespace leaves nothing worth a bubble,
  // the same case `parseClaudeTranscript` skips when a record has no text.
  if (!message.trim()) return;
  state.messages.push({
    // Positional like the Claude loader's `claude-loaded-N`: this is a display
    // identity, unrelated to any id the backend put on the wire.
    id: `acp-loaded-${state.messages.length}`,
    sender: current.sender,
    message,
    isVisible: true,
    // The replay carries no original send time, and stamping "now" would show
    // every restored message as if it had just been sent.
    timestamp: null,
  });
}
