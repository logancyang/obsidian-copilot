import { compactAssistantOutput } from "./ChatHistoryCompactor";

describe("ChatHistoryCompactor", () => {
  describe("compactAssistantOutput()", () => {
    it("returns text without tool results unchanged", () => {
      const output = "This is a short response without tool results.";
      expect(compactAssistantOutput(output)).toBe(output);
    });

    it("compacts an oversized readNote JSON result to section previews and marks it COMPACTED", () => {
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

    it("compacts the text parts of a multimodal array and leaves image parts untouched", () => {
      const largeContent = "B".repeat(10000);
      const textItem = { type: "text", text: `<localSearch>${largeContent}</localSearch>` };
      const imageItem = { type: "image_url", url: "data:image/png;base64,..." };
      const output = [textItem, imageItem];

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(Array.isArray(result)).toBe(true);
      const resultArray = result as Array<{ text: string; type: string }>;
      expect(resultArray[0].text.length).toBeLessThan(textItem.text.length);
      expect(resultArray[1]).toEqual(imageItem);
    });

    it("keeps a readNote result under the verbatim threshold unchanged", () => {
      const smallResult = JSON.stringify({
        notePath: "notes/short.md",
        content: "Brief content.",
      });
      const output = `Tool 'readNote' result: ${smallResult}`;
      expect(compactAssistantOutput(output)).toBe(output);
    });

    it("never compacts a selected_text block however large", () => {
      const largeContent = "X".repeat(20000);
      const output = `<selected_text>
<content>${largeContent}</content>
</selected_text>`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(result).toBe(output);
    });

    it("compacts every oversized localSearch block in one message", () => {
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

    it("returns non-string, non-array content as-is", () => {
      const output = { some: "object" };
      expect(compactAssistantOutput(output as unknown as string)).toBe(output);
    });

    it("compacts a readNote result whose content contains nested braces", () => {
      const codeContent = `## Code Example
${"function test() { if (true) { return { value: 1 }; } } ".repeat(100)}

## Another Section
${"More content here. ".repeat(100)}`;

      const readNoteResult = JSON.stringify({
        notePath: "code/example.md",
        noteTitle: "Code Example",
        content: codeContent,
        chunkIndex: 0,
        totalChunks: 1,
      });

      const output = `Here's the code:

Tool 'readNote' result: ${readNoteResult}

That's the implementation.`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(output.length);
      expect(result).toContain("COMPACTED");
      expect(result).toContain("## Code Example");
      expect(result).toContain("That's the implementation");
    });

    it("compacts each of several readNote results in one message", () => {
      const content1 = "A".repeat(3000);
      const content2 = "B".repeat(3000);

      const result1 = JSON.stringify({ notePath: "a.md", content: content1 });
      const result2 = JSON.stringify({ notePath: "b.md", content: content2 });

      const output = `First note:
Tool 'readNote' result: ${result1}

Second note:
Tool 'readNote' result: ${result2}

Done.`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(output.length);
      expect(result).toContain("First note:");
      expect(result).toContain("Second note:");
      expect(result).toContain("Done.");
      const compactedCount = ((result as string).match(/COMPACTED/g) || []).length;
      expect(compactedCount).toBe(2);
    });

    it("lists every document of an oversized localSearch result with its title and path", () => {
      const largeContent1 = "First document content. ".repeat(200);
      const largeContent2 = "Second document content. ".repeat(200);
      const largeContent3 = "Third document content. ".repeat(200);

      const output = `I found these notes:

<localSearch>
<document>
<title>First Note</title>
<path>folder/first.md</path>
<content>${largeContent1}</content>
</document>
<document>
<title>Second Note</title>
<path>folder/second.md</path>
<content>${largeContent2}</content>
</document>
<document>
<title>Third Note</title>
<path>third.md</path>
<content>${largeContent3}</content>
</document>
</localSearch>

Based on my search, here's what I found.`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(typeof result).toBe("string");
      const resultStr = result as string;

      expect(resultStr.length).toBeLessThan(output.length);

      expect(resultStr).toContain("First Note");
      expect(resultStr).toContain("Second Note");
      expect(resultStr).toContain("Third Note");
      expect(resultStr).toContain("folder/first.md");
      expect(resultStr).toContain("folder/second.md");
      expect(resultStr).toContain("third.md");
      expect(resultStr).toContain("3 search results");

      expect(resultStr).toContain("I found these notes:");
      expect(resultStr).toContain("here's what I found");
    });

    it("compacts an oversized note_context block into a prior_context preview that keeps its headings", () => {
      const largeContent = `## Section 1
${"Content for section 1. ".repeat(200)}

## Section 2
${"Content for section 2. ".repeat(200)}`;

      const output = `<note_context>
<title>My Note</title>
<path>notes/mynote.md</path>
<content>${largeContent}</content>
</note_context>`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });

      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(output.length);
      expect(result).toContain('<prior_context source="notes/mynote.md" type="note">');
      expect(result).toContain("## Section 1");
      expect(result).toContain("## Section 2");
    });
  });
});
