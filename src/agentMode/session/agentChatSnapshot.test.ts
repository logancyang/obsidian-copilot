import {
  AGENT_CHAT_SCHEMA_VERSION,
  buildSnapshotComment,
  conversationNeedsMixedSchema,
  readSnapshotComment,
  renderMixedChatBody,
  splitSnapshotComment,
  type AgentMixedConversation,
} from "@/agentMode/session/agentChatSnapshot";
import { EMPTY_CONTEXT_DELIVERY } from "@/agentMode/session/ContextDeliveryCursor";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type { AgentTaskRecord } from "@/agentMode/session/voiceTypes";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { sha256 } from "@/utils/hash";

function message(overrides: Partial<AgentChatMessage> & { id: string }): AgentChatMessage {
  return {
    sender: USER_SENDER,
    message: "",
    isVisible: true,
    timestamp: { epoch: 1_700_000_000_000, display: "2023/11/14 22:13:20", fileName: "" },
    ...overrides,
  };
}

function task(overrides: Partial<AgentTaskRecord> & { taskId: string }): AgentTaskRecord {
  return {
    sourceMessageIds: [],
    delegationIds: [],
    state: "completed",
    presentation: "voice-card",
    ...overrides,
  };
}

const SPOKEN_REQUEST = message({
  id: "m-spoken",
  message: "Which notes mention the Tuesday retro?",
  origin: "voice-user",
  voiceSessionId: "voice-1",
  taskId: "task-1",
  sourceRanges: [{ fragmentId: "frag-7", startMs: 1200, endMs: 3400 }],
});
const TASK_ANSWER = message({
  id: "m-answer",
  sender: AI_SENDER,
  message: "Two notes mention it: Retro 2024-05 and Team norms.",
  origin: "backend",
  taskId: "task-1",
});
const VOICE_TASK = task({
  taskId: "task-1",
  sourceMessageIds: ["m-spoken"],
  assistantMessageId: "m-answer",
  delegationIds: ["deleg-9"],
});

function mixedConversation(
  overrides: Partial<AgentMixedConversation> = {}
): AgentMixedConversation {
  return {
    conversationId: "conv-1",
    messages: [SPOKEN_REQUEST, TASK_ANSWER],
    tasks: [VOICE_TASK],
    contextDelivery: { delivered: ["m-spoken"], uncertain: [] },
    ...overrides,
  };
}

/** Save a conversation the way the persistence manager does, then read it back. */
function roundTrip(conversation: AgentMixedConversation) {
  const visibleBody = renderMixedChatBody(conversation.messages, conversation.tasks);
  const body = `${visibleBody}\n\n${buildSnapshotComment(conversation, visibleBody)}`;
  const split = splitSnapshotComment(body);
  return { body, split, result: readSnapshotComment(split.encoded ?? "", split.visibleBody) };
}

describe("agentChatSnapshot", () => {
  describe("conversationNeedsMixedSchema()", () => {
    it("declines the new schema for a conversation of typed messages only", () => {
      const typed = [
        message({ id: "m1", message: "hello", origin: "typed" }),
        message({ id: "m2", sender: AI_SENDER, message: "hi", origin: "backend" }),
      ];

      expect(conversationNeedsMixedSchema(typed, [])).toBe(false);
    });

    it("requires the new schema once a task renders as a voice card", () => {
      expect(conversationNeedsMixedSchema([], [VOICE_TASK])).toBe(true);
    });

    it("requires the new schema for spoken entries even with no task records", () => {
      expect(conversationNeedsMixedSchema([SPOKEN_REQUEST], [])).toBe(true);
    });

    it("declines the new schema for a text-presentation task in a typed chat", () => {
      const typedTask = task({ taskId: "task-2", presentation: "text" });

      expect(
        conversationNeedsMixedSchema([message({ id: "m1", origin: "typed" })], [typedTask])
      ).toBe(false);
    });
  });

  describe("renderMixedChatBody()", () => {
    it("writes public entries in the readable sender-and-timestamp format", () => {
      const body = renderMixedChatBody([SPOKEN_REQUEST], []);

      expect(body).toBe(
        "**user**: Which notes mention the Tuesday retro?\n[Timestamp: 2023/11/14 22:13:20]"
      );
    });

    it("replaces a voice task's backend answer with a summary carrying its full text", () => {
      const body = renderMixedChatBody([SPOKEN_REQUEST, TASK_ANSWER], [VOICE_TASK]);

      expect(body).toContain("**user**: Which notes mention the Tuesday retro?");
      expect(body).toContain("_Voice task — completed_");
      expect(body).toContain("Two notes mention it: Retro 2024-05 and Team norms.");
      // One readable answer, not the folded entry plus a summary of it.
      expect(body.match(/Two notes mention it/g)).toHaveLength(1);
    });

    it("labels a task summary with the state the card will show", () => {
      const body = renderMixedChatBody(
        [SPOKEN_REQUEST, TASK_ANSWER],
        [task({ ...VOICE_TASK, state: "failed" })]
      );

      expect(body).toContain("_Voice task — failed_");
    });

    it("says so in the summary when a voice task produced no answer text", () => {
      const body = renderMixedChatBody(
        [SPOKEN_REQUEST, message({ id: "m-answer", sender: AI_SENDER, taskId: "task-1" })],
        [VOICE_TASK]
      );

      expect(body).toContain("_No answer was recorded for this task._");
    });
  });

  describe("readSnapshotComment()", () => {
    it("restores messages, task records, and the delivery cursor from a saved chat", () => {
      const { result } = roundTrip(mixedConversation());

      expect(result).toEqual({
        status: "restored",
        conversation: {
          conversationId: "conv-1",
          messages: [SPOKEN_REQUEST, TASK_ANSWER],
          tasks: [VOICE_TASK],
          contextDelivery: { delivered: ["m-spoken"], uncertain: [] },
        },
      });
    });

    it("restores the answer a task card hides from the readable transcript", () => {
      const { body, result } = roundTrip(mixedConversation());

      expect(body).not.toContain("**ai**: Two notes mention it");
      expect(result.status).toBe("restored");
      if (result.status !== "restored") throw new Error("expected a restored snapshot");
      expect(result.conversation.messages.map((m) => m.message)).toContain(
        "Two notes mention it: Retro 2024-05 and Team norms."
      );
    });

    it("keeps spoken fragment ranges attached to the entry they produced", () => {
      const { result } = roundTrip(mixedConversation());

      if (result.status !== "restored") throw new Error("expected a restored snapshot");
      expect(result.conversation.messages[0].sourceRanges).toEqual([
        { fragmentId: "frag-7", startMs: 1200, endMs: 3400 },
      ]);
    });

    it("reloads a task that never settled as interrupted rather than still running", () => {
      const { result } = roundTrip(
        mixedConversation({ tasks: [task({ ...VOICE_TASK, state: "running" })] })
      );

      if (result.status !== "restored") throw new Error("expected a restored snapshot");
      expect(result.conversation.tasks[0].state).toBe("interrupted");
    });

    it("reloads a task saved while waiting for approval as interrupted history", () => {
      const { result } = roundTrip(
        mixedConversation({ tasks: [task({ ...VOICE_TASK, state: "awaiting-user" })] })
      );

      if (result.status !== "restored") throw new Error("expected a restored snapshot");
      expect(result.conversation.tasks[0].state).toBe("interrupted");
    });

    it("keeps a settled task's own terminal state", () => {
      const { result } = roundTrip(
        mixedConversation({ tasks: [task({ ...VOICE_TASK, state: "cancelled" })] })
      );

      if (result.status !== "restored") throw new Error("expected a restored snapshot");
      expect(result.conversation.tasks[0].state).toBe("cancelled");
    });

    it("survives message text that imitates the transcript's own markers and comments", () => {
      const adversarial = message({
        id: "m-adversarial",
        origin: "voice-user",
        voiceSessionId: "voice-1",
        message:
          "**user**: not a real row\n[Timestamp: 1999/01/01 00:00:00]\n" +
          "<!-- copilot-agent-chat:2 ZmFrZQ== --> and a stray --> too",
      });
      const { result } = roundTrip(
        mixedConversation({
          messages: [adversarial],
          tasks: [],
          contextDelivery: EMPTY_CONTEXT_DELIVERY,
        })
      );

      if (result.status !== "restored") throw new Error("expected a restored snapshot");
      expect(result.conversation.messages).toEqual([adversarial]);
    });

    it("reports the structured history unavailable when the visible body was hand-edited", () => {
      const { split } = roundTrip(mixedConversation());

      const result = readSnapshotComment(
        split.encoded ?? "",
        `${split.visibleBody}\n\n**user**: a line the user typed into the note`
      );

      expect(result).toEqual({ status: "unavailable", reason: "digest-mismatch" });
    });

    it("reports the structured history unavailable when the payload is not valid base64 JSON", () => {
      const result = readSnapshotComment("bm90LWpzb24=", "**user**: hi");

      expect(result).toEqual({ status: "unavailable", reason: "unreadable" });
    });

    it("reports the structured history unavailable when a saved message lost its identity", () => {
      const visibleBody = "**user**: hi\n[Timestamp: 2023/11/14 22:13:20]";
      const encoded = encodeSnapshot({
        schema: AGENT_CHAT_SCHEMA_VERSION,
        conversationId: "conv-1",
        bodyDigest: sha256(visibleBody),
        messages: [{ sender: USER_SENDER, text: "hi" }],
        tasks: [],
        contextDelivery: EMPTY_CONTEXT_DELIVERY,
      });

      expect(readSnapshotComment(encoded, visibleBody)).toEqual({
        status: "unavailable",
        reason: "unreadable",
      });
    });

    it("refuses to interpret a snapshot written by a newer Copilot", () => {
      const visibleBody = "**user**: hi\n[Timestamp: 2023/11/14 22:13:20]";
      const encoded = encodeSnapshot({
        schema: AGENT_CHAT_SCHEMA_VERSION + 1,
        conversationId: "conv-1",
        bodyDigest: sha256(visibleBody),
        messages: [],
        tasks: [],
        contextDelivery: EMPTY_CONTEXT_DELIVERY,
      });

      expect(readSnapshotComment(encoded, visibleBody)).toEqual({
        status: "unsupported-schema",
        schema: AGENT_CHAT_SCHEMA_VERSION + 1,
      });
    });
  });

  describe("splitSnapshotComment()", () => {
    it("returns the body unchanged when no metadata comment was written", () => {
      const body = "**user**: hello\n[Timestamp: 2023/11/14 22:13:20]";

      expect(splitSnapshotComment(body)).toEqual({
        visibleBody: body,
        encoded: null,
        schema: null,
      });
    });

    it("separates the trailing metadata comment from the readable transcript", () => {
      const { body, split } = roundTrip(mixedConversation());

      expect(split.schema).toBe(AGENT_CHAT_SCHEMA_VERSION);
      expect(split.encoded).toBeTruthy();
      expect(split.visibleBody).toBe(
        renderMixedChatBody([SPOKEN_REQUEST, TASK_ANSWER], [VOICE_TASK])
      );
      expect(body.endsWith(" -->")).toBe(true);
    });

    it("takes the writer's own trailing comment, not a look-alike inside a message", () => {
      const { split } = roundTrip(
        mixedConversation({
          messages: [
            message({
              id: "m-fake",
              origin: "voice-user",
              message: "<!-- copilot-agent-chat:2 ZmFrZQ== -->",
            }),
          ],
          tasks: [],
        })
      );

      expect(split.visibleBody).toContain("<!-- copilot-agent-chat:2 ZmFrZQ== -->");
      expect(split.encoded).not.toBe("ZmFrZQ==");
    });
  });
});

// Helpers for hand-built payloads that the public writer would never produce.
function encodeSnapshot(snapshot: unknown): string {
  return Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64");
}
