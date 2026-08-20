import {
  AgentModeBanner,
  type AgentModeBannerProps,
} from "@/components/chat-components/ui/AgentModeBanner";
import { COPILOT_AGENT_ICON_PATH } from "@/constants";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

let mockDesktopRuntime = true;

jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: () => mockDesktopRuntime,
}));

const COPY = "New: Agent mode. More capable models, tools, and skills.";

describe("AgentModeBanner", () => {
  describe("AgentModeBanner()", () => {
    beforeEach(() => {
      mockDesktopRuntime = true;
    });

    it("announces Agent mode with the brand mark instead of an alert icon and opens Agent when selected", () => {
      const onOpenAgent = jest.fn();
      const props: AgentModeBannerProps = { onOpenAgent };

      const { container } = render(<AgentModeBanner {...props} />);

      const paths = Array.from(container.querySelectorAll("path"));
      expect(paths.some((path) => path.getAttribute("d") === COPILOT_AGENT_ICON_PATH)).toBe(true);
      expect(container.querySelector(".lucide-circle-alert")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: COPY }));

      expect(onOpenAgent).toHaveBeenCalledTimes(1);
    });

    it("frames the announcement around what is newly available rather than what is ending", () => {
      const { container } = render(<AgentModeBanner onOpenAgent={jest.fn()} />);

      const copy = container.textContent?.toLowerCase() ?? "";
      for (const lossWord of ["retiring", "deprecated", "legacy", "v3"]) {
        expect(copy).not.toContain(lossWord);
      }
    });

    it("hides the Agent announcement on mobile because Agent is unavailable (https://github.com/logancyang/obsidian-copilot-preview/issues/323)", () => {
      mockDesktopRuntime = false;

      render(<AgentModeBanner onOpenAgent={jest.fn()} />);

      expect(screen.queryByRole("button", { name: COPY })).toBeNull();
    });
  });
});
