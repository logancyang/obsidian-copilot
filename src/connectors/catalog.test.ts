import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONNECTOR_CATALOG, CONNECTOR_CATEGORIES } from "@/connectors/catalog";

const LOGO_DIR = join(__dirname, "logos");

describe("catalog", () => {
  describe("CONNECTOR_CATALOG", () => {
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

    it("ships a logo file named after the id for exactly the services that show a logo", () => {
      const logoFiles = readdirSync(LOGO_DIR).sort();

      const expectedFiles = CONNECTOR_CATALOG.filter((entry) => entry.Logo)
        .map((entry) => `${entry.id}.svg`)
        .sort();

      expect(logoFiles).toEqual(expectedFiles);
    });

    it("ships logos as single-color SVGs that take the theme's text color and load nothing external", () => {
      for (const file of readdirSync(LOGO_DIR)) {
        const svg = readFileSync(join(LOGO_DIR, file), "utf8");

        expect(svg).toMatch(/^<svg [^>]*viewBox="[\d. ]+"/);
        expect(svg).toContain('fill="currentColor"');
        expect(svg).not.toMatch(/<script|<image|<style|href=|url\(|fill="#/i);
      }
    });
  });
});
