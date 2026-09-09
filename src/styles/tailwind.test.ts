import { readFileSync } from "fs";
import path from "path";

describe("tailwind", () => {
  describe("Quick Chat host padding", () => {
    it("keeps mobile main-tab input clear of the keyboard and bottom navigation and removes the phone sidebar keyboard gap without changing other hosts (https://github.com/Brevilabs/obsidian-copilot-private/issues/400)", () => {
      const css = readFileSync(path.join(__dirname, "tailwind.css"), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        ""
      );
      const paddingRules = Array.from(
        css.matchAll(/([^{};]*\[data-type="copilot-chat-view"\][^{};]*)\{([^{}]*)\}/g),
        ([, selector, declarations]) => ({
          selector: selector.trim(),
          maxHeight: declarations
            .match(/max-height:\s*([^;]+);/)?.[1]
            .replace(/\s+/g, " ")
            .replace(/\( /g, "(")
            .replace(/ \)/g, ")"),
          value: declarations
            .match(/padding-bottom:\s*([^;]+);/)?.[1]
            .replace(/\s+/g, " ")
            .replace(/\( /g, "(")
            .replace(/ \)/g, ")"),
        })
      );

      for (const [platform, container, viewType, expected] of [
        [
          "is-mobile is-phone",
          "workspace-tab-container",
          "copilot-chat-view",
          [
            "max(var(--size-4-8), var(--view-bottom-spacing, calc(var(--safe-area-inset-bottom) - var(--keyboard-height))))",
          ],
        ],
        [
          "is-mobile is-phone",
          "workspace-drawer mod-right",
          "copilot-chat-view",
          ["max(var(--size-4-8), calc(var(--safe-area-inset-bottom) - var(--keyboard-height)))"],
        ],
        ["is-mobile is-phone", "workspace-drawer mod-left", "copilot-chat-view", []],
        ["", "workspace-drawer mod-right", "copilot-chat-view", []],
        ["is-mobile", "workspace-drawer mod-right", "copilot-chat-view", []],
        ["", "workspace-tab-container", "copilot-chat-view", []],
        ["is-mobile is-phone", "workspace-tab-container", "markdown", []],
      ] as const) {
        const host = document.createElement("div");
        host.className = platform;
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
        expect(
          paddingRules
            .filter(({ selector }) => content.matches(selector))
            .map(({ maxHeight }) => maxHeight)
        ).toEqual(
          expected.map(() =>
            container === "workspace-drawer mod-right"
              ? "calc(100vh - max(var(--size-4-2), var(--safe-area-inset-top)) - var(--keyboard-height))"
              : undefined
          )
        );
      }
    });
  });
});
