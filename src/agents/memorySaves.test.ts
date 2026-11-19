import { readMemoryRules, readMemorySaves, readTurnMemorySaves } from "@/agents/memorySaves";

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

  describe("readMemorySaves()", () => {
    it("reads the first save, which creates the file, as one remembered rule", () => {
      expect(readMemorySaves(null, memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`]))).toEqual([
        { rule: LAUNCH },
      ]);
    });

    it("reads a rule added under either heading as remembered, leaving the rules already there out", () => {
      const before = memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`]);

      expect(
        readMemorySaves(
          before,
          memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`, `${LINKS}\n${LINKS_CONTEXT}`])
        )
      ).toEqual([{ rule: LINKS }]);
      expect(
        readMemorySaves(
          before,
          memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`], [`${MEETINGS}\n${MEETINGS_CONTEXT}`])
        )
      ).toEqual([{ rule: MEETINGS }]);
    });

    it("reads a replacement as the new rule with the old rule it quotes in its context line (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      const before = memory([
        `${LAUNCH}\n${LAUNCH_CONTEXT}`,
        "Summarize as bullet points.\n2026-11-03 · Asked for bullets",
      ]);
      const after = memory([
        `${LAUNCH}\n${LAUNCH_CONTEXT}`,
        'Write summaries as short paragraphs, no bullet points.\n2026-11-16 · Replaces "Summarize as bullet points." (2026-11-03)',
      ]);

      expect(readMemorySaves(before, after)).toEqual([
        {
          rule: "Write summaries as short paragraphs, no bullet points.",
          replaced: "Summarize as bullet points.",
        },
      ]);
    });

    it("pairs a replacement whose context line names the old rule loosely with the one rule it removed (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      const before = memory(["Summarize as bullet points.\n2026-11-03 · Asked for bullets"]);
      const after = memory([
        "Write summaries as short paragraphs.\n2026-11-16 · Replaces the bullet-point rule (2026-11-03)",
      ]);

      expect(readMemorySaves(before, after)).toEqual([
        { rule: "Write summaries as short paragraphs.", replaced: "Summarize as bullet points." },
      ]);
    });

    it("reads each rule of several edits in one turn, pairing only the replacement with the rule it removed", () => {
      const before = memory(["Summarize as bullet points.\n2026-11-03 · Asked for bullets"]);
      const after = memory(
        [
          'Write summaries as short paragraphs.\n2026-11-16 · Replaces "Summarize as bullet points." (2026-11-03)',
          `${LINKS}\n${LINKS_CONTEXT}`,
        ],
        [`${MEETINGS}\n${MEETINGS_CONTEXT}`]
      );

      expect(readMemorySaves(before, after)).toEqual([
        { rule: "Write summaries as short paragraphs.", replaced: "Summarize as bullet points." },
        { rule: LINKS },
        { rule: MEETINGS },
      ]);
    });

    it("reads the instruction sentence a rule goes against from its context line's marker (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      const after = memory([
        'Taxes are Leo\'s job now. Point tax questions to Leo.\n2026-11-16 · Said while planning Q4 · Contradicts instruction: "File quarterly estimated taxes."',
      ]);

      expect(readMemorySaves(null, after)).toEqual([
        {
          rule: "Taxes are Leo's job now. Point tax questions to Leo.",
          contradicts: "File quarterly estimated taxes.",
        },
      ]);
    });

    it("reads a contradiction marker written with curly quotes, none, or the prompt's closing period after the quote", () => {
      const rule = (context: string) => memory([`Taxes go to Leo.\n2026-11-16 · ${context}`]);

      expect(
        readMemorySaves(null, rule("Contradicts instruction: “File quarterly taxes.”"))
      ).toEqual([{ rule: "Taxes go to Leo.", contradicts: "File quarterly taxes." }]);
      expect(readMemorySaves(null, rule("Contradicts instruction: File quarterly taxes."))).toEqual(
        [{ rule: "Taxes go to Leo.", contradicts: "File quarterly taxes." }]
      );
      expect(
        readMemorySaves(null, rule('Contradicts instruction: "File quarterly taxes.".'))
      ).toEqual([{ rule: "Taxes go to Leo.", contradicts: "File quarterly taxes." }]);
    });

    it("reads no save from an edit that only reformats: spacing, line endings, moved rules or a changed context line", () => {
      const before = memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`, `${LINKS}\n${LINKS_CONTEXT}`]);
      const reformatted = `## How to work\r\n\r\n${LINKS.replace(" a ", "  a ")}  \r\n2026-11-17 · Reworded\r\n\r\n\r\n## Where to find things\r\n\r\n${LAUNCH}\r\n${LAUNCH_CONTEXT}\r\n`;

      expect(readMemorySaves(before, reformatted)).toEqual([]);
    });

    it("reads no save when the turn only removed a rule, as when the user deleted one by hand", () => {
      const before = memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`, `${LINKS}\n${LINKS_CONTEXT}`]);

      expect(readMemorySaves(before, memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`]))).toEqual([]);
      expect(readMemorySaves(before, null)).toEqual([]);
    });
  });

  describe("readTurnMemorySaves()", () => {
    const COCO = { agentName: "Coco", memoryPath: "copilot/agents/coco/MEMORY.md" };

    it("names the agent and its MEMORY.md on each rule its turn saved", () => {
      const changes = [
        { path: "notes/plan.md", before: "a", after: "b" },
        { path: COCO.memoryPath, before: null, after: memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`]) },
      ];

      expect(readTurnMemorySaves(changes, COCO)).toEqual([{ ...COCO, rule: LAUNCH }]);
    });

    it("reads no save from a turn that changed another agent's MEMORY.md and not its own", () => {
      const changes = [
        {
          path: "copilot/agents/maya/MEMORY.md",
          before: null,
          after: memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`]),
        },
      ];

      expect(readTurnMemorySaves(changes, COCO)).toEqual([]);
    });
  });
});
