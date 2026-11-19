import { buildMemorySaveRules } from "@/agents/memorySaveRules";

describe("memorySaveRules", () => {
  describe("buildMemorySaveRules()", () => {
    const rules = buildMemorySaveRules(
      "/vault/copilot/agents/coco/MEMORY.md",
      "copilot/agents/coco/instructions.md"
    );

    it("saves only what the user asks to remember, a standing correction, or where something lives", () => {
      expect(rules).toContain(
        '1. The user explicitly asks you to remember something ("remember", "from now on", "always", "never", "next time").'
      );
      expect(rules).toContain(
        "2. The user corrects you, and the correction is a standing rule for future work, not just this answer."
      );
      expect(rules).toContain(
        '3. The user tells you where something lives in the vault ("my meeting notes are all in meeting-notes/"). Save it under "Where to find things".'
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

    it("writes one sentence with a dated context line, and replaces one line instead of rewriting the file", () => {
      expect(rules).toContain(
        'Write each rule as one plain sentence the user would agree with. Add one line of context: the date and why it came up. If it only holds until a date, start with "Until YYYY-MM-DD:".'
      );
      expect(rules).toContain(
        "If the new rule replaces an existing one, replace that line. Never rewrite other lines."
      );
      expect(rules).toContain(
        '<the rule>\n<YYYY-MM-DD> · <why it came up>\nWhen the rule replaces one, its context line says so: <YYYY-MM-DD> · Replaces "<the old rule>" (<the old rule\'s date>).'
      );
    });

    it("saves to the agent's own MEMORY.md only, creating it with its two headings", () => {
      expect(rules).toContain(
        "To save, edit /vault/copilot/agents/coco/MEMORY.md yourself, without asking. It is your only memory: never save to CLAUDE.md, AGENTS.md or any other memory."
      );
      expect(rules).toContain(
        `If the file doesn't exist yet, create it with its two headings, "## How to work" and "## Where to find things".`
      );
    });

    it("saves a rule that goes against the instruction unless the user asks to change the instruction, marking it with the instruction's sentence", () => {
      expect(rules).toContain(
        `A rule that goes against your instruction is still saved when the user doesn't ask to change the instruction itself; end its context line with: · Contradicts instruction: "<that sentence of your instruction, word for word>".`
      );
    });

    it("refuses to save in a read-only mode such as Plan mode, but saves in a read-only sandbox whose edits wait for approval", () => {
      expect(rules).toContain(
        "In a read-only mode, such as Plan mode, save nothing and tell the user you can't save a rule in this mode. A read-only sandbox where edits wait for the user's approval is not such a mode: Copilot approves the save for you, so save as usual."
      );
    });

    it("leaves the instruction to the user and links it as Open instruction", () => {
      expect(rules).toContain(
        "If the user asks to change your instruction, do not save a memory and do not edit any file. Tell them only they can edit it, and give them the Open instruction link."
      );
      expect(rules).toContain(
        "The Open instruction link is [[copilot/agents/coco/instructions.md|Open instruction]]."
      );
    });
  });
});
