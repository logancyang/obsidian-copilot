import {
  compactL3ForL2,
  compactBySection,
  truncateWithEllipsis,
  detectSourceType,
  extractSource,
  extractContent,
  compactXmlBlock,
  compactChatHistoryContent,
  getL2RefetchInstruction,
} from "./L2ContextCompactor";

describe("L2ContextCompactor", () => {
  describe("truncateWithEllipsis", () => {
    it("should return text unchanged if under maxLength", () => {
      const text = "Short text.";
      expect(truncateWithEllipsis(text, 100)).toBe(text);
    });

    it("should truncate at sentence boundary when possible", () => {
      const text =
        "First sentence. Second sentence. Third sentence that goes on and on to make it longer.";
      const result = truncateWithEllipsis(text, 50);
      // Should break after "Second sentence." since it's the last sentence ending > 50% mark
      expect(result).toContain("First sentence.");
      expect(result).toContain("Second sentence.");
      expect(result).toContain("...");
      expect(result.length).toBeLessThan(text.length);
    });

    it("should truncate at paragraph boundary when no good sentence break", () => {
      const text = "First paragraph with no sentence breaks\n\nSecond paragraph here";
      const result = truncateWithEllipsis(text, 50);
      expect(result).toBe("First paragraph with no sentence breaks\n\n...");
    });

    it("should truncate at word boundary as fallback", () => {
      const text = "word1 word2 word3 word4 word5 word6 word7 word8";
      const result = truncateWithEllipsis(text, 25);
      expect(result).toBe("word1 word2 word3 word4 ...");
    });

    it("should add ellipsis when hard truncating", () => {
      const text = "verylongwordwithoutanyspaces";
      const result = truncateWithEllipsis(text, 10);
      expect(result).toBe("verylongwo...");
    });
  });

  describe("compactBySection", () => {
    it("should truncate content without headings", () => {
      const content = "A".repeat(3000);
      const result = compactBySection(content, 500, 20);
      expect(result.length).toBeLessThan(2500);
      expect(result).toContain("...");
    });

    it("should preserve headings and extract previews from each section", () => {
      const content = `## Introduction
This is the introduction section with some content that explains what the document is about. It goes on for a while with more details.

## Methodology
This describes the methodology used in the research. It includes various approaches and techniques.

## Results
Here are the results of the study. They show interesting findings.`;

      const result = compactBySection(content, 50, 20);

      expect(result).toContain("## Introduction");
      expect(result).toContain("## Methodology");
      expect(result).toContain("## Results");
      // Should truncate long sections
      expect(result.length).toBeLessThan(content.length);
    });

    it("should keep small sections verbatim", () => {
      const content = `## Section 1
Short content.

## Section 2
Also short.`;

      const result = compactBySection(content, 500, 20);
      expect(result).toBe(content);
    });

    it("should limit number of sections", () => {
      const sections = Array.from(
        { length: 30 },
        (_, i) => `## Section ${i + 1}\nContent ${i + 1}`
      );
      const content = sections.join("\n\n");

      const result = compactBySection(content, 500, 10);

      expect(result).toContain("## Section 1");
      expect(result).toContain("## Section 10");
      expect(result).not.toContain("## Section 11");
      expect(result).toContain("20 more sections omitted");
    });

    it("should handle nested headings", () => {
      const content = `# Main Title
Introduction text.

## Section 1
Content for section 1.

### Subsection 1.1
Details here.

## Section 2
More content.`;

      const result = compactBySection(content, 500, 20);

      expect(result).toContain("# Main Title");
      expect(result).toContain("## Section 1");
      expect(result).toContain("### Subsection 1.1");
      expect(result).toContain("## Section 2");
    });

    it("should handle content with code blocks", () => {
      const content = `## Code Example
Here is some code:

\`\`\`javascript
function example() {
  return "hello";
}
\`\`\`

## Another Section
More text here.`;

      const result = compactBySection(content, 500, 20);

      expect(result).toContain("## Code Example");
      expect(result).toContain("```javascript");
      expect(result).toContain("## Another Section");
    });
  });

  describe("detectSourceType", () => {
    it("should detect note types", () => {
      expect(detectSourceType("note_context")).toBe("note");
      expect(detectSourceType("active_note")).toBe("note");
      expect(detectSourceType("embedded_note")).toBe("note");
      expect(detectSourceType("vault_note")).toBe("note");
      expect(detectSourceType("retrieved_document")).toBe("note");
    });

    it("should detect URL types", () => {
      expect(detectSourceType("url_content")).toBe("url");
      expect(detectSourceType("web_tab_context")).toBe("url");
      expect(detectSourceType("active_web_tab")).toBe("url");
    });

    it("should detect YouTube type", () => {
      expect(detectSourceType("youtube_video_context")).toBe("youtube");
    });

    it("should detect PDF type", () => {
      expect(detectSourceType("embedded_pdf")).toBe("pdf");
    });

    it("should detect selected text types", () => {
      expect(detectSourceType("selected_text")).toBe("selected_text");
      expect(detectSourceType("web_selected_text")).toBe("selected_text");
    });

    it("should return unknown for unrecognized types", () => {
      expect(detectSourceType("random_type")).toBe("unknown");
      expect(detectSourceType("")).toBe("unknown");
    });
  });

  describe("extractSource", () => {
    it("should extract path from note context", () => {
      const xml = `<note_context>
<title>My Note</title>
<path>folder/my-note.md</path>
<content>Content here</content>
</note_context>`;
      expect(extractSource(xml)).toBe("folder/my-note.md");
    });

    it("should extract URL from web content", () => {
      const xml = `<url_content>
<title>Web Page</title>
<url>https://example.com/page</url>
<content>Content here</content>
</url_content>`;
      expect(extractSource(xml)).toBe("https://example.com/page");
    });

    it("should extract name from PDF", () => {
      const xml = `<embedded_pdf>
<name>document.pdf</name>
<content>PDF content</content>
</embedded_pdf>`;
      expect(extractSource(xml)).toBe("document.pdf");
    });

    it("should return empty string if no source found", () => {
      const xml = `<selected_text>
<content>Just some text</content>
</selected_text>`;
      expect(extractSource(xml)).toBe("");
    });

    it("should prefer path over url if both present", () => {
      const xml = `<mixed>
<path>local/file.md</path>
<url>https://example.com</url>
</mixed>`;
      expect(extractSource(xml)).toBe("local/file.md");
    });
  });

  describe("extractContent", () => {
    it("should extract content from content tags", () => {
      const xml = `<note_context>
<title>Title</title>
<path>path.md</path>
<content>This is the actual content
with multiple lines.</content>
</note_context>`;
      expect(extractContent(xml)).toBe("This is the actual content\nwith multiple lines.");
    });

    it("should return whole block if no content tags", () => {
      const xml = "<note>Just plain text</note>";
      expect(extractContent(xml)).toBe(xml);
    });

    it("should handle content with special characters", () => {
      const xml = `<note_context>
<content>Content with <code> and "quotes" & ampersands</content>
</note_context>`;
      expect(extractContent(xml)).toBe('Content with <code> and "quotes" & ampersands');
    });
  });

  describe("compactL3ForL2", () => {
    it("should keep small content verbatim", () => {
      const content = "Small content";
      const result = compactL3ForL2(content, "notes/test.md", "note");
      expect(result).toBe(content);
    });

    it("should compact large content with proper structure", () => {
      const content = `## Section 1
${"A".repeat(2000)}

## Section 2
${"B".repeat(2000)}`;

      const result = compactL3ForL2(content, "notes/research.md", "note", {
        verbatimThreshold: 1000,
        previewCharsPerSection: 100,
      });

      expect(result).toContain('<prior_context source="notes/research.md" type="note">');
      expect(result).toContain("## Section 1");
      expect(result).toContain("## Section 2");
      expect(result).toContain("</prior_context>");
      expect(result.length).toBeLessThan(content.length);
    });

    it("should set correct type for URL content", () => {
      const content = "A".repeat(10000);
      const result = compactL3ForL2(content, "https://example.com", "url", {
        verbatimThreshold: 1000,
      });

      expect(result).toContain('type="url"');
      expect(result).toContain('source="https://example.com"');
    });

    it("should set correct type for YouTube content", () => {
      const content = "A".repeat(10000);
      const result = compactL3ForL2(content, "https://youtube.com/watch?v=123", "youtube", {
        verbatimThreshold: 1000,
      });

      expect(result).toContain('type="youtube"');
      expect(result).toContain('source="https://youtube.com/watch?v=123"');
    });

    it("should escape special characters in source attribute", () => {
      const content = "A".repeat(10000);
      const result = compactL3ForL2(content, 'path/with"quotes&special<chars>', "note", {
        verbatimThreshold: 1000,
      });

      expect(result).toContain("&quot;");
      expect(result).toContain("&amp;");
      expect(result).toContain("&lt;");
    });
  });

  describe("compactXmlBlock", () => {
    it("should keep small XML blocks verbatim", () => {
      const xml = `<note_context>
<title>Short Note</title>
<path>notes/short.md</path>
<content>Brief content.</content>
</note_context>`;

      const result = compactXmlBlock(xml, "note_context");
      expect(result).toBe(xml);
    });

    it("should compact large XML blocks", () => {
      const largeContent = `## Introduction
${"X".repeat(3000)}

## Details
${"Y".repeat(3000)}`;

      const xml = `<note_context>
<title>Research Paper</title>
<path>research/paper.md</path>
<content>${largeContent}</content>
</note_context>`;

      const result = compactXmlBlock(xml, "note_context", {
        verbatimThreshold: 1000,
        previewCharsPerSection: 200,
      });

      expect(result).toContain('<prior_context source="research/paper.md" type="note">');
      expect(result).toContain("## Introduction");
      expect(result).toContain("## Details");
      expect(result.length).toBeLessThan(xml.length);
    });

    it("should handle URL content blocks", () => {
      const largeContent = "A".repeat(10000);
      const xml = `<url_content>
<title>Web Page</title>
<url>https://example.com/article</url>
<content>${largeContent}</content>
</url_content>`;

      const result = compactXmlBlock(xml, "url_content", {
        verbatimThreshold: 1000,
      });

      expect(result).toContain('source="https://example.com/article"');
      expect(result).toContain('type="url"');
    });

    it("should handle YouTube blocks", () => {
      const transcript = "Speaker: " + "transcript content ".repeat(500);
      const xml = `<youtube_video_context>
<title>Tutorial Video</title>
<url>https://www.youtube.com/watch?v=abc123</url>
<content>${transcript}</content>
</youtube_video_context>`;

      const result = compactXmlBlock(xml, "youtube_video_context", {
        verbatimThreshold: 1000,
      });

      expect(result).toContain('type="youtube"');
    });

    it("should handle PDF blocks", () => {
      const pdfContent = "Page 1: " + "content ".repeat(1000);
      const xml = `<embedded_pdf>
<name>documents/report.pdf</name>
<content>${pdfContent}</content>
</embedded_pdf>`;

      const result = compactXmlBlock(xml, "embedded_pdf", {
        verbatimThreshold: 1000,
      });

      expect(result).toContain('source="documents/report.pdf"');
      expect(result).toContain('type="pdf"');
    });

    it("should NEVER compact selected_text blocks regardless of size", () => {
      const largeContent = "A".repeat(20000);
      const xml = `<selected_text>
<title>User Selection</title>
<path>notes/document.md</path>
<content>${largeContent}</content>
</selected_text>`;

      const result = compactXmlBlock(xml, "selected_text", {
        verbatimThreshold: 1000,
      });

      // Should return verbatim, not compacted
      expect(result).toBe(xml);
      expect(result).not.toContain("prior_context");
    });

    it("should NEVER compact web_selected_text blocks regardless of size", () => {
      const largeContent = "B".repeat(20000);
      const xml = `<web_selected_text>
<title>Web Selection</title>
<url>https://example.com/page</url>
<content>${largeContent}</content>
</web_selected_text>`;

      const result = compactXmlBlock(xml, "web_selected_text", {
        verbatimThreshold: 1000,
      });

      // Should return verbatim, not compacted
      expect(result).toBe(xml);
      expect(result).not.toContain("prior_context");
    });
  });

  describe("getL2RefetchInstruction", () => {
    it("should return a single consolidated instruction", () => {
      const instruction = getL2RefetchInstruction();

      expect(instruction).toContain("prior_context_note");
      expect(instruction).toContain("previews");
      expect(instruction).toContain("[[note title]]");
    });
  });

  describe("real-world scenarios", () => {
    it("should handle a typical research note with large sections", () => {
      // Generate a realistic large research note where each section has substantial content
      const longParagraph = (topic: string) =>
        `This section discusses ${topic} in great detail. `.repeat(30);

      const content = `## Abstract
${longParagraph("the research overview")}

## 1. Introduction
${longParagraph("the background and motivation")}

### 1.1 Background
${longParagraph("historical context")}

### 1.2 Motivation
${longParagraph("why this research matters")}

## 2. Methodology
${longParagraph("experimental design")}

### 2.1 Data Collection
${longParagraph("data gathering procedures")}

### 2.2 Model Architectures
${longParagraph("model implementations")}

## 3. Results
${longParagraph("experimental findings")}

### 3.1 Classification Tasks
${longParagraph("classification results")}

### 3.2 Generation Tasks
${longParagraph("generation results")}

## 4. Discussion
${longParagraph("implications of findings")}

## 5. Conclusion
${longParagraph("summary and future work")}`;

      const xml = `<note_context>
<title>ML Research Paper</title>
<path>research/ml-nlp-study.md</path>
<content>${content}</content>
</note_context>`;

      const result = compactXmlBlock(xml, "note_context", {
        verbatimThreshold: 1000,
        previewCharsPerSection: 300,
      });

      // Should preserve all major sections
      expect(result).toContain("## Abstract");
      expect(result).toContain("## 1. Introduction");
      expect(result).toContain("### 1.1 Background");
      expect(result).toContain("## 2. Methodology");
      expect(result).toContain("## 3. Results");
      expect(result).toContain("## 4. Discussion");
      expect(result).toContain("## 5. Conclusion");

      // Should be significantly smaller (each section was ~1500 chars, now ~300)
      expect(result.length).toBeLessThan(xml.length * 0.3);

      // Should be wrapped in prior_context
      expect(result).toContain("prior_context");
    });

    it("should handle content with mixed markdown elements", () => {
      const content = `## Overview
This document contains various markdown elements.

## Code Examples
Here's a code block:

\`\`\`python
def hello():
    print("Hello, World!")

def complex_function(x, y, z):
    # This is a longer function
    result = x + y + z
    for i in range(100):
        result += i
    return result
\`\`\`

## Tables
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| More     | Data     | Here     |

## Lists
- Item 1
- Item 2
  - Nested item
  - Another nested
- Item 3

## Blockquotes
> This is a quote
> that spans multiple lines
> and contains important information.

## Final Section
Some concluding remarks.`;

      const result = compactBySection(content, 400, 20);

      // Should preserve structure
      expect(result).toContain("## Overview");
      expect(result).toContain("## Code Examples");
      expect(result).toContain("```python");
      expect(result).toContain("## Tables");
      expect(result).toContain("## Lists");
      expect(result).toContain("## Blockquotes");
      expect(result).toContain("## Final Section");
    });
  });

  describe("compactChatHistoryContent", () => {
    it("should return small content unchanged", () => {
      const content = "This is a short message without any tool results.";
      const result = compactChatHistoryContent(content);
      expect(result).toBe(content);
    });

    it("should compact large localSearch blocks in chat history", () => {
      const largeContent = "A".repeat(10000);
      const content = `I'll search for that information.

Tool 'localSearch' result: <localSearch>
Answer the question based only on the following context:

<document title="Note 1" path="notes/note1.md">
${largeContent}
</document>

<guidance>
CITATION RULES:
1. START with [^1] and increment sequentially
</guidance>
</localSearch>

Based on my search, I found the answer.`;

      const result = compactChatHistoryContent(content, { verbatimThreshold: 1000 });

      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(content.length);
      expect(result).toContain("I'll search for that information");
      expect(result).toContain("Based on my search, I found the answer");
      expect(result).toContain("prior_context");
    });

    it("should compact large readNote JSON results", () => {
      const largeNoteContent = `## Introduction
${"This is introduction content. ".repeat(200)}

## Methods
${"This describes the methodology. ".repeat(200)}

## Results
${"Here are the results. ".repeat(200)}`;

      const readNoteResult = JSON.stringify({
        notePath: "research/paper.md",
        noteTitle: "Research Paper",
        content: largeNoteContent,
        chunkIndex: 0,
        totalChunks: 1,
      });

      const content = `I'll read that note for you.

Tool 'readNote' result: ${readNoteResult}

Here's what I found in the note.`;

      const result = compactChatHistoryContent(content, { verbatimThreshold: 1000 });

      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(content.length);
      expect(result).toContain("I'll read that note for you");
      expect(result).toContain("Here's what I found in the note");
      expect(result).toContain("COMPACTED");
      expect(result).toContain("## Introduction");
      expect(result).toContain("## Methods");
    });

    it("should handle multimodal content arrays", () => {
      const largeContent = "A".repeat(10000);
      const originalText = `Tool 'localSearch' result: <localSearch>${largeContent}</localSearch>`;
      const content = [
        { type: "text", text: originalText },
        { type: "image_url", url: "data:image/png;base64,..." },
      ];

      const result = compactChatHistoryContent(content, { verbatimThreshold: 1000 });

      expect(Array.isArray(result)).toBe(true);
      const resultArray = result as any[];
      expect(resultArray[0].type).toBe("text");
      expect(resultArray[0].text.length).toBeLessThan(originalText.length);
      expect(resultArray[1]).toEqual(content[1]); // Image unchanged
    });

    it("should keep small tool results verbatim", () => {
      const smallContent = "Brief note content.";
      const readNoteResult = JSON.stringify({
        notePath: "notes/brief.md",
        noteTitle: "Brief Note",
        content: smallContent,
        chunkIndex: 0,
        totalChunks: 1,
      });

      const content = `Tool 'readNote' result: ${readNoteResult}`;
      const result = compactChatHistoryContent(content);

      expect(result).toBe(content); // Unchanged
    });

    it("should handle multiple tool results in one message", () => {
      const largeContent1 = "A".repeat(8000);
      const largeContent2 = "B".repeat(8000);

      const content = `First search:

Tool 'localSearch' result: <localSearch>${largeContent1}</localSearch>

Second search:

Tool 'localSearch' result: <localSearch>${largeContent2}</localSearch>

Summary of findings.`;

      const result = compactChatHistoryContent(content, { verbatimThreshold: 1000 });

      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(content.length * 0.3);
      expect(result).toContain("First search");
      expect(result).toContain("Second search");
      expect(result).toContain("Summary of findings");
    });

    it("should compact note_context blocks", () => {
      const largeContent = `## Section 1
${"Content for section 1. ".repeat(200)}

## Section 2
${"Content for section 2. ".repeat(200)}`;

      const content = `<note_context>
<title>My Note</title>
<path>notes/mynote.md</path>
<content>${largeContent}</content>
</note_context>`;

      const result = compactChatHistoryContent(content, { verbatimThreshold: 1000 });

      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(content.length);
      expect(result).toContain("prior_context");
      expect(result).toContain("## Section 1");
      expect(result).toContain("## Section 2");
    });
  });
});
