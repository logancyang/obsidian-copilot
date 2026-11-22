import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import { findConnectors } from "@/connectors/connectorSearch";

function entry(
  name: string,
  description: string,
  category: ConnectorCatalogEntry["category"]
): ConnectorCatalogEntry {
  return { id: name.toLowerCase(), name, description, category, serverUrl: "https://x.example" };
}

const NOTION = entry("Notion", "Pages and databases", "Notes & docs");
const GRANOLA = entry("Granola", "Meeting notes", "Meetings");
const MONDAY = entry("monday.com", "Boards, items and updates", "Tasks & projects");
const LINEAR = entry("Linear", "Issues, projects and cycles", "Tasks & projects");
const MIRO = entry("Miro", "Boards and diagrams", "Design");
const CATALOG = [NOTION, GRANOLA, MONDAY, LINEAR, MIRO];

function names(found: readonly ConnectorCatalogEntry[]): string[] {
  return found.map(({ name }) => name);
}

describe("connectorSearch", () => {
  describe("findConnectors()", () => {
    it("lists every service alphabetically, ignoring case, when nothing narrows it", () => {
      expect(names(findConnectors(CATALOG, "", null))).toEqual([
        "Granola",
        "Linear",
        "Miro",
        "monday.com",
        "Notion",
      ]);
    });

    it("keeps only the chosen category", () => {
      expect(names(findConnectors(CATALOG, "", "Tasks & projects"))).toEqual([
        "Linear",
        "monday.com",
      ]);
    });

    it("matches the query against name, description and category, ignoring case", () => {
      expect(names(findConnectors(CATALOG, "NOTION", null))).toEqual(["Notion"]);
      expect(names(findConnectors(CATALOG, "boards", null))).toEqual(["Miro", "monday.com"]);
      expect(names(findConnectors(CATALOG, "meeting", null))).toEqual(["Granola"]);
      expect(names(findConnectors(CATALOG, "tasks", null))).toEqual(["Linear", "monday.com"]);
    });

    it("needs every word of the query to match", () => {
      expect(names(findConnectors(CATALOG, "  boards   diagrams ", null))).toEqual(["Miro"]);
    });

    it("searches the whole catalog while a category is chosen", () => {
      expect(names(findConnectors(CATALOG, "notes", "Design"))).toEqual(["Granola", "Notion"]);
    });

    it("finds nothing for a service the catalog doesn't have", () => {
      expect(findConnectors(CATALOG, "gmail", null)).toEqual([]);
    });
  });
});
