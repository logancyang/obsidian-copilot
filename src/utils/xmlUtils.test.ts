import { escapeXml, escapeXmlAttribute } from "./xmlUtils";

describe("XML Escaping Utilities", () => {
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
});
