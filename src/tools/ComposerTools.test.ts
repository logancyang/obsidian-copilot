import { normalizeLineEndings, normalizeForFuzzyMatch, applyEditToContent } from "./ComposerTools";
import { sanitizeFilePath } from "@/utils";

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

describe("normalizeForFuzzyMatch", () => {
  test("should strip trailing whitespace from each line", () => {
    const text = "line1   \nline2\t\nline3";
    const result = normalizeForFuzzyMatch(text);
    expect(result).toBe("line1\nline2\nline3");
  });

  test("should normalize smart single quotes to ASCII apostrophe", () => {
    expect(normalizeForFuzzyMatch("it\u2018s a test")).toBe("it's a test");
    expect(normalizeForFuzzyMatch("it\u2019s a test")).toBe("it's a test");
  });

  test("should normalize smart double quotes to ASCII quotes", () => {
    expect(normalizeForFuzzyMatch("\u201CHello\u201D")).toBe('"Hello"');
  });

  test("should normalize Unicode dashes to hyphen", () => {
    // En-dash, em-dash, minus sign
    expect(normalizeForFuzzyMatch("a\u2013b")).toBe("a-b");
    expect(normalizeForFuzzyMatch("a\u2014b")).toBe("a-b");
    expect(normalizeForFuzzyMatch("a\u2212b")).toBe("a-b");
  });

  test("should normalize non-breaking space to regular space", () => {
    expect(normalizeForFuzzyMatch("hello\u00A0world")).toBe("hello world");
  });

  test("should apply NFKC normalization (fullwidth to ASCII)", () => {
    // Fullwidth digits normalize to regular digits via NFKC
    expect(normalizeForFuzzyMatch("\uFF10\uFF11\uFF12")).toBe("012");
  });

  test("should handle multiline text with mixed artifacts", () => {
    const text = "line1   \nit\u2019s here\nvalue\u00A0=\u00A0\u201Chello\u201D";
    const result = normalizeForFuzzyMatch(text);
    expect(result).toBe('line1\nit\'s here\nvalue = "hello"');
  });

  test("should return empty string unchanged", () => {
    expect(normalizeForFuzzyMatch("")).toBe("");
  });
});

describe("applyEditToContent", () => {
  describe("exact match", () => {
    test("replaces first occurrence when text is unique", () => {
      const content = "Hello world\nGoodbye world";
      const result = applyEditToContent(content, "Hello world", "Hi world");
      expect(result).toEqual({ ok: true, content: "Hi world\nGoodbye world" });
    });

    test("replaces text in the middle of a line", () => {
      const content = "## Attendees\n- Alice\n- Bob";
      const result = applyEditToContent(content, "- Alice\n- Bob", "- Alice\n- Bob\n- Charlie");
      expect(result).toEqual({ ok: true, content: "## Attendees\n- Alice\n- Bob\n- Charlie" });
    });

    test("returns NOT_FOUND when oldText is absent", () => {
      expect(applyEditToContent("Hello world", "Goodbye", "Hi")).toEqual({
        ok: false,
        reason: "NOT_FOUND",
      });
    });

    test("returns AMBIGUOUS when oldText matches more than once", () => {
      const content = "foo\nfoo\nbar";
      const result = applyEditToContent(content, "foo", "baz");
      expect(result).toEqual({ ok: false, reason: "AMBIGUOUS", occurrences: 2 });
    });

    test("returns AMBIGUOUS for overlapping matches", () => {
      // "aba" appears at position 0 and position 2 in "ababa" — overlapping.
      // Non-overlapping counting would report 1 and silently apply; we must
      // detect both and return AMBIGUOUS.
      const result = applyEditToContent("ababa", "aba", "x");
      expect(result).toEqual({ ok: false, reason: "AMBIGUOUS", occurrences: 2 });
    });

    test("supports empty newText (deletion)", () => {
      const result = applyEditToContent("Hello world", "Hello ", "");
      expect(result).toEqual({ ok: true, content: "world" });
    });
  });

  describe("fuzzy match — smart quotes", () => {
    test("matches smart single quotes in file when oldText has straight quotes", () => {
      const content = "it\u2019s a note"; // file has right single quote
      const result = applyEditToContent(content, "it's a note", "updated");
      expect(result).toEqual({ ok: true, content: "updated" });
    });

    test("matches smart double quotes in file when oldText has straight quotes", () => {
      const content = "\u201CHello\u201D world"; // file has curly double quotes
      const result = applyEditToContent(content, '"Hello" world', "updated");
      expect(result).toEqual({ ok: true, content: "updated" });
    });

    test("matches unicode en-dash in file when oldText has hyphen", () => {
      const content = "2020\u20132021 report";
      const result = applyEditToContent(content, "2020-2021 report", "updated");
      expect(result).toEqual({ ok: true, content: "updated" });
    });

    test("matches non-breaking space in file when oldText has regular space", () => {
      const content = "hello\u00A0world";
      const result = applyEditToContent(content, "hello world", "hi there");
      expect(result).toEqual({ ok: true, content: "hi there" });
    });
  });

  describe("fuzzy match — trailing whitespace", () => {
    test("matches line with trailing spaces when oldText has none", () => {
      const content = "line one   \nline two";
      const result = applyEditToContent(content, "line one\nline two", "replaced");
      expect(result).toEqual({ ok: true, content: "replaced" });
    });

    test("matches line with trailing tab when oldText has none", () => {
      const content = "heading\t\ncontent";
      const result = applyEditToContent(content, "heading\ncontent", "replaced");
      expect(result).toEqual({ ok: true, content: "replaced" });
    });
  });

  describe("fuzzy match — rest of file is preserved", () => {
    test("does not apply fuzzy normalization to text outside the matched span", () => {
      // Target line has smart quotes → forces fuzzy match (no exact substring match)
      // Lines outside have their own smart quotes that must NOT be straightened
      const content =
        "intro with \u201Csmart quotes\u201D\n" +
        "use \u201Csmart\u201D style here\n" + // smart quotes in target → forces fuzzy
        "outro with \u201Cmore quotes\u201D";
      // oldText uses straight quotes — no exact match, fuzzy match required
      const result = applyEditToContent(content, 'use "smart" style here', "replaced");
      expect(result).toEqual({
        ok: true,
        content:
          "intro with \u201Csmart quotes\u201D\n" +
          "replaced\n" +
          "outro with \u201Cmore quotes\u201D",
      });
    });

    test("does not strip trailing spaces from lines outside the matched span", () => {
      // Target line has smart quotes → forces fuzzy match
      // Lines before/after have trailing spaces that must survive
      const content = "before line   \nuse \u201Csmart\u201D text\nafter line   ";
      // oldText uses straight quotes — no exact match, fuzzy match required
      const result = applyEditToContent(content, 'use "smart" text', "new text");
      expect(result).toEqual({ ok: true, content: "before line   \nnew text\nafter line   " });
    });

    test("replaces trailing whitespace on matched line when oldText uses tab instead of spaces", () => {
      // File has "line two   " (trailing spaces); oldText has tab → exact match fails,
      // fuzzy match succeeds and the full original line (incl. trailing spaces) is replaced
      const content = "line one\nline two   \nline three";
      const result = applyEditToContent(content, "line two\t", "replaced");
      expect(result).toEqual({ ok: true, content: "line one\nreplaced\nline three" });
    });
  });

  describe("fuzzy match — NFKC expansion", () => {
    test("returns NOT_FOUND when match boundary falls inside an NFKC expansion", () => {
      // "Ⅳ" (U+2163) expands to "IV" under NFKC. Searching for just "I" would
      // land the match-end inside the expansion → degenerate zero-width span → NOT_FOUND.
      const content = "chapter Ⅳ end";
      expect(applyEditToContent(content, "I", "X")).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    test("returns NOT_FOUND when fuzzy match covers only part of an NFKC expansion", () => {
      // "V" fuzzy-matches within "IV" (the NFKC expansion of "Ⅳ"), giving a
      // non-degenerate span [0,1) that covers the whole "Ⅳ" — but "V" is not a
      // standalone character in the file. Round-trip check must reject this.
      const content = "chapter Ⅳ end";
      expect(applyEditToContent(content, "V", "X")).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    test("matches line containing NFKC-expanding character and preserves surrounding content", () => {
      // Ⅳ (U+2163 ROMAN NUMERAL FOUR) expands to 'IV' under NFKC — fuzzy line is longer
      // than the original, so simple column mapping would be wrong.
      const content = "chapter \u2163 title\nnext line";
      // oldText uses the ASCII equivalent that NFKC produces
      const result = applyEditToContent(content, "chapter IV title", "replaced");
      expect(result).toEqual({ ok: true, content: "replaced\nnext line" });
    });

    test("preserves content outside span when NFKC expansion occurs mid-file", () => {
      const content = "intro\nchapter \u2163 end\noutro";
      const result = applyEditToContent(content, "chapter IV end", "new heading");
      expect(result).toEqual({ ok: true, content: "intro\nnew heading\noutro" });
    });
  });

  describe("fuzzy match — multiline", () => {
    test("matches a multiline block with mixed smart quotes and trailing whitespace", () => {
      const content =
        "preamble\n" +
        "## Section  \n" + // trailing spaces
        "- item \u2013 one\n" + // en-dash
        "end";
      const result = applyEditToContent(
        content,
        "## Section\n- item - one",
        "## Section\n- item - two"
      );
      expect(result).toEqual({ ok: true, content: "preamble\n## Section\n- item - two\nend" });
    });
  });

  describe("trailing newline tolerance at EOF", () => {
    test("matches when oldText has trailing newline but file does not", () => {
      const content = "line1\nline2";
      const result = applyEditToContent(content, "line2\n", "replaced\n");
      expect(result).toEqual({ ok: true, content: "line1\nreplaced" });
    });

    test("matches last line via fuzzy when oldText has trailing newline and smart quote", () => {
      const content = "line1\nit\u2019s done"; // smart quote, no trailing newline
      const result = applyEditToContent(content, "it's done\n", "it's finished\n");
      expect(result).toEqual({ ok: true, content: "line1\nit's finished" });
    });

    test("does not strip trailing newline when file itself ends with newline", () => {
      // Exact match should fire in Stage 1; Stage 3 should not interfere
      const content = "line1\nline2\n";
      const result = applyEditToContent(content, "line2\n", "replaced\n");
      expect(result).toEqual({ ok: true, content: "line1\nreplaced\n" });
    });
  });

  describe("line ending preservation", () => {
    test("preserves CRLF line endings after replacement", () => {
      const content = "line1\r\nline2\r\nline3";
      const result = applyEditToContent(content, "line2", "updated");
      expect(result).toEqual({ ok: true, content: "line1\r\nupdated\r\nline3" });
    });

    test("preserves LF line endings after replacement", () => {
      const content = "line1\nline2\nline3";
      const result = applyEditToContent(content, "line2", "updated");
      expect(result).toEqual({ ok: true, content: "line1\nupdated\nline3" });
    });
  });

  describe("BOM preservation", () => {
    test("preserves UTF-8 BOM in the output", () => {
      const content = "\uFEFFHello world";
      const result = applyEditToContent(content, "Hello", "Hi");
      expect(result).toEqual({ ok: true, content: "\uFEFFHi world" });
      if (result.ok) {
        expect(result.content.charCodeAt(0)).toBe(0xfeff);
      }
    });
  });
});

describe("sanitizeFilePath", () => {
  test("should return path unchanged when basename is within limits", () => {
    expect(sanitizeFilePath("folder/short-name.md")).toBe("folder/short-name.md");
  });

  test("should return path unchanged for root-level files", () => {
    expect(sanitizeFilePath("readme.md")).toBe("readme.md");
  });

  test("should truncate a basename that exceeds 255 bytes", () => {
    // Create a filename with 300 ASCII characters + .md extension
    const longName = "a".repeat(300) + ".md";
    const result = sanitizeFilePath(`folder/${longName}`);
    const basename = result.split("/").pop()!;

    expect(new TextEncoder().encode(basename).length).toBeLessThanOrEqual(255);
    expect(basename.endsWith(".md")).toBe(true);
    expect(result.startsWith("folder/")).toBe(true);
  });

  test("should handle multi-byte Cyrillic characters correctly", () => {
    // Cyrillic characters are 2 bytes each in UTF-8
    // 128 Cyrillic chars = 256 bytes, which exceeds the 255-byte limit
    const longCyrillicName = "А".repeat(128) + ".md";
    const result = sanitizeFilePath(longCyrillicName);
    const byteLength = new TextEncoder().encode(result).length;

    expect(byteLength).toBeLessThanOrEqual(255);
    expect(result.endsWith(".md")).toBe(true);
  });

  test("should handle the exact bug report scenario: long Cyrillic filename", () => {
    const longName =
      "Интервью_О._Югина_глобальные_кризисы_экономика_США_Китая_России_AI_и_инвестиции.md";
    const result = sanitizeFilePath(`Документы/Library/${longName}`);
    const basename = result.split("/").pop()!;
    const byteLength = new TextEncoder().encode(basename).length;

    // This particular filename is ~146 bytes, well within limits
    // But verify the function handles it correctly either way
    expect(byteLength).toBeLessThanOrEqual(255);
    expect(result.startsWith("Документы/Library/")).toBe(true);
  });

  test("should preserve deep folder paths and only truncate basename", () => {
    const longName = "x".repeat(300) + ".canvas";
    const result = sanitizeFilePath(`a/b/c/d/${longName}`);
    const parts = result.split("/");

    expect(parts.slice(0, -1).join("/")).toBe("a/b/c/d");
    expect(new TextEncoder().encode(parts[parts.length - 1]).length).toBeLessThanOrEqual(255);
    expect(result.endsWith(".canvas")).toBe(true);
  });

  test("should handle file without extension", () => {
    const longName = "a".repeat(300);
    const result = sanitizeFilePath(longName);

    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(255);
  });

  test("should not break multi-byte characters when truncating", () => {
    // 4-byte emoji characters: ensure we don't split in the middle
    const longName = "\u{1F600}".repeat(80) + ".md"; // 80 emoji × 4 bytes = 320 bytes + .md
    const result = sanitizeFilePath(longName);
    const basename = result.split("/").pop()!;
    const byteLength = new TextEncoder().encode(basename).length;

    expect(byteLength).toBeLessThanOrEqual(255);
    expect(result.endsWith(".md")).toBe(true);
    // Ensure no broken characters (would result in replacement characters)
    expect(result).not.toContain("\uFFFD");
  });
});
