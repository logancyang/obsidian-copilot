import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

/**
 * Links whose destination is reproduced as plain text rather than rendered as
 * an anchor, so a query string would show up as unclickable noise. Attribution
 * for these is a server-side concern.
 */
const UNTAGGED_BY_DESIGN = [
  // `USAGE_DASHBOARD_URL`, interpolated into an `ErrorBlock` message.
  "constants.ts",
  // Prompt text the model repeats in its own prose.
  "builtinSkills/builtinSkills.ts",
  // OpenRouter's `HTTP-Referer` attribution header, not a user-facing link.
  "LLMProviders/chatModelManager.ts",
];

describe("productLinks", () => {
  describe("createProductUrl()", () => {
    it.each([
      [PRODUCT_URLS.COPILOT, "settings", "https://www.obsidiancopilot.com/"],
      [
        PRODUCT_URLS.COPILOT_PRICING,
        "model_picker_lock",
        "https://www.obsidiancopilot.com/pricing",
      ],
      [PRODUCT_URLS.COPILOT_DASHBOARD, "usage_footer", "https://www.obsidiancopilot.com/dashboard"],
      [PRODUCT_URLS.MIYO, "pairing", "https://www.miyo.md/"],
      [PRODUCT_URLS.OPENARTIFACTS, "welcome_modal", "https://openartifacts.ai/"],
    ] as const)(
      "tags %s from %s with the shared source and the placement",
      (destination, medium, expectedBase) => {
        expect(createProductUrl(destination, medium)).toBe(
          `${expectedBase}?utm_source=obsidian_copilot&utm_medium=${medium}`
        );
      }
    );
  });

  it("keeps product website URLs centralized so new links cannot bypass attribution — https://github.com/Brevilabs/obsidian-copilot-private/issues/318", () => {
    const sourceRoot = join(__dirname, "..");
    const allowed = new Set([
      relative(sourceRoot, join(__dirname, "productLinks.ts")),
      ...UNTAGGED_BY_DESIGN,
    ]);
    const bypasses: string[] = [];
    function scan(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) scan(path);
        else if (
          /\.[jt]sx?$/.test(entry.name) &&
          !/\.test\.[jt]sx?$/.test(entry.name) &&
          !allowed.has(relative(sourceRoot, path)) &&
          /https?:\/\/(?:www\.)?(?:obsidiancopilot\.com|miyo\.md|openartifacts\.ai)\b/.test(
            readFileSync(path, "utf8")
          )
        ) {
          bypasses.push(relative(sourceRoot, path));
        }
      }
    }
    scan(sourceRoot);
    expect(bypasses).toEqual([]);
  });
});
