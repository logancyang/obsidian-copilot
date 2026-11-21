import { buildMemorySaveRules } from "@/agents/memorySaveRules";

describe("memorySaveRules", () => {
  describe("buildMemorySaveRules()", () => {
    const rules = buildMemorySaveRules("copilot/teammates/coco/instructions.md");

    it("saves only what the user asks to remember, a standing correction, or where something lives", () => {
      expect(rules).toContain(
        '1. The user explicitly asks you to remember something ("remember", "from now on", "always", "never", "next time").'
      );
      expect(rules).toContain(
        "2. The user corrects you, and the correction is a standing rule for future work, not just this answer."
      );
      expect(rules).toContain(
        '3. The user tells you where something lives in the vault ("my meeting notes are all in meeting-notes/"). Save it.'
      );
    });

    it("asks the model to check each message for something to save, on its own line right after the save triggers", () => {
      expect(rules).toContain(
        [
          '3. The user tells you where something lives in the vault ("my meeting notes are all in meeting-notes/"). Save it.',
          "Before you answer, check whether the message gives you something to save.",
          "Do not save: one-off requests about this answer, facts, dates, numbers, project status, or summaries of the conversation.",
        ].join("\n")
      );
    });

    it("keeps one-off requests, facts, status and summaries out of memory", () => {
      expect(rules).toContain(
        "Do not save: one-off requests about this answer, facts, dates, numbers, project status, or summaries of the conversation."
      );
      expect(rules).toContain(
        "Facts and status belong in the user's notes. If one matters, you may offer to add it to the right note; never write it to memory."
      );
    });

    it("leaves the instruction to the user and links it as Open instruction", () => {
      expect(rules).toContain(
        "If the user asks to change your instruction, do not save a memory and do not edit any file. Tell them only they can edit it, and give them the Open instruction link."
      );
      expect(rules).toContain(
        "The Open instruction link is [[copilot/teammates/coco/instructions.md|Open instruction]]."
      );
    });

    it("says nothing of the memory file's format, which Copilot writes, and keeps its own text, without the instruction's path, under 1000 characters (https://github.com/Brevilabs/obsidian-copilot-private/issues/988)", () => {
      for (const format of [
        "##",
        "YYYY-MM-DD",
        "Replaces",
        "Contradicts instruction",
        "MEMORY.md",
      ]) {
        expect([format, rules.includes(format)]).toEqual([format, false]);
      }
      expect(buildMemorySaveRules("").length).toBeLessThan(1000);
    });
  });
});
