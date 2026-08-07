import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { AgentSelectPanel } from "@/agentMode/ui/AgentSelectPanel";
import type { AgentSelectState } from "@/agentMode/ui/useAgentSelect";
import type CopilotPlugin from "@/main";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockState: AgentSelectState = {
  rows: [
    {
      id: "opencode",
      name: "opencode",
      description: "opencode description",
      status: "absent",
      recommended: true,
      statusMessage: null,
    },
  ],
  selectedId: "opencode",
  select: jest.fn(),
  cta: {
    label: "Configure",
    note: "opencode isn't set up on this machine yet.",
    action: "configure",
  },
  runCta: jest.fn(),
};

// The panel owns no derivation, so stubbing the hook leaves exactly the wiring
// under test. The mock factory name must match the real export, so the no-hook
// `use` prefix is expected here.
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/agentMode/ui/useAgentSelect", () => ({
  useAgentSelect: () => mockState,
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

describe("AgentSelectPanel", () => {
  describe("AgentSelectPanel()", () => {
    it("renders the selected agent's call to action and runs it on press", () => {
      const plugin = {} as CopilotPlugin;
      const manager = {} as AgentSessionManager;

      render(<AgentSelectPanel plugin={plugin} manager={manager} />);

      expect(screen.getByText("opencode isn't set up on this machine yet.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(mockState.runCta).toHaveBeenCalledTimes(1);
    });
  });
});
