import { humanizeToolName, serviceToolName } from "@/lib/toolName";

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

  describe("serviceToolName()", () => {
    it("turns a service's tool name into words", () => {
      expect(serviceToolName("Linear", "create_issue")).toBe("Create issue");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/878 drops the service's name from the front of the tool name, since the service is already named beside it", () => {
      expect(serviceToolName("Notion", "notion-create-pages")).toBe("Create pages");
      expect(serviceToolName("Google Drive", "google_drive_search")).toBe("Search");
    });

    it("keeps a tool name that only is the service's name or starts with a longer word", () => {
      expect(serviceToolName("Google Drive", "google-drive")).toBe("Google drive");
      expect(serviceToolName("Google Drive", "googleSearch")).toBe("Google search");
      expect(serviceToolName("Notion", "notionally_search")).toBe("Notionally search");
    });
  });
});
