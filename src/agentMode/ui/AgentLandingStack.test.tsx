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
  });
});
