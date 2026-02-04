import {
  appendIncludeNoteContextPlaceholders,
  QUICK_COMMAND_SYSTEM_PROMPT,
} from "./quickCommandPrompts";

describe("QUICK_COMMAND_SYSTEM_PROMPT", () => {
  it("is defined and non-empty", () => {
    expect(QUICK_COMMAND_SYSTEM_PROMPT).toBeDefined();
    expect(QUICK_COMMAND_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("contains key instructions", () => {
    expect(QUICK_COMMAND_SYSTEM_PROMPT).toContain("Direct and focused");
    expect(QUICK_COMMAND_SYSTEM_PROMPT).toContain("Action-oriented");
    expect(QUICK_COMMAND_SYSTEM_PROMPT).toContain("Context-aware");
  });
});

describe("appendIncludeNoteContextPlaceholders", () => {
  describe("when includeActiveNote is false", () => {
    it("returns content unchanged", () => {
      const content = "Fix the typos in this text";
      const result = appendIncludeNoteContextPlaceholders(content, false);
      expect(result).toBe(content);
    });

    it("does not add placeholders even when content is empty", () => {
      const result = appendIncludeNoteContextPlaceholders("", false);
      expect(result).toBe("");
    });
  });

  describe("when includeActiveNote is true", () => {
    it("appends both placeholders when neither exists", () => {
      const content = "Summarize this";
      const result = appendIncludeNoteContextPlaceholders(content, true);

      expect(result).toContain("{}");
      expect(result).toContain("{activeNote}");
      expect(result).toBe("Summarize this\n\n{}\n\n{activeNote}");
    });

    it("does not duplicate {} placeholder when it already exists", () => {
      const content = "Fix typos in {}";
      const result = appendIncludeNoteContextPlaceholders(content, true);

      // Should only have one {}
      const matches = result.match(/\{\}/g);
      expect(matches?.length).toBe(1);

      // Should still add {activeNote}
      expect(result).toContain("{activeNote}");
    });

    it("does not duplicate {activeNote} placeholder when it already exists", () => {
      const content = "Based on {activeNote}, summarize";
      const result = appendIncludeNoteContextPlaceholders(content, true);

      // Should only have one {activeNote}
      const matches = result.match(/\{activeNote\}/gi);
      expect(matches?.length).toBe(1);

      // Should still add {}
      expect(result).toContain("{}");
    });

    it("does not add any placeholders when both already exist", () => {
      const content = "Fix {} based on {activeNote}";
      const result = appendIncludeNoteContextPlaceholders(content, true);

      expect(result).toBe(content);
    });

    it("handles case-insensitive {activenote} placeholder", () => {
      const content = "Based on {ACTIVENOTE}, fix this";
      const result = appendIncludeNoteContextPlaceholders(content, true);

      // Should not add another activeNote (case insensitive)
      const matches = result.match(/\{activenote\}/gi);
      expect(matches?.length).toBe(1);
    });

    it("handles {activenote} lowercase variant", () => {
      const content = "Based on {activenote}, fix this";
      const result = appendIncludeNoteContextPlaceholders(content, true);

      // Should not add another activeNote
      const matches = result.match(/\{activenote\}/gi);
      expect(matches?.length).toBe(1);
    });

    it("appends placeholders with proper spacing", () => {
      const content = "Summarize";
      const result = appendIncludeNoteContextPlaceholders(content, true);

      // Should have double newline separators
      expect(result).toBe("Summarize\n\n{}\n\n{activeNote}");
    });

    it("handles empty content with includeActiveNote true", () => {
      const result = appendIncludeNoteContextPlaceholders("", true);

      expect(result).toBe("\n\n{}\n\n{activeNote}");
    });

    it("handles content with only whitespace", () => {
      const content = "   ";
      const result = appendIncludeNoteContextPlaceholders(content, true);

      expect(result).toContain("{}");
      expect(result).toContain("{activeNote}");
    });
  });
});
