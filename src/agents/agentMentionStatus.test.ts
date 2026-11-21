import type { AgentMention } from "@/agents/agentMentions";
import { runningAgentsLine } from "@/agents/agentMentionStatus";

const ISSUE_948 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/948";
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const STARTED = Date.parse("2026-11-16T10:02:00Z");

function run(change: Partial<AgentMention>): AgentMention {
  return { id: "m1", agent: "leo", name: "Leo", status: "working", startedAt: STARTED, ...change };
}

describe("agentMentionStatus", () => {
  describe("runningAgentsLine()", () => {
    const named = (name: string, change: Partial<AgentMention> = {}) =>
      run({ id: name, agent: name.toLowerCase(), name, ...change });

    it(`says one working agent is working, without a clock (${CARDS})`, () => {
      expect(runningAgentsLine([named("Maya")], 0)).toEqual({
        text: "Maya is working",
        waiting: false,
      });
    });

    it.each([
      [["Maya", "Leo"], "Maya and Leo are working"],
      [["Maya", "Leo", "Nora"], "Maya, Leo and Nora are working"],
      [["Maya", "Leo", "Nora", "Coco"], "4 teammates are working"],
    ])(`names several working agents, and counts four or more (${ISSUE_948})`, (names, text) => {
      expect(
        runningAgentsLine(
          names.map((name) => named(name)),
          0
        )
      ).toEqual({ text, waiting: false });
    });

    it.each([
      ["question", "Leo is waiting for you"],
      ["permission", "Leo needs your OK"],
    ] as const)(
      `puts an agent that waits on a %s first and marks the line waiting (${ISSUE_948})`,
      (status, waitingText) => {
        expect(runningAgentsLine([named("Maya"), named("Leo", { status })], 0)).toEqual({
          text: `${waitingText} · Maya is working`,
          waiting: true,
        });
      }
    );

    it(`says a lone agent waits on the user (${ISSUE_948})`, () => {
      expect(runningAgentsLine([named("Leo", { status: "question" })], 0)).toEqual({
        text: "Leo is waiting for you",
        waiting: true,
      });
    });

    it(`names several waiting agents together, whatever each waits on (${ISSUE_948})`, () => {
      expect(
        runningAgentsLine(
          [named("Leo", { status: "question" }), named("Maya", { status: "permission" })],
          0
        ).text
      ).toBe("Leo and Maya are waiting for you");
    });

    it.each([
      [1, "Leo is working · 1 task"],
      [2, "Leo is working · 2 tasks"],
    ])(`adds the count of the chat's own tasks after the agents (${ISSUE_948})`, (tasks, text) => {
      expect(runningAgentsLine([named("Leo")], tasks)).toEqual({ text, waiting: false });
    });
  });
});
