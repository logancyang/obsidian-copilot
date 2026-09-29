import type { AgentMessagePart } from "@/agentMode/session/types";
import { ActionCard } from "@/agentMode/ui/ActionCard";
import {
  AgentPaneCapabilitiesProvider,
  NO_PANE_CAPABILITIES,
  type AgentPaneCapabilities,
} from "@/agentMode/ui/AgentPaneContext";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;

const READ: ToolCallPart = {
  kind: "tool_call",
  id: "read-1",
  title: "Read",
  status: "completed",
  vendorToolName: "Read",
  locations: [{ path: "/host/vault/notes/plan.md" }],
};

function renderCard(capabilities: AgentPaneCapabilities, part: ToolCallPart = READ) {
  return render(
    <AgentPaneCapabilitiesProvider value={capabilities}>
      <ActionCard part={part} open={false} onToggle={() => undefined} />
    </AgentPaneCapabilitiesProvider>
  );
}

describe("ActionCard", () => {
  describe("ActionCard()", () => {
    it("shortens an absolute path with the vault base the environment reports", () => {
      renderCard({ ...NO_PANE_CAPABILITIES, vaultBase: "/host/vault" });
      expect(screen.getByText("Read notes/plan.md")).toBeTruthy();
    });

    it("opens the tool's target in a new leaf when the user clicks its link and the environment can open paths", () => {
      const openPath = jest.fn();
      renderCard({ vaultBase: "/host/vault", openPath });

      fireEvent.click(screen.getByRole("link", { name: "Read notes/plan.md" }));

      expect(openPath).toHaveBeenCalledWith("notes/plan.md", { newLeaf: true });
    });

    it("shows the target as plain text when the environment cannot open paths", () => {
      renderCard({ vaultBase: "/host/vault" });

      expect(screen.getByText("Read notes/plan.md")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("shows no link for a tool call that has not completed", () => {
      renderCard(
        { vaultBase: "/host/vault", openPath: jest.fn() },
        { ...READ, status: "in_progress" }
      );

      expect(screen.queryByRole("link")).toBeNull();
    });
  });
});
