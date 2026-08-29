import {
  AgentStartupProgress,
  type AgentStartupProgressProps,
} from "@/agentMode/ui/AgentStartupProgress";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("AgentStartupProgress", () => {
  describe("AgentStartupProgress()", () => {
    function renderProgress(props: AgentStartupProgressProps) {
      return render(<AgentStartupProgress {...props} />);
    }

    it("names the Plus catalog while OpenCode is gated (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", () => {
      renderProgress({ stage: "plus-catalog", agentName: "opencode" });

      expect(screen.getByRole("status").textContent).toContain("Loading Plus catalog");
    });

    it("explains that OpenCode continues without Plus after catalog failure (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", () => {
      renderProgress({ stage: "backend-without-plus", agentName: "opencode" });

      expect(screen.getByRole("status").textContent).toContain("Starting opencode without Plus");
    });
  });
});
