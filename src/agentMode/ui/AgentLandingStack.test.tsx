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
          context={<div>Context</div>}
          shelf={<div>Shelf</div>}
        />
      );

      expect(
        screen.getAllByText(/Hero|Composer|Context|Shelf/).map((node) => node.textContent)
      ).toEqual(["Hero", "Composer", "Context", "Shelf"]);
      expect(Array.from(container.children).map((node) => node.textContent)).toEqual([
        "",
        "Hero",
        "Composer",
        "Context",
        "Shelf",
      ]);
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
