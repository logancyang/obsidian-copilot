import { createMiyoPageUrl } from "@/lib/miyoLinks";
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

describe("miyoLinks", () => {
  describe("createMiyoPageUrl()", () => {
    it.each([
      "license_settings",
      "pairing",
      "miyo_settings",
      "connection",
      "relevant_notes",
    ] as const)("attributes %s using only the fixed source and surface", (surface) => {
      expect(createMiyoPageUrl(surface)).toBe(
        `https://www.miyo.md/?utm_source=obsidian_copilot&utm_medium=${surface}`
      );
    });
  });

  it("keeps Miyo website URLs centralized so new links cannot bypass attribution — https://github.com/Brevilabs/obsidian-copilot-private/issues/318", () => {
    const sourceRoot = join(__dirname, "..");
    const bypasses: string[] = [];
    function scan(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) scan(path);
        else if (
          /\.[jt]sx?$/.test(entry.name) &&
          !/\.test\.[jt]sx?$/.test(entry.name) &&
          path !== join(__dirname, "miyoLinks.ts") &&
          /https?:\/\/(?:www\.)?miyo\.md\b/.test(readFileSync(path, "utf8"))
        ) {
          bypasses.push(relative(sourceRoot, path));
        }
      }
    }
    scan(sourceRoot);
    expect(bypasses).toEqual([]);
  });
});
