import { readFileSync } from "fs";
import path from "path";

describe("tailwind", () => {
  describe("Quick Chat host padding", () => {
    it("keeps mobile main-tab input clear of the keyboard and bottom navigation without changing other hosts (https://github.com/Brevilabs/obsidian-copilot-private/issues/400)", () => {
      const css = readFileSync(path.join(__dirname, "tailwind.css"), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        ""
      );
      const paddingRules = Array.from(
        css.matchAll(/([^{};]*\[data-type="copilot-chat-view"\][^{};]*)\{([^{}]*)\}/g),
        ([, selector, declarations]) => ({
          selector: selector.trim(),
          value: declarations
            .match(/padding-bottom:\s*([^;]+);/)?.[1]
            .replace(/\s+/g, " ")
            .replace(/\( /g, "(")
            .replace(/ \)/g, ")"),
        })
      );

      for (const [mobile, container, viewType, expected] of [
        [
          true,
          "workspace-tab-container",
          "copilot-chat-view",
          [
            "max(var(--size-4-8), var(--view-bottom-spacing, calc(var(--safe-area-inset-bottom) - var(--keyboard-height))))",
          ],
        ],
        [true, "workspace-drawer-tab-container", "copilot-chat-view", []],
        [false, "workspace-tab-container", "copilot-chat-view", []],
        [true, "workspace-tab-container", "markdown", []],
      ] as const) {
        const host = document.createElement("div");
        host.className = mobile ? "is-mobile" : "";
        const tab = document.createElement("div");
        tab.className = container;
        const leaf = document.createElement("div");
        leaf.className = "workspace-leaf-content";
        leaf.dataset.type = viewType;
        const content = document.createElement("div");
        content.className = "view-content";
        host.append(tab);
        tab.append(leaf);
        leaf.append(content);

        expect(
          paddingRules.filter(({ selector }) => content.matches(selector)).map(({ value }) => value)
        ).toEqual(expected);
      }
    });
  });
});
