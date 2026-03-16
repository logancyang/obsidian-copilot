import { normalizeLineEndings, normalizeForFuzzyMatch } from "./ComposerTools";
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
