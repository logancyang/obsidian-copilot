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
      const networkRule = "Block a.really-long-and-specific-subdomain.example.com in the Future";
      const options: PermissionOption[] = [
        {
          optionId: "accept_execpolicy_amendment",
          name: "Allow Always",
          description: commandRule,
          kind: "allow_always",
        },
        {
          optionId: "apply_network_policy_amendment:0",
          name: "Block Always",
          description: networkRule,
          kind: "reject_always",
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
        name: "Block Always",
        description: networkRule,
      });
      expect(commandButton.textContent).toBe("Allow Always");
      expect(networkButton.textContent).toBe("Block Always");

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

    it("orders compact actions by kind and makes unbroken labels shrinkable", () => {
      const unbrokenLabel = "AllowAccessToNetwork.example.com".repeat(8);
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
      const button = screen.getByRole("button", { name: unbrokenLabel });
      expect(button.classList.contains("tw-max-w-full")).toBe(true);
      expect(button.classList.contains("tw-min-w-0")).toBe(true);
      expect(button.firstElementChild).toMatchObject({
        tagName: "SPAN",
        textContent: unbrokenLabel,
      });
      expect(button.firstElementChild?.classList.contains("tw-min-w-0")).toBe(true);
      expect(button.firstElementChild?.classList.contains("tw-break-all")).toBe(true);
    });
  });
});
