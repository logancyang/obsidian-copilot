import { parseXMLToolCalls, escapeXml, escapeXmlAttribute, stripToolCallXML } from "./xmlParsing";

describe("parseXMLToolCalls", () => {
  it("should parse hybrid XML tool calls with JSON arrays", () => {
    const text = `
I'll search your vault for piano learning notes.

<use_tool>
<name>localSearch</name>
<query>piano learning</query>
<salientTerms>["piano", "learning", "practice", "music"]</salientTerms>
</use_tool>

Let me also search the web.

<use_tool>
<name>webSearch</name>
<query>piano techniques</query>
<chatHistory>[]</chatHistory>
</use_tool>
    `;

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(2);

    // First tool call
    expect(toolCalls[0].name).toBe("localSearch");
    expect(toolCalls[0].args.query).toBe("piano learning");
    expect(toolCalls[0].args.salientTerms).toEqual(["piano", "learning", "practice", "music"]);

    // Second tool call
    expect(toolCalls[1].name).toBe("webSearch");
    expect(toolCalls[1].args.query).toBe("piano techniques");
    expect(toolCalls[1].args.chatHistory).toEqual([]); // JSON array format
  });

  it("should handle tool calls with no parameters", () => {
    const text = `
<use_tool>
<name>getFileTree</name>
</use_tool>
    `;

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("getFileTree");
    expect(toolCalls[0].args).toEqual({});
  });

  it("should handle string parameters without JSON parsing", () => {
    const text = `
<use_tool>
<name>simpleYoutubeTranscription</name>
<url>https://youtube.com/watch?v=123</url>
<language>en</language>
</use_tool>
    `;

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("simpleYoutubeTranscription");
    expect(toolCalls[0].args.url).toBe("https://youtube.com/watch?v=123");
    expect(toolCalls[0].args.language).toBe("en");
  });

  it("should handle hybrid approach with both JSON and XML formats", () => {
    const text = `
<use_tool>
<name>hybridTool</name>
<stringParam>simple string</stringParam>
<jsonArray>["item1", "item2"]</jsonArray>
<jsonObject>{"key": "value", "number": 42}</jsonObject>
<xmlArray>
  <item>xml1</item>
  <item>xml2</item>
</xmlArray>
</use_tool>
    `;

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("hybridTool");
    expect(toolCalls[0].args.stringParam).toBe("simple string");
    expect(toolCalls[0].args.jsonArray).toEqual(["item1", "item2"]); // JSON parsed
    expect(toolCalls[0].args.jsonObject).toEqual({ key: "value", number: 42 }); // JSON parsed
    expect(toolCalls[0].args.xmlArray).toEqual(["xml1", "xml2"]); // XML parsed
  });

  it("should handle nested item tags", () => {
    const text = `
<use_tool>
<name>nestedTool</name>
<simpleParam>working string</simpleParam>
<nestedArray>
  <item>
    <title>Item 1</title>
    <value>Value 1</value>
  </item>
  <item>
    <title>Item 2</title>
    <value>Value 2</value>
  </item>
</nestedArray>
</use_tool>
    `;

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("nestedTool");
    expect(toolCalls[0].args.simpleParam).toBe("working string");
    expect(toolCalls[0].args.nestedArray).toEqual([
      { title: "Item 1", value: "Value 1" },
      { title: "Item 2", value: "Value 2" },
    ]);
  });

  it("should ignore tool calls with empty names", () => {
    const text = `
<use_tool>
<name></name>
<param>value</param>
</use_tool>

<use_tool>
<name>validTool</name>
<param>value</param>
</use_tool>
    `;

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("validTool");
  });

  it("should handle whitespace and formatting", () => {
    const text = `
<use_tool>
  <name>   localSearch   </name>
  <query>   search query   </query>
  <salientTerms>  ["term1", "term2"]  </salientTerms>
</use_tool>
    `;

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("localSearch");
    expect(toolCalls[0].args.query).toBe("search query");
    expect(toolCalls[0].args.salientTerms).toEqual(["term1", "term2"]);
  });

  it("should return empty array for text with no tool calls", () => {
    const text = "This is just regular text with no tool calls.";

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(0);
  });

  it("should handle webSearch tool with hybrid chatHistory formats", () => {
    const text = `
<use_tool>
<name>webSearch</name>
<query>piano practice tips</query>
<chatHistory>[]</chatHistory>
</use_tool>

<use_tool>
<name>webSearch</name>
<query>follow-up search</query>
<chatHistory>
  <item>
    <role>user</role>
    <content>Tell me about piano</content>
  </item>
  <item>
    <role>assistant</role>
    <content>Piano is a musical instrument</content>
  </item>
</chatHistory>
</use_tool>
    `;

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(2);

    // First tool call - JSON empty array
    expect(toolCalls[0].name).toBe("webSearch");
    expect(toolCalls[0].args.query).toBe("piano practice tips");
    expect(toolCalls[0].args.chatHistory).toEqual([]);

    // Second tool call - XML item format
    expect(toolCalls[1].name).toBe("webSearch");
    expect(toolCalls[1].args.query).toBe("follow-up search");
    expect(toolCalls[1].args.chatHistory).toEqual([
      { role: "user", content: "Tell me about piano" },
      { role: "assistant", content: "Piano is a musical instrument" },
    ]);
  });

  it("should handle malformed JSON gracefully", () => {
    const text = `
<use_tool>
<name>testTool</name>
<goodParam>working string</goodParam>
<badJson>[invalid json</badJson>
<goodJson>["valid", "array"]</goodJson>
</use_tool>
    `;

    const toolCalls = parseXMLToolCalls(text);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("testTool");
    expect(toolCalls[0].args.goodParam).toBe("working string");
    expect(toolCalls[0].args.badJson).toBe("[invalid json"); // Falls back to string
    expect(toolCalls[0].args.goodJson).toEqual(["valid", "array"]); // JSON parsed
  });
});

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

describe("stripToolCallXML", () => {
  describe("complete tool calls", () => {
    it("should remove complete tool call blocks", () => {
      const text = `Before tool call.

<use_tool>
<name>localSearch</name>
<query>test query</query>
</use_tool>

After tool call.`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Before tool call.\n\nAfter tool call.");
    });

    it("should remove multiple complete tool call blocks", () => {
      const text = `First text.

<use_tool>
<name>localSearch</name>
<query>first search</query>
</use_tool>

Middle text.

<use_tool>
<name>webSearch</name>
<query>second search</query>
</use_tool>

Final text.`;

      const result = stripToolCallXML(text);
      expect(result).toBe("First text.\n\nMiddle text.\n\nFinal text.");
    });
  });

  describe("partial tool calls", () => {
    it("should show calling message for partial tool call at end of text", () => {
      const text = `Some text before.

<use_tool>
<name>localSearch</name>
<query>incomplete`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Some text before.\n\nCalling vault search...");
    });

    it("should show generic calling message for partial tool call with only opening tag", () => {
      const text = `Some text before.

<use_tool>`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Some text before.\n\nCalling tool...");
    });

    it("should show calling message for partial tool call with incomplete parameters", () => {
      const text = `Some text before.

<use_tool>
<name>webSearch</name>
<query>incomplete query
<someParam>value`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Some text before.\n\nCalling web search...");
    });

    it("should handle mixed complete and partial tool calls", () => {
      const text = `Start text.

<use_tool>
<name>localSearch</name>
<query>complete search</query>
</use_tool>

Middle text.

<use_tool>
<name>webSearch</name>
<query>incomplete`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Start text.\n\nMiddle text.\n\nCalling web search...");
    });

    it("should show calling message for partial tool call in middle when followed by text", () => {
      const text = `Before text.

<use_tool>
<name>localSearch</name>
<query>incomplete query without closing

This text should remain.`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Before text.\n\nCalling vault search...");
    });

    it("should show generic calling message when tool name is not yet available", () => {
      const text = `Some text before.

<use_tool>
<name>`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Some text before.\n\nCalling tool...");
    });
  });

  describe("edge cases", () => {
    it("should handle text with no tool calls", () => {
      const text = "Just regular text with no tool calls.";
      const result = stripToolCallXML(text);
      expect(result).toBe("Just regular text with no tool calls.");
    });

    it("should handle empty string", () => {
      const result = stripToolCallXML("");
      expect(result).toBe("");
    });

    it("should handle text with just whitespace", () => {
      const result = stripToolCallXML("   \n  \n   ");
      expect(result).toBe("");
    });

    it("should handle multiple partial tool calls", () => {
      const text = `Text before.

<use_tool>
<name>localSearch</name>

More text.

<use_tool>
<name>webSearch</name>
<param>value`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Text before.\n\nCalling vault search...");
    });

    it("should preserve non-tool XML tags", () => {
      const text = `Some text with <strong>bold</strong> and <em>italic</em> tags.

<use_tool>
<name>localSearch</name>
<query>search</query>
</use_tool>

More <div>HTML-like</div> content.`;

      const result = stripToolCallXML(text);
      expect(result).toBe(
        "Some text with <strong>bold</strong> and <em>italic</em> tags.\n\nMore <div>HTML-like</div> content."
      );
    });

    it("should handle tool calls with complex nested content", () => {
      const text = `Before tool.

<use_tool>
<name>complexTool</name>
<nested>
  <item>value1</item>
  <item>value2</item>
</nested>
<jsonParam>["item1", "item2"]</jsonParam>
</use_tool>

After tool.`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Before tool.\n\nAfter tool.");
    });
  });

  describe("code block removal", () => {
    it("should remove empty code blocks", () => {
      const text = `Some text.

\`\`\`
\`\`\`

More text.

\`\`\`javascript
\`\`\``;

      const result = stripToolCallXML(text);
      expect(result).toBe("Some text.\n\nMore text.");
    });

    it("should remove tool_code blocks", () => {
      const text = `Some text.

\`\`\`tool_code
some tool code here
\`\`\`

More text.`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Some text.\n\nMore text.");
    });

    it("should clean up excessive whitespace", () => {
      const text = `Text with


multiple


newlines.`;

      const result = stripToolCallXML(text);
      expect(result).toBe("Text with\n\nmultiple\n\nnewlines.");
    });
  });
});
