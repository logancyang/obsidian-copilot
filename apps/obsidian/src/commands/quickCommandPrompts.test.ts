import { appendIncludeNoteContextPlaceholders } from "./quickCommandPrompts";

describe("quickCommandPrompts", () => {
  describe("appendIncludeNoteContextPlaceholders()", () => {
    describe("when includeActiveNote is false", () => {
      it("returns the content unchanged", () => {
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

        const matches = result.match(/\{\}/g);
        expect(matches?.length).toBe(1);

        expect(result).toContain("{activeNote}");
      });

      it("does not duplicate {activeNote} placeholder when it already exists", () => {
        const content = "Based on {activeNote}, summarize";
        const result = appendIncludeNoteContextPlaceholders(content, true);

        const matches = result.match(/\{activeNote\}/gi);
        expect(matches?.length).toBe(1);

        expect(result).toContain("{}");
      });

      it("does not add any placeholders when both already exist", () => {
        const content = "Fix {} based on {activeNote}";
        const result = appendIncludeNoteContextPlaceholders(content, true);

        expect(result).toBe(content);
      });

      it("does not append {activeNote} when an existing placeholder differs only in letter case", () => {
        const content = "Based on {ACTIVENOTE}, fix this";
        const result = appendIncludeNoteContextPlaceholders(content, true);

        const matches = result.match(/\{activenote\}/gi);
        expect(matches?.length).toBe(1);
      });

      it("appends both placeholders to empty content when includeActiveNote is true", () => {
        const result = appendIncludeNoteContextPlaceholders("", true);

        expect(result).toBe("\n\n{}\n\n{activeNote}");
      });
    });
  });
});
