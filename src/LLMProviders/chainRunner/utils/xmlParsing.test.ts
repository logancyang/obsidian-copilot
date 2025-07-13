import { parseXMLToolCalls } from "./xmlParsing";

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
