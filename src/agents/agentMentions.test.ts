import { restoreAgentMentions, withoutAgentChats } from "@/agents/agentMentions";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/944";
const CONTROL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/945";
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const CHAT = { backendId: "codex", sessionId: "thread-1" };

describe("agentMentions", () => {
  describe("restoreAgentMentions()", () => {
    it(`keeps a finished, stopped or unfinished run as it was saved, with its hidden chat (${ISSUE})`, () => {
      const saved = [
        { id: "a", agent: "maya", name: "Maya", status: "finished", startedAt: 1, chat: CHAT },
        { id: "b", agent: "leo", name: "Leo", status: "stopped", startedAt: 1 },
        { id: "c", agent: "nora", name: "Nora", status: "didnt_finish", startedAt: 1 },
      ];

      expect(restoreAgentMentions(saved)).toEqual(saved);
    });

    it(`still reads a run saved with the end time and reason the chat no longer shows (${CARDS})`, () => {
      const saved = [
        {
          id: "a",
          agent: "maya",
          name: "Maya",
          status: "finished",
          startedAt: 1,
          endedAt: 2,
          chat: CHAT,
        },
        {
          id: "b",
          agent: "leo",
          name: "Leo",
          status: "stopped",
          startedAt: 1,
          endedAt: 3,
          end: { kind: "agent_deleted" },
        },
        {
          id: "c",
          agent: "nora",
          name: "Nora",
          status: "didnt_finish",
          startedAt: 1,
          endedAt: 4,
          end: { kind: "error", message: "Sonnet 5.5 hit its usage limit" },
        },
      ];

      expect(restoreAgentMentions(saved)).toEqual(saved);
    });

    it(`reads a run still working, asking a question or waiting for an OK when its chat was saved as one that didn't finish because Obsidian closed (${ISSUE})`, () => {
      const restored = restoreAgentMentions(
        ["working", "question", "permission"].map((status) => ({
          id: status,
          agent: "maya",
          name: "Maya",
          status,
          startedAt: 1,
          chat: CHAT,
        }))
      );

      expect(restored.map(({ status }) => status)).toEqual(Array(3).fill("didnt_finish"));
      expect(restored[0].chat).toEqual(CHAT);
    });

    it("drops entries it cannot read and reads anything but a list as none", () => {
      expect(
        restoreAgentMentions([
          null,
          "x",
          { id: "a", agent: "maya", name: "Maya", status: "sleeping", startedAt: 1 },
          { id: "b", agent: "maya", name: "Maya", status: "finished" },
          { id: 3, agent: "maya", name: "Maya", status: "finished", startedAt: 1 },
          { id: "c", agent: "maya", status: "finished", startedAt: 1 },
        ])
      ).toEqual([]);
      expect(restoreAgentMentions({ id: "a" })).toEqual([]);
      expect(restoreAgentMentions(undefined)).toEqual([]);
    });

    it(`drops a run whose hidden chat a hand edit left in the wrong shape (${ISSUE})`, () => {
      const run = { id: "a", agent: "maya", name: "Maya", status: "stopped", startedAt: 1 };

      expect(
        restoreAgentMentions([
          { ...run, chat: null },
          { ...run, chat: { backendId: "claude" } },
        ])
      ).toEqual([]);
    });
  });

  describe("withoutAgentChats()", () => {
    it(`keeps each run on a message but forgets its hidden chat, so a continued chat asks the agent in a chat of its own (${CONTROL})`, () => {
      const run = {
        id: "a",
        agent: "maya",
        name: "Maya",
        status: "finished" as const,
        startedAt: 1,
      };
      const message = {
        id: "u1",
        message: "@Maya check this.",
        agentMentions: [{ ...run, chat: CHAT }],
      };

      expect(withoutAgentChats(message)).toEqual({ ...message, agentMentions: [run] });
      expect(message.agentMentions[0].chat).toBe(CHAT);
    });

    it("returns a message without runs as it is", () => {
      const message = { id: "a1", message: "Done.", agentMentions: undefined };

      expect(withoutAgentChats(message)).toBe(message);
    });
  });
});
