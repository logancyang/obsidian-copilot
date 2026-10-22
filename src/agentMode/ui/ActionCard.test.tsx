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

    it("renders a denied edit as Didn't edit with no file link (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      render(
        <ActionCard
          part={readTool({
            vendorToolName: "Edit",
            title: "Edit plan.md",
            input: { file_path: "plan.md" },
            status: "failed",
          })}
          open={false}
          onToggle={jest.fn()}
        />
      );

      expect(screen.getByText("Didn't edit plan.md")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("renders a stopped command in the past tense with a stop mark, and a stopped edit as Didn't edit (https://github.com/Brevilabs/obsidian-copilot-private/issues/747)", () => {
      const { container } = render(
        <ActionCard
          part={readTool({
            id: "bash",
            vendorToolName: "Bash",
            title: "Run sleep",
            input: { command: "sleep 9" },
            status: "cancelled",
          })}
          open={false}
          onToggle={jest.fn()}
        />
      );
      render(
        <ActionCard
          part={readTool({
            vendorToolName: "Edit",
            title: "Edit plan.md",
            input: { file_path: "plan.md" },
            status: "cancelled",
          })}
          open={false}
          onToggle={jest.fn()}
        />
      );

      expect(container.textContent).toMatch(/^Ran /);
      expect(container.querySelector(".lucide-circle-stop")).toBeTruthy();
      expect(container.querySelector(".tw-animate-spin")).toBeNull();
      expect(screen.getByText("Didn't edit plan.md")).toBeTruthy();
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
