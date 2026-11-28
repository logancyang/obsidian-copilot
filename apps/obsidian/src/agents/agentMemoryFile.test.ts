import {
  localDate,
  saveMemoryRule,
  writeMemoryRule,
  type RuleToSave,
} from "@/agents/agentMemoryFile";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";

const ISSUE_988 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/988";
const TODAY = "2026-11-19";
const LAUNCH = "Launch videos lead with user value, not the feature list.";
const LAUNCH_CONTEXT = "2026-11-16 · Asked to remember while planning the launch video";
const LINKS = "When a reply mentions a GitHub issue, link it to the issue on GitHub.";
const LINKS_CONTEXT = "2026-11-16 · Correction on the 4.0.21 release notes";
const MEETINGS = "Meeting notes are in meeting-notes/, one note per meeting.";
const MEETINGS_CONTEXT = "2026-10-21 · Said while looking for last week's notes";
const BRIEF = "Keep replies under five sentences.";

function toSave(rule: string, why = "Asked to remember"): RuleToSave {
  return { rule, why };
}

function memory(rules: string[]): string {
  return `${rules.join("\n\n")}\n`;
}

function sectioned(howTo: string[], whereToFind: string[] = []): string {
  return `## How to work\n\n${howTo.join("\n\n")}\n\n## Where to find things\n\n${whereToFind.join("\n\n")}\n`;
}

describe("agentMemoryFile", () => {
  describe("localDate()", () => {
    it("writes a date as YYYY-MM-DD in local time", () => {
      expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    });
  });

  describe("writeMemoryRule()", () => {
    it(`adds a rule at the end of the memory after one blank line, with today's date and why it came up (${ISSUE_988})`, () => {
      expect(
        writeMemoryRule(
          memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`, `${MEETINGS}\n${MEETINGS_CONTEXT}`]),
          toSave(BRIEF),
          TODAY
        )
      ).toEqual({
        text: memory([
          `${LAUNCH}\n${LAUNCH_CONTEXT}`,
          `${MEETINGS}\n${MEETINGS_CONTEXT}`,
          `${BRIEF}\n${TODAY} · Asked to remember`,
        ]),
      });
    });

    it(`starts an empty or missing memory with just the rule and its date line, no headings (${ISSUE_988})`, () => {
      expect(writeMemoryRule("", toSave(BRIEF), TODAY)).toEqual({
        text: `${BRIEF}\n${TODAY} · Asked to remember\n`,
      });
      expect(writeMemoryRule("\n\n", toSave(MEETINGS, "Said"), TODAY)).toEqual({
        text: `${MEETINGS}\n${TODAY} · Said\n`,
      });
    });

    it(`adds to a memory written with the two headings at its end, under the last heading, and adds no heading (${ISSUE_988})`, () => {
      const before = sectioned(
        [`${LAUNCH}\n${LAUNCH_CONTEXT}`],
        [`${MEETINGS}\n${MEETINGS_CONTEXT}`]
      );

      expect(writeMemoryRule(before, toSave(BRIEF), TODAY)).toEqual({
        text: `${before}\n${BRIEF}\n${TODAY} · Asked to remember\n`,
      });
      expect(
        writeMemoryRule("## How to work\n\n## Where to find things\n", toSave(BRIEF), TODAY)
      ).toEqual({
        text: `## How to work\n\n## Where to find things\n\n${BRIEF}\n${TODAY} · Asked to remember\n`,
      });
    });

    it(`replaces one rule and its context line in place, naming the old rule and its date, and leaves every other line as it was, under a heading or not (${ISSUE_988})`, () => {
      const shorter = "Launch videos lead with one user story.";
      const replaced = `${shorter}\n${TODAY} · Replaces "${LAUNCH}" (2026-11-16) · Corrected`;

      expect(
        writeMemoryRule(
          memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`, `${LINKS}\n${LINKS_CONTEXT}`]),
          { ...toSave(shorter, "Corrected"), replaces: ` ${LAUNCH} ` },
          TODAY
        )
      ).toEqual({ text: memory([replaced, `${LINKS}\n${LINKS_CONTEXT}`]), replaced: LAUNCH });
      expect(
        writeMemoryRule(
          sectioned(
            [`${LAUNCH}\n${LAUNCH_CONTEXT}`, `${LINKS}\n${LINKS_CONTEXT}`],
            [`${MEETINGS}\n${MEETINGS_CONTEXT}`]
          ),
          { ...toSave(shorter, "Corrected"), replaces: LAUNCH },
          TODAY
        )
      ).toEqual({
        text: sectioned(
          [replaced, `${LINKS}\n${LINKS_CONTEXT}`],
          [`${MEETINGS}\n${MEETINGS_CONTEXT}`]
        ),
        replaced: LAUNCH,
      });
    });

    it(`can't drop other rules: a save changes only the lines of the one rule it adds or replaces, however many rules the file holds (${ISSUE_988})`, () => {
      const rules = [LAUNCH, LINKS, BRIEF, "Use British spelling.", "Always answer in French."];
      const before = memory(rules.map((rule) => `${rule}\n2026-11-01 · Said`));
      const written = writeMemoryRule(
        before,
        { ...toSave("Answer in English."), replaces: "Always answer in French." },
        TODAY
      );

      const lines = written?.text.split("\n") ?? [];
      const old = before.split("\n");
      expect(lines.filter((line, index) => line !== old[index])).toEqual([
        "Answer in English.",
        `${TODAY} · Replaces "Always answer in French." (2026-11-01) · Asked to remember`,
      ]);
      expect(lines).toHaveLength(old.length);
    });

    it(`ends the context line with the instruction sentence a rule goes against, in the marker the chat reads (${ISSUE_988})`, () => {
      expect(
        writeMemoryRule(
          "",
          {
            ...toSave("Taxes are Leo's job now.", "Said while planning Q4"),
            contradicts: "File quarterly estimated taxes.",
          },
          TODAY
        )
      ).toEqual({
        text: `Taxes are Leo's job now.\n${TODAY} · Said while planning Q4 · Contradicts instruction: "File quarterly estimated taxes."\n`,
      });
    });

    it(`writes nothing when the rule to replace isn't in it (${ISSUE_988})`, () => {
      const before = memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`, `${MEETINGS}\n${MEETINGS_CONTEXT}`]);

      expect(
        writeMemoryRule(before, { ...toSave(BRIEF), replaces: "Keep replies short." }, TODAY)
      ).toBeNull();
      expect(writeMemoryRule("", { ...toSave(BRIEF), replaces: LAUNCH }, TODAY)).toBeNull();
    });

    it(`keeps a file the user reshaped by hand: adds at its end, with no heading, and replaces a rule that has no context line, touching nothing else (${ISSUE_988})`, () => {
      const byHand = `# My agent's memory\n\n- ${LAUNCH}\nSome notes the user keeps here.`;

      expect(writeMemoryRule(byHand, toSave(BRIEF), TODAY)).toEqual({
        text: `${byHand}\n\n${BRIEF}\n${TODAY} · Asked to remember\n`,
      });
      expect(writeMemoryRule(`## How we work\n\n${LAUNCH}\n`, toSave(BRIEF), TODAY)).toEqual({
        text: `## How we work\n\n${LAUNCH}\n\n${BRIEF}\n${TODAY} · Asked to remember\n`,
      });
      expect(writeMemoryRule(byHand, { ...toSave(BRIEF), replaces: `- ${LAUNCH}` }, TODAY)).toEqual(
        {
          text: `# My agent's memory\n\n${BRIEF}\n${TODAY} · Replaces "- ${LAUNCH}" · Asked to remember\nSome notes the user keeps here.`,
          replaced: `- ${LAUNCH}`,
        }
      );
    });

    it("keeps Windows line endings", () => {
      const crlf = (text: string) => text.replace(/\n/g, "\r\n");

      expect(
        writeMemoryRule(crlf(memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`])), toSave(BRIEF), TODAY)
      ).toEqual({
        text: crlf(
          memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`, `${BRIEF}\n${TODAY} · Asked to remember`])
        ),
      });
    });

    it(`replaces the named rule, and drops no other, in a file whose lines end partly in Windows and partly in Unix line endings (${ISSUE_988})`, () => {
      const mixed = `## How to work\n\n${LAUNCH}\n${LAUNCH_CONTEXT}\n\n${LINKS}\r\n${LINKS_CONTEXT}\r\n\r\n${BRIEF}\r\n2026-11-01 · Said\r\n`;

      expect(
        writeMemoryRule(
          mixed,
          { ...toSave("Launch videos run a minute."), replaces: LAUNCH },
          TODAY
        )
      ).toEqual({
        text: `## How to work\r\n\r\nLaunch videos run a minute.\r\n${TODAY} · Replaces "${LAUNCH}" (2026-11-16) · Asked to remember\r\n\r\n${LINKS}\r\n${LINKS_CONTEXT}\r\n\r\n${BRIEF}\r\n2026-11-01 · Said\r\n`,
        replaced: LAUNCH,
      });
    });
  });

  describe("saveMemoryRule()", () => {
    const PATH = "copilot/teammates/coco/MEMORY.md";

    it("creates a missing memory file through the vault with the saved rule", async () => {
      const vault = createFakeAgentVault();

      await saveMemoryRule(vault.app.vault, PATH, toSave(BRIEF), TODAY);

      expect(vault.readText(PATH)).toBe(`${BRIEF}\n${TODAY} · Asked to remember\n`);
    });

    it("adds to an existing memory file in place and says which rule a replacement replaced", async () => {
      const vault = createFakeAgentVault();
      vault.writeByHand(PATH, memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`]));

      await saveMemoryRule(vault.app.vault, PATH, toSave(BRIEF), TODAY);
      const replaced = await saveMemoryRule(
        vault.app.vault,
        PATH,
        { ...toSave(LINKS), replaces: BRIEF },
        TODAY
      );

      expect(replaced).toMatchObject({ replaced: BRIEF });
      expect(vault.readText(PATH)).toBe(
        memory([
          `${LAUNCH}\n${LAUNCH_CONTEXT}`,
          `${LINKS}\n${TODAY} · Replaces "${BRIEF}" (${TODAY}) · Asked to remember`,
        ])
      );
    });

    it("leaves the file as it was, and creates none, when the rule to replace isn't there", async () => {
      const vault = createFakeAgentVault();
      const before = memory([`${LAUNCH}\n${LAUNCH_CONTEXT}`]);
      vault.writeByHand(PATH, before);
      const replacing = { ...toSave(BRIEF), replaces: "Keep replies short." };

      await expect(saveMemoryRule(vault.app.vault, PATH, replacing, TODAY)).resolves.toBeNull();
      await saveMemoryRule(vault.app.vault, "copilot/teammates/maya/MEMORY.md", replacing, TODAY);

      expect(vault.readText(PATH)).toBe(before);
      expect(vault.listPaths()).toEqual([PATH]);
    });
  });
});
