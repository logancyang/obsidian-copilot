import { mergeFrontmatter } from "./agentChatYaml";

describe("agentChatYaml", () => {
  describe("mergeFrontmatter()", () => {
    it("builds frontmatter from the updates alone for a note that has none", () => {
      expect(
        mergeFrontmatter("", [
          ["epoch", "epoch: 1"],
          ["sessionId", undefined],
          ["projectId", null],
          ["tags", "tags:\n  - copilot-conversation"],
        ])
      ).toBe("---\nepoch: 1\ntags:\n  - copilot-conversation\n---");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/698 replaces updated keys in place and keeps every other key where it was", () => {
      const current = "---\nepoch: 1\ntopic: \"Renamed\"\nusage: '{}'\nstatus: done\n---\n\nbody";

      expect(mergeFrontmatter(current, [["usage", "usage: '{\"usedTokens\":5}'"]])).toBe(
        '---\nepoch: 1\ntopic: "Renamed"\nusage: \'{"usedTokens":5}\'\nstatus: done\n---'
      );
    });

    it("keeps the note's value for a key whose update is undefined", () => {
      expect(mergeFrontmatter('---\nsessionId: "s1"\n---\n', [["sessionId", undefined]])).toBe(
        '---\nsessionId: "s1"\n---'
      );
    });

    it("removes a key whose update is null", () => {
      expect(mergeFrontmatter('---\nprojectId: "p1"\nepoch: 1\n---\n', [["projectId", null]])).toBe(
        "---\nepoch: 1\n---"
      );
    });

    it("appends keys the note does not have yet after its existing keys", () => {
      expect(mergeFrontmatter("---\npinnedAt: 5\n---\n", [["epoch", "epoch: 1"]])).toBe(
        "---\npinnedAt: 5\nepoch: 1\n---"
      );
    });

    it("treats a key's indented and list lines as part of that key", () => {
      const current = "---\ntags:\n- mine\n  - copilot-conversation\naliases:\n  - Chat\n---\r\n";

      expect(mergeFrontmatter(current, [["tags", "tags:\n  - copilot-conversation"]])).toBe(
        "---\ntags:\n  - copilot-conversation\naliases:\n  - Chat\n---"
      );
    });
  });
});
