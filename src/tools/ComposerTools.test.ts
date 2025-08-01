// Standalone copy of parseSearchReplaceBlocks for testing to avoid Obsidian dependencies
function parseSearchReplaceBlocksStandalone(
  diff: string
): Array<{ searchText: string; replaceText: string }> {
  const blocks: Array<{ searchText: string; replaceText: string }> = [];

  const SEARCH_MARKER = /-{3,}\s*SEARCH\s*(?:\r?\n)?/;
  const SEPARATOR = /(?:\r?\n)?={3,}\s*(?:\r?\n)?/;
  const REPLACE_MARKER = /(?:\r?\n)?\+{3,}\s*REPLACE/;

  // Fix: Use direct regex construction instead of template string to avoid escape issues
  const blockRegex = new RegExp(
    SEARCH_MARKER.source +
      "([\\s\\S]*?)" +
      SEPARATOR.source +
      "([\\s\\S]*?)" +
      REPLACE_MARKER.source,
    "g"
  );

  let match;
  while ((match = blockRegex.exec(diff)) !== null) {
    const searchText = match[1].trim();
    const replaceText = match[2].trim();
    blocks.push({ searchText, replaceText });
  }

  return blocks;
}

describe("parseSearchReplaceBlocksStandalone", () => {
  describe("Standard format", () => {
    test("should parse basic SEARCH/REPLACE block with newlines", () => {
      const diff = `------- SEARCH
old text here
=======
new text here
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text here",
        replaceText: "new text here",
      });
    });

    test("should parse multiline content", () => {
      const diff = `------- SEARCH
function oldFunction() {
  return "old";
}
=======
function newFunction() {
  return "new";
}
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0].searchText).toBe(`function oldFunction() {
  return "old";
}`);
      expect(result[0].replaceText).toBe(`function newFunction() {
  return "new";
}`);
    });
  });

  describe("Flexible format without newlines", () => {
    test("should parse compact format without newlines", () => {
      const diff = "-------SEARCHold text=======new text+++++++REPLACE";

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text",
        replaceText: "new text",
      });
    });

    test("should handle minimal markers", () => {
      const diff = "---SEARCHtest===replacement+++REPLACE";

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "test",
        replaceText: "replacement",
      });
    });
  });

  describe("Different line endings", () => {
    test("should handle Windows line endings (\\r\\n)", () => {
      const diff = "------- SEARCH\r\nold text\r\n=======\r\nnew text\r\n+++++++ REPLACE";

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text",
        replaceText: "new text",
      });
    });

    test("should handle mixed line endings", () => {
      const diff = "------- SEARCH\nold text\r\n=======\nnew text\r\n+++++++ REPLACE";

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text",
        replaceText: "new text",
      });
    });
  });

  describe("Multiple blocks", () => {
    test("should parse multiple SEARCH/REPLACE blocks", () => {
      const diff = `------- SEARCH
first old text
=======
first new text
+++++++ REPLACE

------- SEARCH
second old text
=======
second new text
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        searchText: "first old text",
        replaceText: "first new text",
      });
      expect(result[1]).toEqual({
        searchText: "second old text",
        replaceText: "second new text",
      });
    });

    test("should parse multiple blocks with different formatting", () => {
      const diff = `------- SEARCH
block1 search
=======
block1 replace
+++++++ REPLACE
-------SEARCHblock2 search=======block2 replace+++++++REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        searchText: "block1 search",
        replaceText: "block1 replace",
      });
      expect(result[1]).toEqual({
        searchText: "block2 search",
        replaceText: "block2 replace",
      });
    });
  });

  describe("Whitespace handling", () => {
    test("should trim whitespace from search and replace text", () => {
      const diff = `------- SEARCH
   old text with spaces   
=======
   new text with spaces   
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text with spaces",
        replaceText: "new text with spaces",
      });
    });

    test("should handle spaces in markers", () => {
      const diff = `-------   SEARCH   
old text
=======
new text
+++++++   REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text",
        replaceText: "new text",
      });
    });
  });

  describe("Special characters", () => {
    test("should handle special regex characters in content", () => {
      const diff = `------- SEARCH
function test() { return /regex.*pattern/g; }
=======
function test() { return /new.*pattern/g; }
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0].searchText).toBe("function test() { return /regex.*pattern/g; }");
      expect(result[0].replaceText).toBe("function test() { return /new.*pattern/g; }");
    });

    test("should handle Unicode characters", () => {
      const diff = `------- SEARCH
这是测试文本
=======
这是新文本
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "这是测试文本",
        replaceText: "这是新文本",
      });
    });
  });

  describe("Empty content", () => {
    test("should handle empty search text", () => {
      const diff = `------- SEARCH
=======
new content to add
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "",
        replaceText: "new content to add",
      });
    });

    test("should handle empty replace text (deletion)", () => {
      const diff = `------- SEARCH
content to delete
=======
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "content to delete",
        replaceText: "",
      });
    });
  });

  describe("Variable marker lengths", () => {
    test("should handle different numbers of dashes", () => {
      const diff = `----------- SEARCH
old text
=======
new text
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text",
        replaceText: "new text",
      });
    });

    test("should handle different numbers of equals and plus signs", () => {
      const diff = `------- SEARCH
old text
===========
new text
+++++++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text",
        replaceText: "new text",
      });
    });
  });

  describe("Edge cases and invalid formats", () => {
    test("should return empty array for invalid format", () => {
      const diff = "invalid format without proper markers";

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(0);
    });

    test("should return empty array for incomplete block", () => {
      const diff = `------- SEARCH
old text
=======
new text`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(0);
    });

    test("should handle empty diff string", () => {
      const result = parseSearchReplaceBlocksStandalone("");

      expect(result).toHaveLength(0);
    });

    test("should ignore incomplete blocks and parse valid ones", () => {
      const diff = `------- SEARCH
incomplete block
=======
missing replace marker

------- SEARCH
valid block
=======
valid replacement
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "valid block",
        replaceText: "valid replacement",
      });
    });

    test("should handle case sensitivity in markers", () => {
      const diff = `------- search
old text
=======
new text
+++++++ replace`;

      const result = parseSearchReplaceBlocksStandalone(diff);

      expect(result).toHaveLength(0);
    });
  });
});
