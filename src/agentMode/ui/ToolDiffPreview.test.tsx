import { ToolDiffPreview } from "@/agentMode/ui/ToolDiffPreview";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import { ActionCard } from "@/agentMode/ui/ActionCard";
import type { PermissionPrompt } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/context", () => ({ useApp: jest.fn(() => ({})) }));
jest.mock("@/utils/vaultPath", () => ({ getVaultBase: () => null }));
jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/350";

describe("ToolDiffPreview", () => {
  describe("ToolDiffPreview()", () => {
    it(`shows changed content as text, including literal HTML, without interpreting markup (${issue})`, () => {
      const { container } = render(
        <ToolDiffPreview oldText={"old\n"} newText={"<script>unsafe()</script>\n"} />
      );
      expect(screen.getByRole("region", { name: "File changes" }).textContent).toContain(
        "+<script>unsafe()</script>"
      );
      expect(container.querySelector("script")).toBeNull();
    });

    it(`makes Markdown indentation, tabs and hard-break spaces visibly distinguishable (${issue})`, () => {
      render(
        <ToolDiffPreview
          oldText={"first\n- item\ncode\n"}
          newText={"first  \n  - item\n\tcode\n"}
        />
      );
      const diff = screen.getByRole("region", { name: "File changes" });
      expect(diff.textContent).toContain("+first··\n");
      expect(diff.textContent).toContain("+··- item\n");
      expect(diff.textContent).toContain("+→code");
      expect(screen.getByText("Whitespace: · space, → tab")).toBeTruthy();
    });
  });

  describe("pending and completed review", () => {
    it(`shows matching focused hunks for every file while preserving approval decisions (${issue})`, () => {
      const before = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`).join("\n");
      const content = [
        {
          type: "diff" as const,
          path: "existing.md",
          oldText: before,
          newText: before.replace("Line 100\n", "Revised line\n"),
        },
        {
          type: "diff" as const,
          path: "new.md",
          oldText: null,
          newText: "# New note\nAll content\n",
        },
      ];
      const request: PermissionPrompt = {
        sessionId: "session",
        toolCall: {
          toolCallId: "edit",
          title: "Edit notes",
          kind: "edit",
          status: "pending",
          content,
        },
        options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
      };
      const onResolve = jest.fn();
      render(
        <>
          <ToolPermissionCard request={request} onResolve={onResolve} />
          <ActionCard
            part={{
              kind: "tool_call",
              id: "edit",
              title: "Edit notes",
              toolKind: "edit",
              status: "completed",
              output: content,
            }}
            open
            onToggle={jest.fn()}
          />
        </>
      );
      const previews = screen.getAllByRole("region", { name: "File changes" });
      expect(previews).toHaveLength(4);
      expect(previews[0].textContent).toBe(previews[2].textContent);
      expect(previews[1].textContent).toBe(previews[3].textContent);
      expect(previews[0].textContent).toContain("+Revised line");
      expect(previews[0].textContent).not.toContain("Line 1\n");
      expect(previews[1].textContent).toContain("+# New note\n+All content");
      expect(screen.getByText("+3 / −1 lines")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
      expect(onResolve).toHaveBeenCalledWith("edit", "allow");
    });
  });
});
