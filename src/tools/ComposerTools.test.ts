import { normalizeLineEndings, normalizeForFuzzyMatch, applyEditToContent } from "./ComposerTools";

describe("ComposerTools", () => {
  describe("normalizeLineEndings()", () => {
    it("normalizes CRLF to LF", () => {
      const text = "line1\r\nline2\r\nline3";
      const result = normalizeLineEndings(text);
      expect(result).toBe("line1\nline2\nline3");
    });

    it("normalizes CR to LF", () => {
      const text = "line1\rline2\rline3";
      const result = normalizeLineEndings(text);
      expect(result).toBe("line1\nline2\nline3");
    });

    it("leaves LF unchanged", () => {
      const text = "line1\nline2\nline3";
      const result = normalizeLineEndings(text);
      expect(result).toBe("line1\nline2\nline3");
    });

    it("normalizes a mix of CRLF, LF and CR in one string", () => {
      const text = "line1\r\nline2\nline3\rline4";
      const result = normalizeLineEndings(text);
      expect(result).toBe("line1\nline2\nline3\nline4");
    });

    it("returns an empty string unchanged", () => {
      const result = normalizeLineEndings("");
      expect(result).toBe("");
    });
  });

  describe("normalizeForFuzzyMatch()", () => {
    it("strips trailing whitespace from each line", () => {
      const text = "line1   \nline2\t\nline3";
      const result = normalizeForFuzzyMatch(text);
      expect(result).toBe("line1\nline2\nline3");
    });

    it("normalizes smart single quotes to ASCII apostrophe", () => {
      expect(normalizeForFuzzyMatch("it\u2018s a test")).toBe("it's a test");
      expect(normalizeForFuzzyMatch("it\u2019s a test")).toBe("it's a test");
    });

    it("normalizes smart double quotes to ASCII quotes", () => {
      expect(normalizeForFuzzyMatch("\u201CHello\u201D")).toBe('"Hello"');
    });

    it("normalizes Unicode dashes to hyphen", () => {
      expect(normalizeForFuzzyMatch("a\u2013b")).toBe("a-b");
      expect(normalizeForFuzzyMatch("a\u2014b")).toBe("a-b");
      expect(normalizeForFuzzyMatch("a\u2212b")).toBe("a-b");
    });

    it("normalizes non-breaking space to regular space", () => {
      expect(normalizeForFuzzyMatch("hello\u00A0world")).toBe("hello world");
    });

    it("applies NFKC normalization (fullwidth to ASCII)", () => {
      expect(normalizeForFuzzyMatch("\uFF10\uFF11\uFF12")).toBe("012");
    });

    it("normalizes trailing whitespace, smart quotes and non-breaking spaces across several lines", () => {
      const text = "line1   \nit\u2019s here\nvalue\u00A0=\u00A0\u201Chello\u201D";
      const result = normalizeForFuzzyMatch(text);
      expect(result).toBe('line1\nit\'s here\nvalue = "hello"');
    });

    it("returns an empty string unchanged", () => {
      expect(normalizeForFuzzyMatch("")).toBe("");
    });
  });

  describe("applyEditToContent()", () => {
    it("replaces the only occurrence of oldText", () => {
      const content = "Hello world\nGoodbye world";
      const result = applyEditToContent(content, "Hello world", "Hi world");
      expect(result).toEqual({ ok: true, content: "Hi world\nGoodbye world" });
    });

    it("replaces a multi-line oldText span and keeps the surrounding lines", () => {
      const content = "## Attendees\n- Alice\n- Bob";
      const result = applyEditToContent(content, "- Alice\n- Bob", "- Alice\n- Bob\n- Charlie");
      expect(result).toEqual({ ok: true, content: "## Attendees\n- Alice\n- Bob\n- Charlie" });
    });

    it("returns NOT_FOUND when oldText is absent", () => {
      expect(applyEditToContent("Hello world", "Goodbye", "Hi")).toEqual({
        ok: false,
        reason: "NOT_FOUND",
      });
    });

    it("returns AMBIGUOUS when oldText matches more than once", () => {
      const content = "foo\nfoo\nbar";
      const result = applyEditToContent(content, "foo", "baz");
      expect(result).toEqual({ ok: false, reason: "AMBIGUOUS", occurrences: 2 });
    });

    it("returns AMBIGUOUS for overlapping matches", () => {
      const result = applyEditToContent("ababa", "aba", "x");
      expect(result).toEqual({ ok: false, reason: "AMBIGUOUS", occurrences: 2 });
    });

    it("deletes oldText when newText is empty", () => {
      const result = applyEditToContent("Hello world", "Hello ", "");
      expect(result).toEqual({ ok: true, content: "world" });
    });

    it("matches a smart single quote in the file against a straight quote in oldText", () => {
      const content = "it\u2019s a note";
      const result = applyEditToContent(content, "it's a note", "updated");
      expect(result).toEqual({ ok: true, content: "updated" });
    });

    it("matches smart double quotes in the file against straight quotes in oldText", () => {
      const content = "\u201CHello\u201D world";
      const result = applyEditToContent(content, '"Hello" world', "updated");
      expect(result).toEqual({ ok: true, content: "updated" });
    });

    it("matches an en-dash in the file against a hyphen in oldText", () => {
      const content = "2020\u20132021 report";
      const result = applyEditToContent(content, "2020-2021 report", "updated");
      expect(result).toEqual({ ok: true, content: "updated" });
    });

    it("matches a non-breaking space in the file against a regular space in oldText", () => {
      const content = "hello\u00A0world";
      const result = applyEditToContent(content, "hello world", "hi there");
      expect(result).toEqual({ ok: true, content: "hi there" });
    });

    it("matches a file line with trailing spaces against oldText without them", () => {
      const content = "line one   \nline two";
      const result = applyEditToContent(content, "line one\nline two", "replaced");
      expect(result).toEqual({ ok: true, content: "replaced" });
    });

    it("keeps smart quotes outside the matched span untouched after a fuzzy match", () => {
      const content =
        "intro with \u201Csmart quotes\u201D\n" +
        "use \u201Csmart\u201D style here\n" +
        "outro with \u201Cmore quotes\u201D";
      const result = applyEditToContent(content, 'use "smart" style here', "replaced");
      expect(result).toEqual({
        ok: true,
        content:
          "intro with \u201Csmart quotes\u201D\n" +
          "replaced\n" +
          "outro with \u201Cmore quotes\u201D",
      });
    });

    it("keeps trailing spaces on lines outside the matched span after a fuzzy match", () => {
      const content = "before line   \nuse \u201Csmart\u201D text\nafter line   ";
      const result = applyEditToContent(content, 'use "smart" text', "new text");
      expect(result).toEqual({ ok: true, content: "before line   \nnew text\nafter line   " });
    });

    it("replaces the trailing whitespace of the matched line when oldText ends with a tab instead of spaces", () => {
      const content = "line one\nline two   \nline three";
      const result = applyEditToContent(content, "line two\t", "replaced");
      expect(result).toEqual({ ok: true, content: "line one\nreplaced\nline three" });
    });

    it('returns NOT_FOUND when oldText "I" would split the NFKC expansion of "Ⅳ"', () => {
      const content = "chapter Ⅳ end";
      expect(applyEditToContent(content, "I", "X")).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it('returns NOT_FOUND when oldText "V" would split the NFKC expansion of "Ⅳ"', () => {
      const content = "chapter Ⅳ end";
      expect(applyEditToContent(content, "V", "X")).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it("matches a line containing an NFKC-expanding character and keeps the next line", () => {
      const content = "chapter \u2163 title\nnext line";
      const result = applyEditToContent(content, "chapter IV title", "replaced");
      expect(result).toEqual({ ok: true, content: "replaced\nnext line" });
    });

    it("keeps content before and after the span when an NFKC expansion occurs mid-file", () => {
      const content = "intro\nchapter \u2163 end\noutro";
      const result = applyEditToContent(content, "chapter IV end", "new heading");
      expect(result).toEqual({ ok: true, content: "intro\nnew heading\noutro" });
    });

    it("matches a multiline block with an en-dash and trailing whitespace", () => {
      const content = "preamble\n" + "## Section  \n" + "- item \u2013 one\n" + "end";
      const result = applyEditToContent(
        content,
        "## Section\n- item - one",
        "## Section\n- item - two"
      );
      expect(result).toEqual({ ok: true, content: "preamble\n## Section\n- item - two\nend" });
    });

    it("matches at end of file when oldText has a trailing newline the file lacks", () => {
      const content = "line1\nline2";
      const result = applyEditToContent(content, "line2\n", "replaced\n");
      expect(result).toEqual({ ok: true, content: "line1\nreplaced" });
    });

    it("fuzzy-matches the last line when oldText has a trailing newline and a straight quote", () => {
      const content = "line1\nit\u2019s done";
      const result = applyEditToContent(content, "it's done\n", "it's finished\n");
      expect(result).toEqual({ ok: true, content: "line1\nit's finished" });
    });

    it("keeps the final newline when the file itself ends with a newline", () => {
      const content = "line1\nline2\n";
      const result = applyEditToContent(content, "line2\n", "replaced\n");
      expect(result).toEqual({ ok: true, content: "line1\nreplaced\n" });
    });

    it("keeps CRLF line endings after replacement", () => {
      const content = "line1\r\nline2\r\nline3";
      const result = applyEditToContent(content, "line2", "updated");
      expect(result).toEqual({ ok: true, content: "line1\r\nupdated\r\nline3" });
    });

    it("keeps a leading UTF-8 BOM in the output", () => {
      const content = "\uFEFFHello world";
      const result = applyEditToContent(content, "Hello", "Hi");
      expect(result).toEqual({ ok: true, content: "\uFEFFHi world" });
      if (result.ok) {
        expect(result.content.charCodeAt(0)).toBe(0xfeff);
      }
    });
  });
});
