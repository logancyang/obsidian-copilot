import { splitAgentChatFrontmatter } from "./agentChatYaml";

describe("agentChatYaml", () => {
  describe("splitAgentChatFrontmatter()", () => {
    it("reads a BOM-prefixed CRLF note with a folded title and preserves its transcript https://github.com/logancyang/obsidian-copilot/issues/3378", () => {
      const content =
        "\uFEFF---\r\nbackendId: opencode\r\ntopic: >-\r\n  Useful\r\n  workflow\r\nprojectId: 123\r\n---\r\nOriginal transcript";
      expect(splitAgentChatFrontmatter(content)).toEqual({
        frontmatter: { backendId: "opencode", topic: "Useful workflow", projectId: 123 },
        body: "Original transcript",
      });
    });
    it("preserves a body with no frontmatter without treating its contents as YAML https://github.com/logancyang/obsidian-copilot/issues/3378", () => {
      const content = "  Original transcript\n---\nMore content\n";
      expect(splitAgentChatFrontmatter(content)).toEqual({ frontmatter: {}, body: content });
    });
  });
});
