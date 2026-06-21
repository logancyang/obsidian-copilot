import React from "react";
import { render, screen } from "@testing-library/react";
import type {
  AgentAnswer,
  AgentAnswerStatus,
  FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";

// Render markdown as plain text so the test doesn't pull in Obsidian's
// renderer (mirrors AgentTrailView.test.tsx).
jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div data-testid="agent-md">{text}</div>,
}));

jest.mock("@/agentMode/backends/registry", () => {
  const Icon = () => null;
  return {
    backendRegistry: {
      opencode: { id: "opencode", displayName: "opencode", Icon },
      claude: { id: "claude", displayName: "Claude", Icon },
    },
  };
});

import { FanoutTurnView } from "@/agentMode/ui/FanoutTurnView";

function answer(
  backendId: string,
  status: AgentAnswerStatus,
  text = "",
  error?: string
): AgentAnswer {
  return { backendId, status, text, error };
}

function turn(
  answers: AgentAnswer[],
  summaryText = "",
  summaryStatus: FanoutTurn["summary"]["status"] = "done"
): FanoutTurn {
  const map: Record<string, AgentAnswer> = {};
  for (const a of answers) map[a.backendId] = a;
  return { answers: map, summary: { status: summaryStatus, text: summaryText } };
}

const app = { workspace: { getActiveFile: () => null } } as never;

describe("FanoutTurnView", () => {
  it("defaults to the summary view (summary-first)", () => {
    const t = turn([answer("opencode", "done", "main")], "the narrative summary");
    render(<FanoutTurnView turn={t} app={app} />);
    expect(screen.getByTestId("agent-md").textContent).toBe("the narrative summary");
  });

  it("shows a pending placeholder when the summary has no text yet", () => {
    const t = turn([answer("opencode", "running")], "", "pending");
    render(<FanoutTurnView turn={t} app={app} />);
    expect(screen.queryByTestId("agent-md")).toBeNull();
    expect(screen.getByText(/Waiting for answers/)).toBeTruthy();
  });

  it("renders a switcher trigger so the user can drill into each agent", () => {
    const t = turn(
      [answer("opencode", "done", "a"), answer("claude", "error", "", "boom")],
      "summary"
    );
    render(<FanoutTurnView turn={t} app={app} />);
    expect(screen.getByLabelText("Select agent answer")).toBeTruthy();
  });
});
