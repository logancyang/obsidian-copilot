import { humanizeToolName } from "@/lib/toolName";

describe("toolName", () => {
  describe("humanizeToolName()", () => {
    it("turns snake, kebab and camel case tool names into a sentence-case phrase", () => {
      expect(humanizeToolName("search_notes")).toBe("Search notes");
      expect(humanizeToolName("notion-create-pages")).toBe("Notion create pages");
      expect(humanizeToolName("getConfluencePageDescendants")).toBe(
        "Get confluence page descendants"
      );
      expect(humanizeToolName("listMCPServers")).toBe("List mcp servers");
    });

    it("returns an empty string for a name with no words", () => {
      expect(humanizeToolName("__")).toBe("");
    });
  });
});
