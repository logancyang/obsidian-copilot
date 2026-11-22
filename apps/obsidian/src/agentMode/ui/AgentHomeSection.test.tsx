import { AgentHomePreviewList } from "@/agentMode/ui/AgentHomeSection";
import { render } from "@testing-library/react";
import React from "react";

describe("AgentHomeSection", () => {
  describe("AgentHomePreviewList()", () => {
    it("keeps preview row content clear of the overlaid scrollbar (https://github.com/logancyang/obsidian-copilot/issues/3017)", () => {
      const { container } = render(
        <AgentHomePreviewList>
          <div>Preview rows</div>
        </AgentHomePreviewList>
      );
      const viewport = container.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");

      expect(viewport?.parentElement?.classList.contains("tw-pr-2.5")).toBe(true);
    });
  });
});
