import { readMemoryRules, sameRule, withoutEndedRules } from "@/agents/memorySaves";

const LAUNCH = "Launch videos lead with user value, not the feature list.";
const LAUNCH_CONTEXT = "2026-11-16 · Asked to remember while planning the launch video";
const LINKS = "When a reply mentions a GitHub issue, link it to the issue on GitHub.";
const LINKS_CONTEXT = "2026-11-16 · Correction on the 4.0.21 release notes";
const MEETINGS = "Meeting notes are in meeting-notes/, one note per meeting.";
const MEETINGS_CONTEXT = "2026-10-21 · Said while looking for last week's notes";

function memory(howToWork: string[], whereToFind: string[] = []): string {
  return `## How to work\n\n${howToWork.join("\n\n")}\n\n## Where to find things\n\n${whereToFind.join("\n\n")}\n`;
}

describe("memorySaves", () => {
  describe("readMemoryRules()", () => {
    it("lists each rule under either heading with its context line and its line in the file", () => {
      const text = memory(
        [`${LAUNCH}\n${LAUNCH_CONTEXT}`, `${LINKS}\n${LINKS_CONTEXT}`],
        [`${MEETINGS}\n${MEETINGS_CONTEXT}`]
      );

      expect(readMemoryRules(text)).toEqual([
        { rule: LAUNCH, context: LAUNCH_CONTEXT, line: 2 },
        { rule: LINKS, context: LINKS_CONTEXT, line: 5 },
        { rule: MEETINGS, context: MEETINGS_CONTEXT, line: 10 },
      ]);
    });

    it("keeps a rule the user wrote by hand without a context line", () => {
      expect(readMemoryRules(`## How to work\n\n${LAUNCH}\n${LINKS}\n`)).toEqual([
        { rule: LAUNCH, context: "", line: 2 },
        { rule: LINKS, context: "", line: 3 },
      ]);
    });

    it("finds no rules in a missing or empty file, or one with only its headings", () => {
      expect(readMemoryRules("")).toEqual([]);
      expect(readMemoryRules(memory([]))).toEqual([]);
    });
  });

  describe("sameRule()", () => {
    it("reads two spellings of a rule that differ only in spacing or line breaks as the same rule", () => {
      expect(sameRule(" Answer in  French.\n")).toBe(sameRule("Answer in French."));
      expect(sameRule("Answer in French.")).not.toBe(sameRule("Answer in English."));
    });
  });

  describe("withoutEndedRules()", () => {
    it("leaves out a rule whose Until date has passed, with its context line, and keeps every other line (https://github.com/Brevilabs/obsidian-copilot-private/issues/988)", () => {
      const ended = "Until 2026-11-18: Flag the budget first.";
      const text = memory([`${ended}\n2026-11-01 · Budget week`, `${LAUNCH}\n${LAUNCH_CONTEXT}`]);

      expect(withoutEndedRules(text, "2026-11-19")).toBe(
        `## How to work\n\n\n${LAUNCH}\n${LAUNCH_CONTEXT}\n\n## Where to find things\n\n\n`
      );
    });

    it("keeps a rule until the end of its Until date, a rule with no date, and returns the text unchanged when nothing ended", () => {
      const text = memory([
        `Until 2026-11-19: Flag the budget first.\n2026-11-01 · Budget week`,
        `${LAUNCH}\n${LAUNCH_CONTEXT}`,
      ]);

      expect(withoutEndedRules(text, "2026-11-19")).toBe(text);
    });

    it("leaves out an ended rule the user wrote by hand without a context line", () => {
      expect(withoutEndedRules(`Until 2020-01-01: Old rule.\n${LAUNCH}\n`, "2026-11-19")).toBe(
        `${LAUNCH}\n`
      );
    });
  });
});
