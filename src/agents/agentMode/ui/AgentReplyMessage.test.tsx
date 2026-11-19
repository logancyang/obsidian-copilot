import { AgentReplyMessage } from "@/agents/agentMode/ui/AgentReplyMessage";
import { AppContext } from "@/context";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div data-testid="agent-markdown">{text}</div>,
}));

function renderInApp(element: React.ReactElement) {
  return render(<AppContext.Provider value={{} as App}>{element}</AppContext.Provider>);
}

const CHANGE = {
  path: "Plans/Launch plan.md",
  status: "modified" as const,
  before: "a\n",
  after: "a\nb\n",
  additions: 1,
  deletions: 0,
};

describe("AgentReplyMessage", () => {
  describe("AgentReplyMessage()", () => {
    it("shows one line naming the agent above its words, rendered as markdown like any agent reply (https://github.com/Brevilabs/obsidian-copilot-private/issues/944)", () => {
      const reply = "**First** line.\n\n```\ncode\n```";
      renderInApp(
        <AgentReplyMessage mention="m1" name="Maya" reply={reply} onOpenFileChange={jest.fn()} />
      );

      expect(screen.getByText("Maya's reply")).toBeTruthy();
      expect(screen.getByTestId("agent-markdown").textContent).toBe(reply);
    });

    it("shows the files the agent changed in the Files changed card, each opening its diff", () => {
      const onOpenFileChange = jest.fn();
      renderInApp(
        <AgentReplyMessage
          mention="m1"
          name="Maya"
          reply="Added the line."
          fileChanges={[CHANGE]}
          onOpenFileChange={onOpenFileChange}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Plans/Launch plan.md" }));

      expect(onOpenFileChange).toHaveBeenCalledWith(CHANGE);
    });

    it("says the agent didn't reply when its reply has no text", () => {
      renderInApp(
        <AgentReplyMessage mention="m1" name="Maya" reply="" onOpenFileChange={jest.fn()} />
      );

      expect(screen.getByText("Maya didn't reply")).toBeTruthy();
      expect(screen.queryByTestId("agent-markdown")).toBeNull();
    });
  });
});
