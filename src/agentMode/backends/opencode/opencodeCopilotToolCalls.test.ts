import { readOpencodeCopilotTools } from "@/agentMode/backends/opencode/opencodeCopilotToolCalls";

describe("opencodeCopilotToolCalls", () => {
  describe("readOpencodeCopilotTools()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 reads a direct tool name and its arguments without an execute wrapper", () => {
      expect(
        readOpencodeCopilotTools({ query: "Orion" }, "obsidian-copilot_notion_search")
      ).toEqual({ calls: [{ name: "notion_search", args: { query: "Orion" } }] });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 preserves the actual arguments when a tool name is also present in its text", () => {
      expect(
        readOpencodeCopilotTools(
          { message: "tools fetch execute" },
          "obsidian-copilot_everything_echo"
        )
      ).toEqual({ calls: [{ name: "everything_echo", args: { message: "tools fetch execute" } }] });
    });

    it.each([
      undefined,
      "execute",
      "read",
      "other_notion_search",
      "prefix_obsidian-copilot_notion_search",
      "obsidian-copilot_",
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/875 ignores a non-Copilot direct tool name: %s",
      (name) => {
        expect(
          readOpencodeCopilotTools(
            { code: 'return tools["obsidian-copilot"].notion_search({});' },
            name
          )
        ).toBeNull();
      }
    );
  });
});
