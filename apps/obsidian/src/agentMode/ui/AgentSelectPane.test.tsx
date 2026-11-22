import { AgentSelectPane } from "@/agentMode/ui/AgentSelectPane";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("AgentSelectPane", () => {
  describe("AgentSelectPane()", () => {
    it("keeps the chooser in a scrollable area above the persistent controls", () => {
      const { container } = render(
        <AgentSelectPane controls={<div>Agent controls</div>}>
          <div>Agent chooser</div>
        </AgentSelectPane>
      );

      expect(screen.getByText("Agent chooser").parentElement?.className).toContain("tw-m-auto");
      expect(screen.getByText("Agent chooser").parentElement?.parentElement?.className).toContain(
        "tw-overflow-y-auto"
      );
      expect(container.textContent).toBe("Agent chooserAgent controls");
    });
  });
});
