import { ActionCard } from "@/agentMode/ui/ActionCard";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { openVaultPath } from "@/utils/openVaultPath";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/context", () => ({ useApp: jest.fn().mockReturnValue({}) }));
jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));

function readTool(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    kind: "tool_call",
    id: "read-1",
    title: "Read notes/today.md",
    vendorToolName: "Read",
    input: { file_path: "notes/today.md" },
    status: "completed",
    ...overrides,
  };
}

describe("ActionCard", () => {
  describe("ActionCard()", () => {
    it("links only the file path of a completed read, keeping the verb as plain text", () => {
      render(<ActionCard part={readTool()} open={false} onToggle={jest.fn()} />);

      const link = screen.getByRole("link");
      expect(link.textContent).toBe("notes/today.md");
      expect(screen.getByText("Read").closest("a")).toBeNull();

      fireEvent.click(link);
      expect(openVaultPath).toHaveBeenCalledWith({}, "notes/today.md", { newLeaf: true });
    });

    it("renders an in-progress read as plain text without a link", () => {
      render(
        <ActionCard part={readTool({ status: "in_progress" })} open={false} onToggle={jest.fn()} />
      );

      expect(screen.getByText("Reading notes/today.md")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });
});
