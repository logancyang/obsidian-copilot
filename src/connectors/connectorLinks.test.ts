import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import { loginRejectedIssueUrl } from "@/connectors/connectorLinks";

const NOTION: ConnectorCatalogEntry = {
  id: "notion",
  name: "Notion",
  description: "Pages and databases",
  category: "Notes & docs",
  serverUrl: "https://mcp.notion.com/mcp",
};

describe("connectorLinks", () => {
  describe("loginRejectedIssueUrl()", () => {
    it("opens a new Copilot issue naming the service and the server that rejected the login", () => {
      const url = new URL(loginRejectedIssueUrl(NOTION));

      expect(url.origin + url.pathname).toBe(
        "https://github.com/logancyang/obsidian-copilot/issues/new"
      );
      expect(url.searchParams.get("title")).toBe("Connector login rejected: Notion");
      expect(url.searchParams.get("body")).toBe(
        "Notion didn't accept Copilot's login.\n\nServer: https://mcp.notion.com/mcp"
      );
    });
  });
});
