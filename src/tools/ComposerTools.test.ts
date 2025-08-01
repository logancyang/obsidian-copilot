import {
  parseSearchReplaceBlocks,
  normalizeLineEndings,
  replaceWithLineEndingAwareness,
} from "./ComposerTools";

describe("parseSearchReplaceBlocks", () => {
  describe("Standard format", () => {
    test("should parse basic SEARCH/REPLACE block with newlines", () => {
      const diff = `------- SEARCH
old text here
=======
new text here
+++++++ REPLACE`;

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text",
        replaceText: "new text",
      });
    });

    test("should handle minimal markers", () => {
      const diff = "---SEARCHtest===replacement+++REPLACE";

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        searchText: "old text",
        replaceText: "new text",
      });
    });

    test("should handle mixed line endings", () => {
      const diff = "------- SEARCH\nold text\r\n=======\nnew text\r\n+++++++ REPLACE";

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

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

      const result = parseSearchReplaceBlocks(diff);

      expect(result).toHaveLength(0);
    });

    test("should return empty array for incomplete block", () => {
      const diff = `------- SEARCH
old text
=======
new text`;

      const result = parseSearchReplaceBlocks(diff);

      expect(result).toHaveLength(0);
    });

    test("should handle empty diff string", () => {
      const result = parseSearchReplaceBlocks("");

      expect(result).toHaveLength(0);
    });

    test("should handle case sensitivity in markers", () => {
      const diff = `------- search
old text
=======
new text
+++++++ replace`;

      const result = parseSearchReplaceBlocks(diff);

      expect(result).toHaveLength(0);
    });
  });
});

describe("normalizeLineEndings", () => {
  test("should normalize CRLF to LF", () => {
    const text = "line1\r\nline2\r\nline3";
    const result = normalizeLineEndings(text);
    expect(result).toBe("line1\nline2\nline3");
  });

  test("should normalize CR to LF", () => {
    const text = "line1\rline2\rline3";
    const result = normalizeLineEndings(text);
    expect(result).toBe("line1\nline2\nline3");
  });

  test("should leave LF unchanged", () => {
    const text = "line1\nline2\nline3";
    const result = normalizeLineEndings(text);
    expect(result).toBe("line1\nline2\nline3");
  });

  test("should handle mixed line endings", () => {
    const text = "line1\r\nline2\nline3\rline4";
    const result = normalizeLineEndings(text);
    expect(result).toBe("line1\nline2\nline3\nline4");
  });

  test("should handle empty string", () => {
    const result = normalizeLineEndings("");
    expect(result).toBe("");
  });

  test("should handle string without line endings", () => {
    const text = "single line text";
    const result = normalizeLineEndings(text);
    expect(result).toBe("single line text");
  });
});

describe("replaceWithLineEndingAwareness", () => {
  describe("CRLF files", () => {
    test("should preserve CRLF when file predominantly uses CRLF", () => {
      const content = "line1\r\nold text\r\nline3\r\n";
      const searchText = "old text";
      const replaceText = "new text";

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("line1\r\nnew text\r\nline3\r\n");
    });

    test("should work when search text has different line endings than file", () => {
      const content = "line1\r\nold\r\ntext\r\nline3\r\n";
      const searchText = "old\ntext"; // LF in search text
      const replaceText = "new\ntext"; // LF in replace text

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("line1\r\nnew\r\ntext\r\nline3\r\n"); // Result preserves CRLF
    });

    test("should handle multiline replacement with CRLF", () => {
      const content = "function test() {\r\n  return 'old';\r\n}\r\n";
      const searchText = "function test() {\n  return 'old';\n}";
      const replaceText = "function test() {\n  return 'new';\n}";

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("function test() {\r\n  return 'new';\r\n}\r\n");
    });
  });

  describe("LF files", () => {
    test("should preserve LF when file predominantly uses LF", () => {
      const content = "line1\nold text\nline3\n";
      const searchText = "old text";
      const replaceText = "new text";

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("line1\nnew text\nline3\n");
    });

    test("should work when search text has different line endings than file", () => {
      const content = "line1\nold\ntext\nline3\n";
      const searchText = "old\r\ntext"; // CRLF in search text
      const replaceText = "new\r\ntext"; // CRLF in replace text

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("line1\nnew\ntext\nline3\n"); // Result preserves LF
    });
  });

  describe("Mixed line ending handling", () => {
    test("should choose CRLF when CRLF is more common", () => {
      const content = "line1\r\nline2\r\nold text\nline4\r\n"; // 3 CRLF, 1 LF
      const searchText = "old text";
      const replaceText = "new text";

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("line1\r\nline2\r\nnew text\r\nline4\r\n");
    });

    test("should choose LF when LF is more common", () => {
      const content = "line1\nline2\nold text\r\nline4\n"; // 3 LF, 1 CRLF
      const searchText = "old text";
      const replaceText = "new text";

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("line1\nline2\nnew text\nline4\n");
    });

    test("should default to LF when counts are equal", () => {
      const content = "line1\r\nold text\nline3"; // 1 CRLF, 1 LF
      const searchText = "old text";
      const replaceText = "new text";

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("line1\nnew text\nline3"); // Defaults to LF
    });
  });

  describe("Edge cases", () => {
    test("should handle empty search text (edge case behavior)", () => {
      const content = "ab";
      const searchText = "";
      const replaceText = "x";

      // Empty string replacement inserts between every character (JavaScript's replaceAll behavior)
      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("xaxbx");
    });

    test("should handle empty replace text (deletion)", () => {
      const content = "line1\r\nto delete\r\nline3\r\n";
      const searchText = "to delete\r\n";
      const replaceText = "";

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("line1\r\nline3\r\n");
    });

    test("should handle no line endings in content", () => {
      const content = "old text without line endings";
      const searchText = "old text";
      const replaceText = "new text";

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("new text without line endings");
    });

    test("should handle multiple occurrences", () => {
      const content = "old\r\ntest old\r\nmore old\r\n";
      const searchText = "old";
      const replaceText = "new";

      const result = replaceWithLineEndingAwareness(content, searchText, replaceText);
      expect(result).toBe("new\r\ntest new\r\nmore new\r\n");
    });
  });
});
