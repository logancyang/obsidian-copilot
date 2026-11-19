import type { AgentMention } from "@/agents/agentMentions";
import { formatRunTime, mentionStatusLine } from "@/agents/agentMentionStatus";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const STARTED = Date.parse("2026-11-16T10:02:00Z");
const MINUTES = 60_000;

function run(change: Partial<AgentMention>): AgentMention {
  return { id: "m1", agent: "leo", name: "Leo", status: "working", startedAt: STARTED, ...change };
}

describe("agentMentionStatus", () => {
  describe("formatRunTime()", () => {
    it("writes minutes and seconds under an hour", () => {
      expect(formatRunTime(0)).toBe("0:00");
      expect(formatRunTime(3 * MINUTES + 12_400)).toBe("3:12");
    });

    it("writes hours, minutes and seconds from an hour on", () => {
      expect(formatRunTime(62 * MINUTES + 10_000)).toBe("1:02:10");
    });
  });

  describe("mentionStatusLine()", () => {
    it(`says the agent is working, with a clock that keeps counting (${ISSUE})`, () => {
      expect(mentionStatusLine(run({}))).toEqual({
        text: "Leo is working",
        tone: "working",
        clock: "ticking",
        seeReply: false,
      });
    });

    it.each([
      ["question", "Leo has a question"],
      ["permission", "Leo needs your OK"],
    ] as const)(`says a %s waits for the user, with the clock held (${ISSUE})`, (status, text) => {
      expect(mentionStatusLine(run({ status }))).toEqual({
        text,
        tone: "waiting",
        clock: "held",
        seeReply: false,
      });
    });

    it(`says the agent finished, with how long it took and a way to its reply (${ISSUE})`, () => {
      expect(
        mentionStatusLine(run({ status: "finished", endedAt: STARTED + 12 * MINUTES }))
      ).toEqual({
        text: "Leo finished",
        tone: "finished",
        elapsedMs: 12 * MINUTES,
        seeReply: true,
      });
    });

    it(`says the user stopped the agent, with how long it ran (${ISSUE})`, () => {
      expect(
        mentionStatusLine(
          run({
            status: "stopped",
            endedAt: STARTED + 6 * MINUTES,
            end: { kind: "stopped_by_user" },
          })
        )
      ).toEqual({
        text: "Leo stopped",
        tone: "stopped",
        elapsedMs: 6 * MINUTES,
        seeReply: false,
      });
    });

    it(`says a deleted agent stopped because it was deleted (${ISSUE})`, () => {
      expect(
        mentionStatusLine(
          run({ status: "stopped", endedAt: STARTED + MINUTES, end: { kind: "agent_deleted" } })
        ).text
      ).toBe("Leo stopped · Leo was deleted");
    });

    it(`says the agent didn't finish because Obsidian was closed, without a clock (${ISSUE})`, () => {
      expect(
        mentionStatusLine(run({ status: "didnt_finish", end: { kind: "obsidian_closed" } }))
      ).toEqual({
        text: "Leo didn't finish · Obsidian was closed",
        tone: "failed",
        seeReply: false,
      });
    });

    it(`says something went wrong and keeps the error for Details (${ISSUE})`, () => {
      expect(
        mentionStatusLine(
          run({
            status: "didnt_finish",
            endedAt: STARTED + MINUTES,
            end: { kind: "error", message: "Leo couldn't be loaded." },
          })
        )
      ).toMatchObject({
        text: "Leo didn't finish · Something went wrong",
        details: "Leo couldn't be loaded.",
        tone: "failed",
      });
    });

    it.each([
      [["Edit Plans/Launch plan.md"], "Leo didn't finish · Copilot turned down a request"],
      [
        ["Edit Plans/Launch plan.md", "Write Plans/Budget.md"],
        "Leo didn't finish · Copilot turned down 2 requests",
      ],
    ])(
      `says Copilot turned down the agent's changes and lists them for Details (${ISSUE})`,
      (requests, text) => {
        expect(
          mentionStatusLine(
            run({ status: "didnt_finish", end: { kind: "permission_denied", requests } })
          )
        ).toMatchObject({ text, details: requests.join("\n") });
      }
    );
  });
});
