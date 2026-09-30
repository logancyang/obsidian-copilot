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

describe("ToolPermissionCard", () => {
  describe("ToolPermissionCard()", () => {
    it("fills the available action-rail width", () => {
      const { container } = render(
        <ToolPermissionCard request={makeRequest([])} onResolve={jest.fn()} />
      );

      expect(container.firstElementChild?.classList.contains("tw-w-full")).toBe(true);
    });

    it("names the tool when the request title carries only its argument for https://github.com/Brevilabs/obsidian-copilot-private/issues/599", () => {
      const request = makeRequest([]);
      request.toolCall.title = "latest stable Node.js version";

      render(<ToolPermissionCard request={request} onResolve={jest.fn()} toolName="websearch" />);

      expect(screen.getByText(/Agent Mode wants to use/).textContent).toBe(
        "Agent Mode wants to use websearch: latest stable Node.js version."
      );
    });

    it("keeps the run sentence when the request title already names the tool", () => {
      const request = makeRequest([]);
      request.toolCall.title = "Edit launch brief.md";

      render(<ToolPermissionCard request={request} onResolve={jest.fn()} toolName="Edit" />);

      expect(screen.getByText(/Agent Mode wants to run/).textContent).toBe(
        "Agent Mode wants to run Edit launch brief.md."
      );
    });

    it("keeps duplicate described actions together and numbers their tooltip triggers", async () => {
      const onResolve = jest.fn();
      const firstRule = "Allow commands starting with mkdir";
      const secondRule = "Allow commands starting with dir";
      const options: PermissionOption[] = [
        {
          optionId: "accept_execpolicy_amendment",
          name: "Allow Always",
          description: firstRule,
          kind: "allow_always",
        },
        {
          optionId: "apply_network_policy_amendment:0",
          name: "Allow Always",
          description: secondRule,
          kind: "allow_always",
        },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ];

      render(<ToolPermissionCard request={makeRequest(options)} onResolve={onResolve} />);

      expect(screen.queryByText(firstRule)).toBeNull();
      expect(screen.queryByText(secondRule)).toBeNull();

      const firstButton = screen.getByRole("button", { name: "Allow Always 1" });
      const secondButton = screen.getByRole("button", { name: "Allow Always 2" });
      const rejectButton = screen.getByRole("button", { name: "Reject" });
      expect(firstButton.parentElement).toBe(secondButton.parentElement);
      expect(secondButton.parentElement).toBe(rejectButton.parentElement);

      fireEvent.pointerMove(firstButton, { pointerType: "mouse" });
      expect((await screen.findByRole("tooltip")).textContent).toBe(firstRule);

      fireEvent.click(secondButton);
      expect(onResolve).toHaveBeenLastCalledWith(TOOL_CALL_ID, "apply_network_policy_amendment:0");
    });

    it("leaves a single described action unnumbered", () => {
      const description = "Allow commands starting with mkdir";
      const onResolve = jest.fn();
      render(
        <ToolPermissionCard
          request={makeRequest([
            {
              optionId: "accept_execpolicy_amendment",
              name: "Allow Always",
              description,
              kind: "allow_always",
            },
          ])}
          onResolve={onResolve}
        />
      );

      expect(screen.queryByText(description)).toBeNull();
      const button = screen.getByRole("button", { name: "Allow Always" });
      fireEvent.click(button);
      expect(onResolve).toHaveBeenLastCalledWith(TOOL_CALL_ID, "accept_execpolicy_amendment");
    });

    it("does not number distinct persistent action labels", () => {
      render(
        <ToolPermissionCard
          request={makeRequest([
            {
              optionId: "allow",
              name: "Allow Always",
              description: "Allow example.com",
              kind: "allow_always",
            },
            {
              optionId: "block",
              name: "Block Always",
              description: "Block example.net",
              kind: "reject_always",
            },
          ])}
          onResolve={jest.fn()}
        />
      );

      expect(screen.getByRole("button", { name: "Allow Always" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Block Always" })).toBeTruthy();
    });

    it("keeps generated suffixes distinct from backend-provided labels", () => {
      render(
        <ToolPermissionCard
          request={makeRequest([
            { optionId: "first", name: "Allow Always", kind: "allow_always" },
            { optionId: "second", name: "Allow Always", kind: "allow_always" },
            { optionId: "third", name: "Allow Always 1", kind: "allow_always" },
          ])}
          onResolve={jest.fn()}
        />
      );

      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Allow Always 2",
        "Allow Always 3",
        "Allow Always 1",
      ]);
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
      expect(button.firstElementChild?.classList.contains("tw-break-words")).toBe(true);
    });

    it("labels an option that quotes a command prefix with its prose and shows the prefix on hover https://github.com/Brevilabs/obsidian-copilot-private/issues/618", async () => {
      const onResolve = jest.fn();
      const prefix = 'python3 -c \'from pathlib import Path; Path("note.md").write_text("hi")\'';
      render(
        <ToolPermissionCard
          request={makeRequest([
            { optionId: "approved", name: "Yes, proceed", kind: "allow_once" },
            {
              optionId: "approved-execpolicy-amendment",
              name: `Yes, and don't ask again for commands that start with \`${prefix}\``,
              kind: "allow_always",
            },
            {
              optionId: "abort",
              name: "No, and tell Codex what to do differently",
              kind: "reject_once",
            },
          ])}
          onResolve={onResolve}
        />
      );

      expect(screen.queryByText(prefix)).toBeNull();
      const button = screen.getByRole("button", {
        name: "Yes, and don't ask again for commands that start with…",
      });

      fireEvent.pointerMove(button, { pointerType: "mouse" });
      expect((await screen.findByRole("tooltip")).textContent).toBe(prefix);

      fireEvent.click(button);
      expect(onResolve).toHaveBeenLastCalledWith(TOOL_CALL_ID, "approved-execpolicy-amendment");
    });

    it("shows an option's description above its quoted code in one tooltip https://github.com/Brevilabs/obsidian-copilot-private/issues/618", async () => {
      render(
        <ToolPermissionCard
          request={makeRequest([
            {
              optionId: "rule",
              name: "Always allow `git status`",
              description: "Adds a rule to your Codex config",
              kind: "allow_always",
            },
          ])}
          onResolve={jest.fn()}
        />
      );

      fireEvent.pointerMove(screen.getByRole("button", { name: "Always allow…" }), {
        pointerType: "mouse",
      });
      expect((await screen.findByRole("tooltip")).textContent).toBe(
        "Adds a rule to your Codex config\ngit status"
      );
    });

    it("numbers options whose labels differ only in quoted code https://github.com/Brevilabs/obsidian-copilot-private/issues/618", () => {
      render(
        <ToolPermissionCard
          request={makeRequest([
            { optionId: "git", name: "Always allow `git status`", kind: "allow_always" },
            { optionId: "npm", name: "Always allow `npm test`", kind: "allow_always" },
          ])}
          onResolve={jest.fn()}
        />
      );

      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Always allow… 1",
        "Always allow… 2",
      ]);
    });
  });
});
