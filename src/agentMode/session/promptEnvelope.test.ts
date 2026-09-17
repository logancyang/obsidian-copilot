import {
  buildAgentMemoryBlock,
  buildAgentPersonaBlock,
  stripUserMessageWrapper,
} from "./promptEnvelope";

describe("promptEnvelope", () => {
  describe("stripUserMessageWrapper()", () => {
    it("returns the typed text from a prompt wrapped with a context block", () => {
      const wrapped =
        "<copilot-context>\nNotes:\n- a.md\n</copilot-context>\n\n" +
        "<user-message>\nsummarize a.md\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("summarize a.md");
    });

    it("keeps the inner newlines of a multi-line prompt", () => {
      const wrapped = "<user-message>\nfirst line\n\nsecond line\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("first line\n\nsecond line");
    });

    it("returns an unwrapped prompt unchanged", () => {
      // Prompts sent without attached context never get the envelope.
      expect(stripUserMessageWrapper("just a question")).toBe("just a question");
    });

    it("ignores a wrapper tag that an attached note excerpt happens to contain", () => {
      // Excerpts are inlined verbatim, so any note mentioning the tag would
      // otherwise be mistaken for the envelope.
      const wrapped =
        "<copilot-context>\nSelected excerpts:\n  the <user-message> tag wraps the prompt\n" +
        "</copilot-context>\n\n<user-message>\nhi\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("hi");
    });

    it("ignores a complete wrapper pair inside an attached note excerpt", () => {
      const wrapped =
        "<copilot-context>\nSelected excerpts:\n  <user-message>sample</user-message>\n" +
        "</copilot-context>\n\n<user-message>\nhi\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("hi");
    });

    it("keeps a closing tag the user typed inside the prompt", () => {
      const wrapped = "<user-message>\nwhat does </user-message> mean?\n</user-message>";

      expect(stripUserMessageWrapper(wrapped)).toBe("what does </user-message> mean?");
    });

    it("unwraps a prompt stored with trailing whitespace", () => {
      expect(stripUserMessageWrapper("<user-message>\nhi\n</user-message>\n")).toBe("hi");
    });

    it("unwraps a prompt that has text stored after the envelope", () => {
      // The Claude adapter replaces an image it cannot send with a note, and
      // the transcript hands that back joined onto the wrapped prompt.
      const stored =
        "<user-message>\ndescribe this\n</user-message>\n\n" +
        "[Unsupported image attachment omitted: image/heic]";

      expect(stripUserMessageWrapper(stored)).toBe("describe this");
    });

    it("returns content unchanged when the closing tag is missing", () => {
      expect(stripUserMessageWrapper("<user-message>\nhalf a prompt")).toBe(
        "<user-message>\nhalf a prompt"
      );
    });
  });

  describe("buildAgentPersonaBlock()", () => {
    // The persona block is how an identity reaches the model; see
    // `designdocs/CUSTOM_AGENTS.md` §4 ("How the persona reaches the model").
    const JENNIFER = {
      name: "Jennifer",
      instructions: "You are Jennifer, a developmental editor.",
    };
    const TARGETS = {
      dailyNotePath: "copilot/agents/jennifer/memory/2026-09-17.md",
      memoryFolderPath: "copilot/agents/jennifer/memory",
    };

    it("emits the standing instructions alone when the agent cannot write", () => {
      expect(buildAgentPersonaBlock(JENNIFER)).toBe(
        '<agent_persona name="Jennifer">\nYou are Jennifer, a developmental editor.\n</agent_persona>'
      );
    });

    // designdocs/CUSTOM_AGENTS.md §5: the agent appends to today's note with
    // its own file tools, and consolidation owns MEMORY.md.
    it("names today's note and the folder, and forbids editing MEMORY.md, when it can write", () => {
      const block = buildAgentPersonaBlock({ ...JENNIFER, writeTargets: TARGETS });

      expect(block).toContain("You are Jennifer, a developmental editor.");
      expect(block).toContain("copilot/agents/jennifer/memory/2026-09-17.md");
      expect(block).toContain("copilot/agents/jennifer/memory`");
      expect(block).toContain("Never edit your MEMORY.md.");
    });

    // designdocs/CUSTOM_AGENTS.md §5: a read-only fan-out sub-session has no
    // file tools, so a note-keeping instruction could only produce a refusal.
    it("says nothing about notes for a read-only answerer", () => {
      expect(buildAgentPersonaBlock({ ...JENNIFER, writeTargets: null })).not.toContain(
        "Keeping your own notes"
      );
    });

    it("still carries the note-keeping instruction when the instructions body is empty", () => {
      const block = buildAgentPersonaBlock({
        name: "Jennifer",
        instructions: "",
        writeTargets: TARGETS,
      });

      expect(block).toContain('<agent_persona name="Jennifer">');
      expect(block).toContain("Keeping your own notes");
    });

    it("returns null for an agent that contributes neither instructions nor a place to write", () => {
      expect(buildAgentPersonaBlock({ name: "Jennifer", instructions: "  " })).toBeNull();
    });

    it("returns null when no agent is named, which is how the built-in Copilot sends nothing", () => {
      expect(buildAgentPersonaBlock({ name: "", instructions: "anything" })).toBeNull();
    });

    it("escapes a double quote in the agent name so it cannot break the attribute", () => {
      const block = buildAgentPersonaBlock({ name: 'Jen "The Knife"', instructions: "cut it" });

      expect(block).toBe(
        '<agent_persona name="Jen &quot;The Knife&quot;">\ncut it\n</agent_persona>'
      );
    });
  });

  describe("buildAgentMemoryBlock()", () => {
    // 2026-09-14T15:00:00 local, so the rendered day is timezone-independent.
    const MEMORY_MODIFIED_MS = new Date(2026, 8, 14, 15, 0, 0).getTime();

    // designdocs/CUSTOM_AGENTS.md §5: the block carries the curated core plus
    // today's and yesterday's notes, each labeled so the model can weigh them.
    it("labels each section and dates the block by the newest file it read", () => {
      const block = buildAgentMemoryBlock("Jennifer", {
        sections: [
          { label: "MEMORY.md", text: "## About the user\n\n- Writes a climate newsletter." },
          { label: "Your notes from 2026-09-14", text: "- Renamed the newsletter." },
        ],
        modifiedAtMs: MEMORY_MODIFIED_MS,
      });

      expect(block).toBe(
        '<agent_memory name="Jennifer" updated="2026-09-14">\n' +
          "## MEMORY.md\n## About the user\n\n- Writes a climate newsletter.\n\n" +
          "## Your notes from 2026-09-14\n- Renamed the newsletter.\n</agent_memory>"
      );
    });

    it("drops a section whose file held only whitespace", () => {
      const block = buildAgentMemoryBlock("Jennifer", {
        sections: [
          { label: "MEMORY.md", text: "- something" },
          { label: "Your notes from 2026-09-14", text: "   \n\n" },
        ],
        modifiedAtMs: MEMORY_MODIFIED_MS,
      });

      expect(block).toContain("- something");
      expect(block).not.toContain("Your notes from");
    });

    it("returns null when the agent has nothing to recall, rather than an empty notebook", () => {
      expect(buildAgentMemoryBlock("Jennifer", null)).toBeNull();
      expect(buildAgentMemoryBlock("Jennifer", { sections: [], modifiedAtMs: 0 })).toBeNull();
    });

    it("returns null when no agent is named, which is how the built-in Copilot sends nothing", () => {
      expect(
        buildAgentMemoryBlock("", {
          sections: [{ label: "MEMORY.md", text: "x" }],
          modifiedAtMs: 0,
        })
      ).toBeNull();
    });

    it("escapes a double quote in the agent name so it cannot break the attribute", () => {
      const block = buildAgentMemoryBlock('Jen "The Knife"', {
        sections: [{ label: "MEMORY.md", text: "x" }],
        modifiedAtMs: MEMORY_MODIFIED_MS,
      });

      expect(block).toContain('<agent_memory name="Jen &quot;The Knife&quot;"');
    });

    it("omits the updated attribute when no file carried a usable timestamp", () => {
      const block = buildAgentMemoryBlock("Jennifer", {
        sections: [{ label: "MEMORY.md", text: "- something" }],
        modifiedAtMs: Number.NaN,
      });

      expect(block).toContain('<agent_memory name="Jennifer">');
    });
  });
});
