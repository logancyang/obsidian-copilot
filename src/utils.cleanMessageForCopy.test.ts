import { cleanMessageForCopy } from "./utils";

describe("cleanMessageForCopy", () => {
  it("should remove Think blocks", () => {
    const input = "Before text\n<think>This is my thought process</think>\nAfter text";
    const expected = "Before text\n\nAfter text";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });

  it("should remove writeToFile blocks wrapped in XML codeblocks", () => {
    const input = `Some text before
\`\`\`xml
<writeToFile>
<path>test.md</path>
<content>File content here</content>
</writeToFile>
\`\`\`
Some text after`;
    const expected = "Some text before\n\nSome text after";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });

  it("should remove standalone writeToFile blocks", () => {
    const input = `Text before
<writeToFile>
<path>test.md</path>
<content>File content</content>
</writeToFile>
Text after`;
    const expected = "Text before\n\nText after";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });

  it("should remove tool call markers", () => {
    const input =
      "Before\n<!--TOOL_CALL_START:123:localSearch:Local Search:🔍::true-->Searching...<!--TOOL_CALL_END:123:Found 5 results-->\nAfter";
    const expected = "Before\n\nAfter";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });

  it("should handle multiple blocks in one message", () => {
    const input = `Start of message
<think>First thought</think>
Middle part
<writeToFile><path>file.md</path><content>content</content></writeToFile>
<!--TOOL_CALL_START:456:webSearch:Web Search:🌐::false-->Searching web<!--TOOL_CALL_END:456:Results-->
End of message`;
    const expected = "Start of message\n\nMiddle part\n\nEnd of message";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });

  it("should clean up multiple consecutive newlines", () => {
    const input = `Text\n\n\n\n\nMore text`;
    const expected = "Text\n\nMore text";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });

  it("should preserve normal content", () => {
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

  it("should handle nested think blocks", () => {
    const input =
      "Before\n<think>Outer thought <think>Inner thought</think> back to outer</think>\nAfter";
    // Since we're not handling nested blocks, the outer block will be removed but inner content remains
    const expected = "Before\n back to outer</think>\nAfter";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });

  it("should handle multiline content in blocks", () => {
    const input = `Start
<think>
Line 1 of thought
Line 2 of thought
Line 3 of thought
</think>
End`;
    const expected = "Start\n\nEnd";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });

  it("should trim leading and trailing whitespace", () => {
    const input = "\n\n  Content with spaces  \n\n";
    const expected = "Content with spaces";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });

  it("should handle empty message", () => {
    expect(cleanMessageForCopy("")).toBe("");
  });

  it("should handle message with only blocks to remove", () => {
    const input = "<think>Only a thought</think>";
    const expected = "";
    expect(cleanMessageForCopy(input)).toBe(expected);
  });
});
