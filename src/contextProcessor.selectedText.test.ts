/**
 * Tests for processSelectedTextContexts in ContextProcessor
 *
 * Verifies that note and web selected text contexts are correctly
 * formatted with appropriate XML tags.
 */

import { SELECTED_TEXT_TAG, WEB_SELECTED_TEXT_TAG } from "@/constants";
import { NoteSelectedTextContext, WebSelectedTextContext } from "@/types/message";

// Mock the aiParams module
const mockSelectedTextContexts: (NoteSelectedTextContext | WebSelectedTextContext)[] = [];

jest.mock("@/aiParams", () => ({
  getSelectedTextContexts: () => mockSelectedTextContexts,
}));

// Import after mocking
import { ContextProcessor } from "@/contextProcessor";

describe("ContextProcessor.processSelectedTextContexts", () => {
  let processor: ContextProcessor;

  beforeEach(() => {
    // Clear mock data
    mockSelectedTextContexts.length = 0;

    // Get singleton instance
    processor = ContextProcessor.getInstance();
  });

  it("should return empty string when no selected text contexts", () => {
    const result = processor.processSelectedTextContexts();
    expect(result).toBe("");
  });

  it("should format note selected text with proper XML tags", () => {
    const noteContext: NoteSelectedTextContext = {
      id: "note-1",
      sourceType: "note",
      content: "function fibonacci(n) {\n  return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2);\n}",
      noteTitle: "Algorithms",
      notePath: "dev/algorithms.md",
      startLine: 10,
      endLine: 12,
    };

    mockSelectedTextContexts.push(noteContext);

    const result = processor.processSelectedTextContexts();

    expect(result).toContain(`<${SELECTED_TEXT_TAG}>`);
    expect(result).toContain(`</${SELECTED_TEXT_TAG}>`);
    expect(result).toContain("<title>Algorithms</title>");
    expect(result).toContain("<path>dev/algorithms.md</path>");
    expect(result).toContain("<start_line>10</start_line>");
    expect(result).toContain("<end_line>12</end_line>");
    expect(result).toContain("<content>");
    expect(result).toContain("function fibonacci");
    expect(result).toContain("</content>");

    // Should NOT contain web-specific tags
    expect(result).not.toContain(`<${WEB_SELECTED_TEXT_TAG}>`);
    expect(result).not.toContain("<url>");
  });

  it("should format web selected text with proper XML tags", () => {
    const webContext: WebSelectedTextContext = {
      id: "web-1",
      sourceType: "web",
      content:
        "# React Documentation\n\nReact is a JavaScript library for building user interfaces.",
      title: "React Docs",
      url: "https://react.dev/learn",
    };

    mockSelectedTextContexts.push(webContext);

    const result = processor.processSelectedTextContexts();

    expect(result).toContain(`<${WEB_SELECTED_TEXT_TAG}>`);
    expect(result).toContain(`</${WEB_SELECTED_TEXT_TAG}>`);
    expect(result).toContain("<title>React Docs</title>");
    expect(result).toContain("<url>https://react.dev/learn</url>");
    expect(result).toContain("<content>");
    expect(result).toContain("React Documentation");
    expect(result).toContain("</content>");

    // Should NOT contain note-specific tags
    expect(result).not.toContain(`<${SELECTED_TEXT_TAG}>`);
    expect(result).not.toContain("<path>");
    expect(result).not.toContain("<start_line>");
    expect(result).not.toContain("<end_line>");
  });

  it("should handle mixed note and web selected text contexts", () => {
    const noteContext: NoteSelectedTextContext = {
      id: "note-1",
      sourceType: "note",
      content: "Local note content about React patterns",
      noteTitle: "React Patterns",
      notePath: "dev/react-patterns.md",
      startLine: 15,
      endLine: 20,
    };

    const webContext: WebSelectedTextContext = {
      id: "web-1",
      sourceType: "web",
      content: "Web content about React best practices",
      title: "React Best Practices",
      url: "https://react.dev/best-practices",
    };

    mockSelectedTextContexts.push(noteContext, webContext);

    const result = processor.processSelectedTextContexts();

    // Verify both context types are present
    expect(result).toContain(`<${SELECTED_TEXT_TAG}>`);
    expect(result).toContain(`</${SELECTED_TEXT_TAG}>`);
    expect(result).toContain(`<${WEB_SELECTED_TEXT_TAG}>`);
    expect(result).toContain(`</${WEB_SELECTED_TEXT_TAG}>`);

    // Verify note selection has path and line numbers
    expect(result).toContain("<path>dev/react-patterns.md</path>");
    expect(result).toContain("<start_line>15</start_line>");
    expect(result).toContain("<end_line>20</end_line>");

    // Verify web selection has url
    expect(result).toContain("<url>https://react.dev/best-practices</url>");

    // Verify content from both
    expect(result).toContain("Local note content about React patterns");
    expect(result).toContain("Web content about React best practices");
  });

  it("should escape XML special characters in content", () => {
    const noteContext: NoteSelectedTextContext = {
      id: "note-1",
      sourceType: "note",
      content: 'Code with <tags> & special "chars"',
      noteTitle: "Test <Note>",
      notePath: "test/path&file.md",
      startLine: 1,
      endLine: 1,
    };

    mockSelectedTextContexts.push(noteContext);

    const result = processor.processSelectedTextContexts();

    // Title and path should be escaped
    expect(result).toContain("<title>Test &lt;Note&gt;</title>");
    expect(result).toContain("<path>test/path&amp;file.md</path>");
  });

  it("should escape XML special characters in web context", () => {
    const webContext: WebSelectedTextContext = {
      id: "web-1",
      sourceType: "web",
      content: "Content with <html> tags",
      title: "Page <Title>",
      url: "https://example.com/page?a=1&b=2",
    };

    mockSelectedTextContexts.push(webContext);

    const result = processor.processSelectedTextContexts();

    // Title and URL should be escaped
    expect(result).toContain("<title>Page &lt;Title&gt;</title>");
    expect(result).toContain("<url>https://example.com/page?a=1&amp;b=2</url>");
  });
});
