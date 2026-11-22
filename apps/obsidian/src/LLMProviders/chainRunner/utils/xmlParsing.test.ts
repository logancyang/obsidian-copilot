import { escapeXml, unescapeXml } from "./xmlParsing";

describe("xmlParsing", () => {
  describe("escapeXml()", () => {
    it.each([
      ["an ampersand", "foo & bar", "foo &amp; bar"],
      ["a less-than sign", "foo < bar", "foo &lt; bar"],
      ["a greater-than sign", "foo > bar", "foo &gt; bar"],
      ["double quotes", 'foo "bar" baz', "foo &quot;bar&quot; baz"],
      ["single quotes", "foo 'bar' baz", "foo &apos;bar&apos; baz"],
    ])("escapes %s", (_label, input, expected) => {
      expect(escapeXml(input)).toBe(expected);
    });

    it("escapes every special character in markup", () => {
      expect(escapeXml('<tag attr="value">content & more</tag>')).toBe(
        "&lt;tag attr=&quot;value&quot;&gt;content &amp; more&lt;/tag&gt;"
      );
    });

    it("escapes the ampersand of text that already looks like an entity", () => {
      expect(escapeXml("&lt;&gt;&quot;&apos;&amp;")).toBe(
        "&amp;lt;&amp;gt;&amp;quot;&amp;apos;&amp;amp;"
      );
    });

    it("returns plain and empty strings unchanged", () => {
      expect(escapeXml("hello world")).toBe("hello world");
      expect(escapeXml("")).toBe("");
    });

    it("returns an empty string for non-string input", () => {
      expect(escapeXml(null)).toBe("");
      expect(escapeXml(undefined)).toBe("");
      expect(escapeXml(123)).toBe("");
    });
  });

  describe("unescapeXml()", () => {
    it.each([
      ["an ampersand", "foo &amp; bar", "foo & bar"],
      ["a less-than sign", "foo &lt; bar", "foo < bar"],
      ["a greater-than sign", "foo &gt; bar", "foo > bar"],
      ["double quotes", "foo &quot;bar&quot; baz", 'foo "bar" baz'],
      ["single quotes", "foo &apos;bar&apos; baz", "foo 'bar' baz"],
    ])("unescapes %s", (_label, input, expected) => {
      expect(unescapeXml(input)).toBe(expected);
    });

    it("unescapes every entity in escaped markup", () => {
      expect(unescapeXml("&lt;tag attr=&quot;value&quot;&gt;content &amp; more&lt;/tag&gt;")).toBe(
        '<tag attr="value">content & more</tag>'
      );
    });

    it("unescapes a double-escaped ampersand only once", () => {
      expect(unescapeXml("&amp;amp;")).toBe("&amp;");
    });

    it("returns plain and empty strings unchanged", () => {
      expect(unescapeXml("hello world")).toBe("hello world");
      expect(unescapeXml("")).toBe("");
    });

    it("returns an empty string for non-string input", () => {
      expect(unescapeXml(null)).toBe("");
      expect(unescapeXml(undefined)).toBe("");
      expect(unescapeXml(123)).toBe("");
    });

    it.each([
      ["markup", '<tag attr="value">text & more</tag>'],
      ["a URL with a query string", "https://example.com/path?param=value&other=<test>"],
      ["markdown", "Use `<code>` for inline code & **bold** text"],
    ])("restores %s that was escaped with escapeXml", (_label, original) => {
      expect(unescapeXml(escapeXml(original))).toBe(original);
    });
  });
});
