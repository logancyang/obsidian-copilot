import { escapeXml, escapeXmlAttribute, unescapeXml } from "./xmlParsing";

/**
 * Tests for XML escape/unescape utilities.
 * These functions are used for context envelope processing, not tool calling.
 * Tool calling now uses native LangChain bindTools() - no XML parsing needed.
 */

describe("escapeXml", () => {
  it("should escape ampersands", () => {
    expect(escapeXml("foo & bar")).toBe("foo &amp; bar");
  });

  it("should escape less than signs", () => {
    expect(escapeXml("foo < bar")).toBe("foo &lt; bar");
  });

  it("should escape greater than signs", () => {
    expect(escapeXml("foo > bar")).toBe("foo &gt; bar");
  });

  it("should escape double quotes", () => {
    expect(escapeXml('foo "bar" baz')).toBe("foo &quot;bar&quot; baz");
  });

  it("should escape single quotes", () => {
    expect(escapeXml("foo 'bar' baz")).toBe("foo &apos;bar&apos; baz");
  });

  it("should escape multiple special characters", () => {
    expect(escapeXml('<tag attr="value">content & more</tag>')).toBe(
      "&lt;tag attr=&quot;value&quot;&gt;content &amp; more&lt;/tag&gt;"
    );
  });

  it("should handle empty strings", () => {
    expect(escapeXml("")).toBe("");
  });

  it("should handle strings with no special characters", () => {
    expect(escapeXml("hello world")).toBe("hello world");
  });

  it("should handle non-string inputs", () => {
    expect(escapeXml(null as any)).toBe("");
    expect(escapeXml(undefined as any)).toBe("");
    expect(escapeXml(123 as any)).toBe("");
  });

  it("should escape XML entity references", () => {
    expect(escapeXml("&lt;&gt;&quot;&apos;&amp;")).toBe(
      "&amp;lt;&amp;gt;&amp;quot;&amp;apos;&amp;amp;"
    );
  });
});

describe("unescapeXml", () => {
  it("should unescape ampersands", () => {
    expect(unescapeXml("foo &amp; bar")).toBe("foo & bar");
  });

  it("should unescape less than signs", () => {
    expect(unescapeXml("foo &lt; bar")).toBe("foo < bar");
  });

  it("should unescape greater than signs", () => {
    expect(unescapeXml("foo &gt; bar")).toBe("foo > bar");
  });

  it("should unescape double quotes", () => {
    expect(unescapeXml("foo &quot;bar&quot; baz")).toBe('foo "bar" baz');
  });

  it("should unescape single quotes", () => {
    expect(unescapeXml("foo &apos;bar&apos; baz")).toBe("foo 'bar' baz");
  });

  it("should unescape multiple entities", () => {
    expect(unescapeXml("&lt;tag attr=&quot;value&quot;&gt;content &amp; more&lt;/tag&gt;")).toBe(
      '<tag attr="value">content & more</tag>'
    );
  });

  it("should handle empty strings", () => {
    expect(unescapeXml("")).toBe("");
  });

  it("should handle strings with no entities", () => {
    expect(unescapeXml("hello world")).toBe("hello world");
  });

  it("should handle non-string inputs", () => {
    expect(unescapeXml(null as any)).toBe("");
    expect(unescapeXml(undefined as any)).toBe("");
    expect(unescapeXml(123 as any)).toBe("");
  });

  it("should handle double-escaped ampersand correctly", () => {
    // &amp;amp; should become &amp; (not &) - unescaping once
    expect(unescapeXml("&amp;amp;")).toBe("&amp;");
  });
});

describe("escapeXmlAttribute", () => {
  it("should escape attribute values the same as escapeXml", () => {
    const testString = '<tag attr="value">content & more</tag>';
    expect(escapeXmlAttribute(testString)).toBe(escapeXml(testString));
  });

  it("should handle variable names with special characters", () => {
    expect(escapeXmlAttribute('my"variable')).toBe("my&quot;variable");
    expect(escapeXmlAttribute("my'variable")).toBe("my&apos;variable");
    expect(escapeXmlAttribute("my<variable>")).toBe("my&lt;variable&gt;");
  });
});

describe("roundtrip escapeXml -> unescapeXml", () => {
  it("should preserve original string after roundtrip", () => {
    const original = '<tag attr="value">text & more</tag>';
    expect(unescapeXml(escapeXml(original))).toBe(original);
  });

  it("should preserve URL with special characters", () => {
    const url = "https://example.com/path?param=value&other=<test>";
    expect(unescapeXml(escapeXml(url))).toBe(url);
  });

  it("should preserve markdown content with special characters", () => {
    const markdown = "Use `<code>` for inline code & **bold** text";
    expect(unescapeXml(escapeXml(markdown))).toBe(markdown);
  });
});
