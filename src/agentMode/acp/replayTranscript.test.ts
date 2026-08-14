import { AI_SENDER, USER_SENDER } from "@/constants";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import {
  consumeReplayUpdate,
  createReplayTranscriptState,
  finishReplayTranscript,
  type ReplayTranscriptState,
} from "./replayTranscript";

/** Build a wire-shaped replay chunk, optionally carrying a backend message id. */
function chunk(
  sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk",
  text: string,
  messageId?: string
): SessionNotification["update"] {
  return {
    sessionUpdate,
    ...(messageId ? { messageId } : {}),
    content: { type: "text", text },
  } as unknown as SessionNotification["update"];
}

function activity(sessionUpdate: string): SessionNotification["update"] {
  return { sessionUpdate } as unknown as SessionNotification["update"];
}

/** Feed a whole burst and return the finished transcript. */
function replay(
  updates: SessionNotification["update"][]
): ReturnType<typeof finishReplayTranscript> {
  const state = createReplayTranscriptState();
  for (const u of updates) consumeReplayUpdate(state, u);
  return finishReplayTranscript(state);
}

describe("replayTranscript", () => {
  describe("consumeReplayUpdate()", () => {
    it("claims conversation chunks and leaves session-level updates to the caller", () => {
      const state = createReplayTranscriptState();
      expect(consumeReplayUpdate(state, chunk("user_message_chunk", "hi"))).toBe(true);
      expect(consumeReplayUpdate(state, chunk("agent_message_chunk", "hello"))).toBe(true);

      for (const kind of ["agent_thought_chunk", "tool_call", "tool_call_update", "plan"]) {
        expect(consumeReplayUpdate(state, activity(kind))).toBe(true);
      }
      for (const kind of [
        "session_info_update",
        "current_mode_update",
        "config_option_update",
        "usage_update",
        "available_commands_update",
        "some_future_update",
      ]) {
        expect(consumeReplayUpdate(state, activity(kind))).toBe(false);
      }
    });

    it("claims a non-text conversation chunk without adding it to the transcript", () => {
      const state = createReplayTranscriptState();
      const image = {
        sessionUpdate: "user_message_chunk",
        content: { type: "image", mimeType: "image/png", data: "aGk=" },
      } as unknown as SessionNotification["update"];

      // Claimed so it cannot fall through to the live routing path this
      // accumulator exists to bypass, but nothing displayable comes of it.
      expect(consumeReplayUpdate(state, image)).toBe(true);
      expect(finishReplayTranscript(state)).toBeUndefined();
    });

    it("joins the chunks of one streamed message", () => {
      const transcript = replay([
        chunk("agent_message_chunk", "Hel"),
        chunk("agent_message_chunk", "lo "),
        chunk("agent_message_chunk", "there"),
      ]);

      expect(transcript).toHaveLength(1);
      expect(transcript?.[0].message).toBe("Hello there");
    });

    it("separates alternating turns", () => {
      const transcript = replay([
        chunk("user_message_chunk", "Hello"),
        chunk("agent_message_chunk", "你好！有什么我可以帮你处理的吗？"),
        chunk("user_message_chunk", "Goodbye"),
        chunk("agent_message_chunk", "再见！祝你今天愉快 👋"),
      ]);

      expect(transcript?.map((m) => `${m.sender}:${m.message}`)).toEqual([
        `${USER_SENDER}:Hello`,
        `${AI_SENDER}:你好！有什么我可以帮你处理的吗？`,
        `${USER_SENDER}:Goodbye`,
        `${AI_SENDER}:再见！祝你今天愉快 👋`,
      ]);
    });

    it("keeps one turn in one message when its chunks carry different message ids", () => {
      // The live view appends every chunk of a turn to a single assistant
      // message whatever its id, so a replay must not split on one.
      const transcript = replay([
        chunk("user_message_chunk", "list the files", "m1"),
        chunk("agent_message_chunk", "Let me look. ", "m2"),
        activity("tool_call"),
        activity("tool_call_update"),
        chunk("agent_message_chunk", "Here they are.", "m3"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual([
        "list the files",
        "Let me look. Here they are.",
      ]);
    });

    it("separates two prompts that carry different message ids", () => {
      // A turn cancelled, refused, or failed before the agent said anything
      // leaves its prompt in history with nothing after it, so the next prompt
      // follows immediately and only the id tells them apart.
      const transcript = replay([
        chunk("user_message_chunk", "cancelled prompt", "u1"),
        chunk("user_message_chunk", "next prompt", "u2"),
        chunk("agent_message_chunk", "answer"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual([
        "cancelled prompt",
        "next prompt",
        "answer",
      ]);
    });

    it("joins the chunks of one prompt that share a message id", () => {
      const transcript = replay([
        chunk("user_message_chunk", "one prompt ", "u1"),
        chunk("user_message_chunk", "in two chunks", "u1"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual(["one prompt in two chunks"]);
    });

    it("separates two prompts that the agent replayed without any message id", () => {
      // The id is optional, so a replay can carry user chunks without one. Only
      // a repeated id proves two chunks are one prompt, so without one each
      // chunk stands alone — otherwise the pair below would come back as a
      // single run-on bubble.
      const transcript = replay([
        chunk("user_message_chunk", "cancelled prompt"),
        chunk("user_message_chunk", "next prompt"),
        chunk("agent_message_chunk", "answer"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual([
        "cancelled prompt",
        "next prompt",
        "answer",
      ]);
    });

    it("keeps a thought out of the transcript without ending the turn it sits in", () => {
      const transcript = replay([
        chunk("user_message_chunk", "why?"),
        chunk("agent_message_chunk", "First. ", "m1"),
        chunk("agent_thought_chunk", "reasoning", "m2"),
        chunk("agent_message_chunk", "Second.", "m3"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual(["why?", "First. Second."]);
    });

    it("separates two user turns when the agent only thought between them", () => {
      const transcript = replay([
        chunk("user_message_chunk", "first ask"),
        chunk("agent_thought_chunk", "reasoning"),
        chunk("user_message_chunk", "second ask"),
        chunk("agent_message_chunk", "answer"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual(["first ask", "second ask", "answer"]);
    });

    it("separates two user turns when the agent only ran a tool between them", () => {
      // A turn that answers by running a tool and saying nothing is a complete
      // turn in the live view, so it has to keep the prompts around it apart
      // even though the tool itself is not restored.
      const transcript = replay([
        chunk("user_message_chunk", "first ask"),
        activity("tool_call"),
        activity("tool_call_update"),
        chunk("user_message_chunk", "second ask"),
        chunk("agent_message_chunk", "answer"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual(["first ask", "second ask", "answer"]);
    });

    it("keeps one prompt whole when a tool update lands between its chunks", () => {
      // An update can settle a tool call started in an earlier turn, so it says
      // nothing about who is speaking and must not break the message it lands
      // in.
      const transcript = replay([
        chunk("user_message_chunk", "one prompt ", "u1"),
        activity("tool_call_update"),
        chunk("user_message_chunk", "in two chunks", "u1"),
        chunk("agent_message_chunk", "answer"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual(["one prompt in two chunks", "answer"]);
    });
  });

  describe("finishReplayTranscript()", () => {
    it("returns undefined when the replay carried nothing displayable", () => {
      expect(finishReplayTranscript(createReplayTranscriptState())).toBeUndefined();
    });

    it("drops a message whose chunks were all whitespace", () => {
      const transcript = replay([
        chunk("user_message_chunk", "   "),
        chunk("agent_message_chunk", "real answer"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual(["real answer"]);
    });

    it("restores a context-wrapped prompt as the text the user typed", () => {
      // What the agent stored for a prompt sent with a note attached.
      const wrapped =
        "<copilot-context>\nNotes:\n- 2023-10-27.md\n</copilot-context>\n\n" +
        "<user-message>\n[[2023-10-27]] hi\n</user-message>";

      const transcript = replay([
        chunk("user_message_chunk", wrapped),
        chunk("agent_message_chunk", "hello"),
      ]);

      expect(transcript?.map((m) => m.message)).toEqual(["[[2023-10-27]] hi", "hello"]);
    });

    it("numbers display ids positionally and leaves timestamps unset", () => {
      const transcript = replay([
        chunk("user_message_chunk", "hi", "wire-id-1"),
        chunk("agent_message_chunk", "hello", "wire-id-2"),
      ]);

      expect(transcript?.map((m) => m.id)).toEqual(["acp-loaded-0", "acp-loaded-1"]);
      // A replayed message has no original send time; stamping "now" would
      // render every restored message as if it had just arrived.
      expect(transcript?.every((m) => m.timestamp === null)).toBe(true);
      expect(transcript?.every((m) => m.isVisible)).toBe(true);
    });

    it("returns the same transcript when called twice", () => {
      const state: ReplayTranscriptState = createReplayTranscriptState();
      consumeReplayUpdate(state, chunk("user_message_chunk", "hi"));

      const first = finishReplayTranscript(state);
      expect(finishReplayTranscript(state)).toEqual(first);
    });
  });
});
