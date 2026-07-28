import type { PermissionOption, PermissionPrompt, SessionId } from "@/agentMode/session/types";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("ToolPermissionCard", () => {
  describe("ToolPermissionCard()", () => {
    it("keeps multiple described actions visibly paired with their respective decisions", () => {
      const onResolve = jest.fn();
      const commandRule =
        "Allow Commands Starting With `/long/path/semantic-search.sh Search only within agents/themes/capture for LLM wiki, AI second brain, knowledge base, digital twin, and local-first Markdown knowledge workspace.`";
      const networkRule =
        "Allow network access to a.really-long-and-specific-subdomain.example.com for future matching requests.";
      const options: PermissionOption[] = [
        {
          optionId: "accept_execpolicy_amendment",
          name: "Allow Always",
          description: commandRule,
          kind: "allow_always",
        },
        {
          optionId: "apply_network_policy_amendment:0",
          name: "Allow Always",
          description: networkRule,
          kind: "allow_always",
        },
      ];

      const { rerender } = render(
        <ToolPermissionCard
          key="first-decision"
          request={makeRequest(options)}
          onResolve={onResolve}
        />
      );

      const commandRow = screen.getByText(commandRule).parentElement;
      const networkRow = screen.getByText(networkRule).parentElement;
      expect(commandRow).not.toBeNull();
      expect(networkRow).not.toBeNull();

      const commandButton = within(commandRow!).getByRole("button", {
        name: "Allow Always",
        description: commandRule,
      });
      const networkButton = within(networkRow!).getByRole("button", {
        name: "Allow Always",
        description: networkRule,
      });
      expect(commandButton.textContent).toBe("Allow Always");

      fireEvent.click(networkButton);
      expect(onResolve).toHaveBeenLastCalledWith(TOOL_CALL_ID, "apply_network_policy_amendment:0");

      rerender(
        <ToolPermissionCard
          key="second-decision"
          request={makeRequest(options)}
          onResolve={onResolve}
        />
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "Allow Always",
          description: commandRule,
        })
      );
      expect(onResolve).toHaveBeenLastCalledWith(TOOL_CALL_ID, "accept_execpolicy_amendment");
    });

    it("orders compact actions by kind and constrains their labels to the card width", () => {
      const unbrokenLabel = "AllowAccessToNetwork.example.com";
      render(
        <ToolPermissionCard
          request={makeRequest([
            { optionId: "reject", name: "No", kind: "reject_once" },
            { optionId: "session", name: "Allow for Session", kind: "allow_always" },
            { optionId: "once", name: unbrokenLabel, kind: "allow_once" },
          ])}
          onResolve={jest.fn()}
        />
      );

      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        unbrokenLabel,
        "Allow for Session",
        "No",
      ]);
      const labelClasses = screen.getByRole("button", { name: unbrokenLabel }).classList;
      expect(labelClasses.contains("tw-max-w-full")).toBe(true);
      expect(labelClasses.contains("tw-whitespace-normal")).toBe(true);
      expect(labelClasses.contains("tw-break-words")).toBe(true);
    });
  });
});
