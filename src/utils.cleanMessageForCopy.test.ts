import { cleanMessageForCopy } from "./utils";

describe("utils", () => {
  describe("cleanMessageForCopy()", () => {
    it("preserves normal Markdown content", () => {
      const input = `# Heading
This is a normal message with:
- Bullet points
- Code blocks: \`const x = 1;\`
- **Bold** and *italic* text

\`\`\`javascript
function test() {
  return true;
}
\`\`\`

More content here.`;
      expect(cleanMessageForCopy(input)).toBe(input);
    });

    it("removes multi-line think blocks", () => {
      const input = "Start\n<think>\nLine 1 of thought\nLine 2 of thought\n</think>\nEnd";
      expect(cleanMessageForCopy(input)).toBe("Start\n\nEnd");
    });

    it("removes writeFile blocks wrapped in an xml code fence", () => {
      const input = `Some text before
\`\`\`xml
<writeFile>
<path>test.md</path>
<content>File content here</content>
</writeFile>
\`\`\`
Some text after`;
      expect(cleanMessageForCopy(input)).toBe("Some text before\n\nSome text after");
    });

    it("removes standalone writeFile blocks", () => {
      const input = `Text before
<writeFile>
<path>test.md</path>
<content>File content</content>
</writeFile>
Text after`;
      expect(cleanMessageForCopy(input)).toBe("Text before\n\nText after");
    });

    it("removes tool call markers together with the text they wrap", () => {
      const input =
        "Before\n<!--TOOL_CALL_START:123:localSearch:Local Search:🔍::true-->Searching...<!--TOOL_CALL_END:123:Found 5 results-->\nAfter";
      expect(cleanMessageForCopy(input)).toBe("Before\n\nAfter");
    });

    it("removes agent reasoning markers and keeps the surrounding text", () => {
      const input = `Some intro text
<!--AGENT_REASONING:collapsed:5:["Searching notes"]-->
Here is the actual response.`;
      expect(cleanMessageForCopy(input)).toBe("Some intro text\n\nHere is the actual response.");
    });

    it("removes agent reasoning markers whose step summaries contain -->", () => {
      const input = `<!--AGENT_REASONING:complete:8:["Step with --> inside"]-->Actual response.`;
      expect(cleanMessageForCopy(input)).toBe("Actual response.");
    });

    it("removes every kind of block when several appear in one message", () => {
      const input = `Start of message
<think>First thought</think>
Middle part
<writeFile><path>file.md</path><content>content</content></writeFile>
<!--TOOL_CALL_START:456:webSearch:Web Search:🌐::false-->Searching web<!--TOOL_CALL_END:456:Results-->
End of message`;
      expect(cleanMessageForCopy(input)).toBe("Start of message\n\nMiddle part\n\nEnd of message");
    });

    it("collapses runs of blank lines to a single blank line", () => {
      expect(cleanMessageForCopy("Text\n\n\n\n\nMore text")).toBe("Text\n\nMore text");
    });

    it("trims leading and trailing whitespace", () => {
      expect(cleanMessageForCopy("\n\n  Content with spaces  \n\n")).toBe("Content with spaces");
    });

    it("returns an empty string for an empty message or one made only of removable blocks", () => {
      expect(cleanMessageForCopy("")).toBe("");
      expect(cleanMessageForCopy("<think>Only a thought</think>")).toBe("");
    });
  });
});
