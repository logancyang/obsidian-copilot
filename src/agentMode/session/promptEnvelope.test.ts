import { buildAgentPersonaBlocks, stripUserMessageWrapper } from "./promptEnvelope";

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

  describe("buildAgentPersonaBlocks()", () => {
    // The two blocks are the whole of how a persona reaches the model; see
    // `designdocs/CUSTOM_AGENTS.md` §4 ("How the persona reaches the model").
    const JENNIFER = {
      name: "Jennifer",
      instructions: "You are Jennifer, a developmental editor.",
    };
    // 2026-09-14T15:00:00 local, so the rendered day is timezone-independent.
    const MEMORY_MODIFIED_MS = new Date(2026, 8, 14, 15, 0, 0).getTime();

    it("emits the persona block alone when the agent has no memory to carry", () => {
      expect(buildAgentPersonaBlocks(JENNIFER)).toBe(
        '<agent_persona name="Jennifer">\nYou are Jennifer, a developmental editor.\n</agent_persona>'
      );
    });

    it("emits the memory block after the persona, dated by the file's last write", () => {
      const blocks = buildAgentPersonaBlocks({
        ...JENNIFER,
        memory: {
          text: "## About the user\n\n- Writes a climate newsletter.",
          modifiedAtMs: MEMORY_MODIFIED_MS,
        },
      });

      expect(blocks).toBe(
        '<agent_persona name="Jennifer">\nYou are Jennifer, a developmental editor.\n</agent_persona>\n\n' +
          '<agent_memory name="Jennifer" updated="2026-09-14">\n' +
          "## About the user\n\n- Writes a climate newsletter.\n</agent_memory>"
      );
    });

    it("omits the memory block when the agent's memory toggle is off", () => {
      // The caller passes null for a memory-disabled agent, so the model is
      // never handed an empty notebook to reason about.
      expect(buildAgentPersonaBlocks({ ...JENNIFER, memory: null })).not.toContain("<agent_memory");
    });

    it("omits the memory block when MEMORY.md is missing or holds only whitespace", () => {
      const blocks = buildAgentPersonaBlocks({
        ...JENNIFER,
        memory: { text: "   \n\n", modifiedAtMs: MEMORY_MODIFIED_MS },
      });

      expect(blocks).toBe(
        '<agent_persona name="Jennifer">\nYou are Jennifer, a developmental editor.\n</agent_persona>'
      );
    });

    it("carries memory even when the agent's instructions body is empty", () => {
      const blocks = buildAgentPersonaBlocks({
        name: "Jennifer",
        instructions: "",
        memory: { text: "- knows the newsletter", modifiedAtMs: MEMORY_MODIFIED_MS },
      });

      expect(blocks).toContain('<agent_persona name="Jennifer">');
      expect(blocks).toContain("- knows the newsletter");
    });

    it("returns null for an agent that contributes neither instructions nor memory", () => {
      expect(buildAgentPersonaBlocks({ name: "Jennifer", instructions: "  " })).toBeNull();
    });

    it("returns null when no agent is named, which is how the built-in Copilot sends nothing", () => {
      expect(buildAgentPersonaBlocks({ name: "", instructions: "anything" })).toBeNull();
    });

    it("escapes a double quote in the agent name so it cannot break the attribute", () => {
      const blocks = buildAgentPersonaBlocks({ name: 'Jen "The Knife"', instructions: "cut it" });

      expect(blocks).toBe(
        '<agent_persona name="Jen &quot;The Knife&quot;">\ncut it\n</agent_persona>'
      );
    });

    it("omits the updated attribute when the memory file carries no usable timestamp", () => {
      const blocks = buildAgentPersonaBlocks({
        ...JENNIFER,
        memory: { text: "- something", modifiedAtMs: Number.NaN },
      });

      expect(blocks).toContain('<agent_memory name="Jennifer">');
    });
  });
});
