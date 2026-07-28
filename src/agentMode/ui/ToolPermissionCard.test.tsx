import type { PermissionOption, PermissionPrompt, SessionId } from "@/agentMode/session/types";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const SESSION_ID = "session-1" as SessionId;
const TOOL_CALL_ID = "tool-1";

function makeRequest(options: PermissionOption[]): PermissionPrompt {
  return {
    sessionId: SESSION_ID,
    toolCall: {
      toolCallId: TOOL_CALL_ID,
      title: "Tool call",
      kind: "execute",
      status: "pending",
      rawInput: { command: "search" },
    },
    options,
  };
}

describe("ToolPermissionCard module", () => {
  describe("ToolPermissionCard", () => {
    it("uses a fixed action label and presents a long option name as its description", () => {
      const onResolve = jest.fn();
      const longName =
        "Allow Commands Starting With `/long/path/semantic-search.sh Search only within agents/themes/capture for LLM wiki, AI second brain, knowledge base, digital twin, and local-first Markdown knowledge workspace.`";

      render(
        <ToolPermissionCard
          request={makeRequest([
            { optionId: "allow_once", name: "Allow Once", kind: "allow_once" },
            { optionId: "allow_always", name: "Allow for Session", kind: "allow_always" },
            {
              optionId: "accept_execpolicy_amendment",
              name: longName,
              kind: "allow_always",
            },
            { optionId: "reject_once", name: "Reject", kind: "reject_once" },
          ])}
          onResolve={onResolve}
        />
      );

      expect(screen.queryByRole("button", { name: longName })).toBeNull();
      const ruleButton = screen.getByRole("button", {
        name: "Allow Always",
        description: longName,
      });
      expect(screen.getByText(longName)).not.toBe(ruleButton);

      fireEvent.click(ruleButton);
      expect(onResolve).toHaveBeenCalledWith(TOOL_CALL_ID, "accept_execpolicy_amendment");
    });

    it("uses semantic fixed labels for every kind of descriptive option", () => {
      const options: PermissionOption[] = [
        {
          optionId: "once",
          name: "Allow this individual permission request after reviewing all of its details",
          kind: "allow_once",
        },
        {
          optionId: "always",
          name: "Allow this permission rule for later matching tool calls in the session",
          kind: "allow_always",
        },
        {
          optionId: "reject",
          name: "Reject this individual permission request after reviewing all of its details",
          kind: "reject_once",
        },
        {
          optionId: "block",
          name: "Block this permission rule for later matching tool calls in the session",
          kind: "reject_always",
        },
      ];

      render(<ToolPermissionCard request={makeRequest(options)} onResolve={jest.fn()} />);

      const expectedLabels = ["Allow", "Allow Always", "Reject", "Block Rule"];
      for (const [index, label] of expectedLabels.entries()) {
        expect(
          screen.getByRole("button", { name: label, description: options[index].name })
        ).toBeTruthy();
      }
    });

    it("keeps compact backend labels and orders them by permission kind", () => {
      render(
        <ToolPermissionCard
          request={makeRequest([
            { optionId: "reject", name: "No", kind: "reject_once" },
            { optionId: "session", name: "Allow for Session", kind: "allow_always" },
            { optionId: "once", name: "Allow Once", kind: "allow_once" },
          ])}
          onResolve={jest.fn()}
        />
      );

      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Allow Once",
        "Allow for Session",
        "No",
      ]);
      expect(screen.queryByText("Permission details")).toBeNull();
    });
  });
});
