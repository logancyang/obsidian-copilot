import { compactAssistantOutput } from "./ChatHistoryCompactor";

describe("ChatHistoryCompactor", () => {
  describe("compactAssistantOutput", () => {
    it("should return small content unchanged", () => {
      const output = "This is a short response without tool results.";
      expect(compactAssistantOutput(output)).toBe(output);
    });

    it("should compact large localSearch blocks", () => {
      const largeContent = "A".repeat(10000);
      const output = `I searched for that.

<localSearch>
<document>
<title>Note 1</title>
<path>notes/note1.md</path>
<content>${largeContent}</content>
</document>
</localSearch>

Based on my search, here's what I found.`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(output.length);
      expect(result).toContain("I searched for that");
      expect(result).toContain("here's what I found");
      expect(result).toContain("prior_context");
    });

    it("should compact large readNote JSON results", () => {
      const largeContent = `## Introduction
${"This is intro. ".repeat(200)}

## Methods
${"This is methods. ".repeat(200)}`;

      const readNoteResult = JSON.stringify({
        notePath: "research/paper.md",
        noteTitle: "Research Paper",
        content: largeContent,
        chunkIndex: 0,
        totalChunks: 1,
      });

      const output = `Let me read that note.

Tool 'readNote' result: ${readNoteResult}

Here's a summary.`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(output.length);
      expect(result).toContain("COMPACTED");
      expect(result).toContain("## Introduction");
    });

    it("should handle multimodal content arrays", () => {
      const largeContent = "B".repeat(10000);
      const textItem = { type: "text", text: `<localSearch>${largeContent}</localSearch>` };
      const imageItem = { type: "image_url", url: "data:image/png;base64,..." };
      const output = [textItem, imageItem];

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(Array.isArray(result)).toBe(true);
      const resultArray = result as any[];
      expect(resultArray[0].text.length).toBeLessThan(textItem.text.length);
      expect(resultArray[1]).toEqual(imageItem); // Image unchanged
    });

    it("should keep small tool results verbatim", () => {
      const smallResult = JSON.stringify({
        notePath: "notes/short.md",
        content: "Brief content.",
      });
      const output = `Tool 'readNote' result: ${smallResult}`;
      expect(compactAssistantOutput(output)).toBe(output);
    });

    it("should never compact selected_text blocks", () => {
      const largeContent = "X".repeat(20000);
      const output = `<selected_text>
<content>${largeContent}</content>
</selected_text>`;

      // selected_text is not in the TOOL_RESULT_PATTERNS, so it won't be processed
      // But if it were, it should remain unchanged due to isRecoverable check
      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(result).toBe(output);
    });

    it("should handle multiple tool results in one message", () => {
      const large1 = "A".repeat(8000);
      const large2 = "B".repeat(8000);
      const output = `First:
<localSearch>${large1}</localSearch>

Second:
<localSearch>${large2}</localSearch>

Done.`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(output.length * 0.3);
    });

    it("should return non-string/non-array content unchanged", () => {
      const output = { some: "object" };
      expect(compactAssistantOutput(output as any)).toBe(output);
    });
  });
});
