import { getBuiltinEnabledAgents, getBuiltinSkillVersion } from "./builtinOwnership";

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
const SYNC_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/1031";
const conflicted = (ours: string, theirs: string) =>
  `---\nname: obsidian-bases\nmetadata:\n<<<<<<< HEAD\n${ours}=======\n${theirs}>>>>>>> other-device\n---\nbody`;
describe("builtinOwnership", () => {
  describe("getBuiltinSkillVersion()", () => {
    it(`recognizes string and numeric versions in YAML metadata ${ISSUE}`, () => {
      for (const marker of ['"3"', "3"]) {
        expect(
          getBuiltinSkillVersion(`---\nmetadata:\n  copilot-builtin-version: ${marker}\n---\nbody`)
        ).toBe(3);
      }
    });
    it(`does not claim body examples, top-level fields, malformed YAML, or invalid versions ${ISSUE}`, () => {
      for (const content of [
        'copilot-builtin-version: "1"',
        '---\nname: user-skill\n---\nExample:\ncopilot-builtin-version: "1"',
        '---\ncopilot-builtin-version: "1"\n---\nbody',
        "---\nmetadata: [\n---\nbody",
        "---\nmetadata:\n  copilot-builtin-version: true\n---\nbody",
        '---\nmetadata:\n  copilot-builtin-version: "bad"\n---\nbody',
        "---\nmetadata:\n  copilot-builtin-version: 99999999999999999\n---\nbody",
      ])
        expect(getBuiltinSkillVersion(content)).toBeNull();
    });
    it(`reports version 0 for a sync conflict whose every side carries the marker, so the copy is reinstalled ${SYNC_ISSUE}`, () => {
      const marked = (agents: string, version: string) =>
        `  copilot-enabled-agents: ${agents}\n  copilot-builtin-version: "${version}"\n`;
      expect(
        getBuiltinSkillVersion(conflicted(marked("claude", "4"), marked("opencode", "3")))
      ).toBe(0);
      expect(
        getBuiltinSkillVersion(
          `---\nmetadata:\n  copilot-builtin-version: "4"\n---\n<<<<<<< HEAD\nA\n||||||| base\nB\n=======\nC\n>>>>>>> other\n`
        )
      ).toBe(0);
    });
    it(`does not claim a sync conflict when any side lacks the marker ${SYNC_ISSUE}`, () => {
      expect(
        getBuiltinSkillVersion(conflicted('  copilot-builtin-version: "4"\n', "  author: me\n"))
      ).toBeNull();
    });
  });
  describe("getBuiltinEnabledAgents()", () => {
    it(`lists the agents a marked skill names, sorted ${SYNC_ISSUE}`, () => {
      expect(
        getBuiltinEnabledAgents(
          '---\nmetadata:\n  copilot-enabled-agents: opencode, claude\n  copilot-builtin-version: "4"\n---\n'
        )
      ).toEqual(["claude", "opencode"]);
      expect(
        getBuiltinEnabledAgents(
          '---\nmetadata:\n  copilot-enabled-agents: ""\n  copilot-builtin-version: "4"\n---\n'
        )
      ).toEqual([]);
    });
    it(`returns null for an unmarked skill or a sync conflict ${SYNC_ISSUE}`, () => {
      expect(
        getBuiltinEnabledAgents("---\nmetadata:\n  copilot-enabled-agents: claude\n---\n")
      ).toBeNull();
      expect(
        getBuiltinEnabledAgents(
          conflicted(
            '  copilot-enabled-agents: claude\n  copilot-builtin-version: "4"\n',
            '  copilot-enabled-agents: codex\n  copilot-builtin-version: "4"\n'
          )
        )
      ).toBeNull();
    });
  });
});
