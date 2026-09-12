import { getBuiltinSkillVersion } from "./builtinOwnership";

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
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
  });
});
