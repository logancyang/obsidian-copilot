import { AgentLandingStack } from "@/agentMode/ui/AgentLandingStack";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("AgentLandingStack", () => {
  describe("AgentLandingStack()", () => {
    it("renders supplied regions in reading order without reserving space for absent regions", () => {
      const { container } = render(
        <AgentLandingStack
          hero={<div>Hero</div>}
          composer={<div>Composer</div>}
          shelf={<div>Shelf</div>}
        />
      );

      expect(screen.getAllByText(/Hero|Composer|Shelf/).map((node) => node.textContent)).toEqual([
        "Hero",
        "Composer",
        "Shelf",
      ]);
      expect(Array.from(container.children).map((node) => node.textContent)).toEqual([
        "",
        "Hero",
        "Composer",
        "Shelf",
      ]);
    });

    it("lets the space above the greeting give way, after the shelf, before the message box scrolls out of a short window for https://github.com/Brevilabs/obsidian-copilot-private/issues/588", () => {
      const { container } = render(
        <AgentLandingStack
          hero={<div>Hero</div>}
          composer={<div>Composer</div>}
          shelf={<div>Shelf</div>}
        />
      );

      const [space, hero, composer, shelf] = Array.from(container.children);
      expect(space.classList.contains("tw-h-1/5")).toBe(true);
      expect(space.classList.contains("tw-shrink-0")).toBe(false);
      expect(hero.classList.contains("tw-shrink-0")).toBe(true);
      expect(composer.classList.contains("tw-shrink-0")).toBe(true);
      expect(shelf.classList.contains("tw-flex-1")).toBe(true);
      expect(shelf.classList.contains("tw-min-h-0")).toBe(true);
    });

    it("centers the greeting and message box vertically when there is no shelf below them for https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      const { container } = render(
        <AgentLandingStack hero={<div>Hero</div>} composer={<div>Composer</div>} />
      );

      const children = Array.from(container.children);
      expect(children.map((node) => node.textContent)).toEqual(["", "Hero", "Composer", ""]);
      expect(children[0].classList.contains("tw-flex-1")).toBe(true);
      expect(children[children.length - 1].classList.contains("tw-flex-1")).toBe(true);
    });
  });
});
