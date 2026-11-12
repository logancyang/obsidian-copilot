import { CONNECTOR_CATALOG, CONNECTOR_CATEGORIES } from "@/connectors/catalog";

describe("catalog", () => {
  describe("CONNECTOR_CATALOG", () => {
    it("https://github.com/NangoHQ/nango/issues/7142 uses dynamic registration for Airtable because its authorization page rejects URL client IDs", () => {
      expect(CONNECTOR_CATALOG.find(({ id }) => id === "airtable")).toMatchObject({
        useDynamicClientRegistration: true,
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/913 lets agents read and do bookkeeping in Mercury without the transaction and transfer requests its default login grants", () => {
      const scopes = CONNECTOR_CATALOG.find(({ id }) => id === "mercury")?.scope?.split(" ");

      expect(scopes).toEqual([
        "read",
        "offline_access",
        "transactions:update",
        "receipts:manage",
        "categories:create",
        "categories:edit",
        "budgets:manage",
      ]);
    });

    it("lists services alphabetically by display name, ignoring case", () => {
      const names = CONNECTOR_CATALOG.map((entry) => entry.name);

      const sorted = [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

      expect(names).toEqual(sorted);
    });

    it("gives every service a unique short lowercase id usable as a tool-name prefix", () => {
      const ids = CONNECTOR_CATALOG.map((entry) => entry.id);

      for (const id of ids) {
        expect(id).toMatch(/^[a-z0-9]{2,16}$/);
      }
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("gives every service a unique name, a one-line description and a category from the chip set", () => {
      for (const entry of CONNECTOR_CATALOG) {
        expect(entry.name.trim()).toBe(entry.name);
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeLessThanOrEqual(40);
        expect(entry.description).not.toMatch(/[.\n]$/);
        expect(CONNECTOR_CATEGORIES).toContain(entry.category);
      }
      const names = CONNECTOR_CATALOG.map((entry) => entry.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    });

    it("points every service at an https server URL with no credentials, query or fragment", () => {
      for (const entry of CONNECTOR_CATALOG) {
        const url = new URL(entry.serverUrl);

        expect(url.protocol).toBe("https:");
        expect(url.username + url.password).toBe("");
        expect(url.search + url.hash).toBe("");
      }
    });

    it("serves every service's logo from a fixed Brevilabs CDN URL named by its id, so the image can be replaced without a release", () => {
      for (const entry of CONNECTOR_CATALOG) {
        expect(entry.logoUrl).toBe(
          `https://images.brevilabs.com/newsletters/copilot-plugin/connectors/${entry.id}.png`
        );
      }
    });
  });
});
