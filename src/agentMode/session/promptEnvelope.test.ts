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
    const CORE = "## About the user\n\n- Writes a climate newsletter.";
    const INDEX =
      "- 2026-09-14 16:20 Newsletter intro · Renamed the newsletter. [[memory/2026-09-14]]";

    // designdocs/CUSTOM_AGENTS.md §5: the block carries the curated core and the
    // conversation index, each labeled so the model can weigh them.
    it("labels the core and the index and dates the block by the newest file it read", () => {
      const block = buildAgentMemoryBlock("Jennifer", {
        core: CORE,
        index: INDEX,
        modifiedAtMs: MEMORY_MODIFIED_MS,
      });

      expect(block).toContain('<agent_memory name="Jennifer" updated="2026-09-14">');
      expect(block).toContain(`## Your consolidated summary\n${CORE}`);
      expect(block).toContain(`## Your recent conversations\n${INDEX}`);
      expect(block?.endsWith("</agent_memory>")).toBe(true);
    });

    // A one-line summary the agent reads as the whole of a conversation is worse
    // than no line: asked what was decided, it would answer from the line rather
    // than open the day (`designdocs/CUSTOM_AGENTS.md` §5, "Reading").
    it("says the index is a table of contents and where the rest of a conversation is", () => {
      const block = buildAgentMemoryBlock("Jennifer", {
        core: CORE,
        index: INDEX,
        modifiedAtMs: MEMORY_MODIFIED_MS,
      });

      expect(block).toContain("an index, one line per conversation");
      expect(block).toContain("daily note each line links to holds the rest");
      expect(block).toContain("conversations folder holds its transcript");
      expect(block).toContain("only when a question reaches back");
    });

    // A model asked what was decided today otherwise answers from the longer,
    // more confident-sounding summary and reports the day's own decision as
    // still open (`designdocs/CUSTOM_AGENTS.md` §5, "Reading").
    it("says the recent conversations outrank the consolidated summary where they differ", () => {
      const block = buildAgentMemoryBlock("Jennifer", {
        core: CORE,
        index: null,
        modifiedAtMs: MEMORY_MODIFIED_MS,
      });

      expect(block).toContain("they are right and the summary has not caught up yet");
    });

    it("omits the index section, and the sentence explaining it, when there is no index", () => {
      const block = buildAgentMemoryBlock("Jennifer", {
        core: CORE,
        index: "   \n\n",
        modifiedAtMs: MEMORY_MODIFIED_MS,
      });

      expect(block).toContain(CORE);
      expect(block).not.toContain("Your recent conversations");
      expect(block).not.toContain("one line per conversation");
    });

    it("carries the index alone for an agent whose core has never been consolidated", () => {
      const block = buildAgentMemoryBlock("Jennifer", {
        core: null,
        index: INDEX,
        modifiedAtMs: MEMORY_MODIFIED_MS,
      });

      expect(block).toContain(INDEX);
      expect(block).not.toContain("Your consolidated summary");
    });

    it("returns null when the agent has nothing to recall, rather than an empty notebook", () => {
      expect(buildAgentMemoryBlock("Jennifer", null)).toBeNull();
      expect(
        buildAgentMemoryBlock("Jennifer", { core: null, index: null, modifiedAtMs: 0 })
      ).toBeNull();
    });

    it("returns null when no agent is named, which is how the built-in Copilot sends nothing", () => {
      expect(buildAgentMemoryBlock("", { core: CORE, index: null, modifiedAtMs: 0 })).toBeNull();
    });

    it("escapes a double quote in the agent name so it cannot break the attribute", () => {
      const block = buildAgentMemoryBlock('Jen "The Knife"', {
        core: CORE,
        index: null,
        modifiedAtMs: MEMORY_MODIFIED_MS,
      });

      expect(block).toContain('<agent_memory name="Jen &quot;The Knife&quot;"');
    });

    it("omits the updated attribute when no file carried a usable timestamp", () => {
      const block = buildAgentMemoryBlock("Jennifer", {
        core: CORE,
        index: null,
        modifiedAtMs: Number.NaN,
      });

      expect(block).toContain('<agent_memory name="Jennifer">');
    });
  });
});
