import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

// The per-slot copy uses CopyButton → a tooltip whose portal reads the
// Obsidian-only `activeDocument` global; stub it out (not the unit under test).
jest.mock("@/components/chat-components/CopyButton", () => ({
  CopyButton: ({ text }: { text: string }) => (
    // eslint-disable-next-line @eslint-react/dom/no-missing-button-type -- test stub
    <button data-testid="slot-copy" data-text={text} />
  ),
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

const renderView = (t: FanoutTurn) => render(<FanoutTurnView turn={t} app={app} />);

describe("FanoutTurnView", () => {
  it("defaults to the summary view (summary-first)", () => {
    const t = turn([answer("opencode", "done", "main")], "the narrative summary");
    renderView(t);
    expect(screen.getByTestId("agent-md").textContent).toBe("the narrative summary");
  });

  it("shows a pending placeholder when the summary has no text yet", () => {
    const t = turn([answer("opencode", "running")], "", "pending");
    renderView(t);
    expect(screen.queryByTestId("agent-md")).toBeNull();
    expect(screen.getByText(/Waiting for answers/)).toBeTruthy();
  });

  it("renders a segmented tab row so the user can drill into each agent", () => {
    const t = turn(
      [answer("opencode", "done", "a"), answer("claude", "error", "", "boom")],
      "summary"
    );
    renderView(t);
    const tablist = screen.getByRole("tablist", { name: "Agent answers" });
    const tabs = within(tablist).getAllByRole("tab");
    // Summary tab + one tab per agent.
    expect(tabs).toHaveLength(3);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("switches to the selected agent's answer when its tab is clicked", () => {
    const t = turn(
      [answer("opencode", "done", "OPENCODE_BODY"), answer("claude", "done", "CLAUDE_BODY")],
      "the narrative summary"
    );
    renderView(t);
    // Summary first.
    expect(screen.getByTestId("agent-md").textContent).toBe("the narrative summary");
    fireEvent.click(screen.getByRole("tab", { name: /opencode/ }));
    expect(screen.getByTestId("agent-md").textContent).toBe("OPENCODE_BODY");
  });

  it("renders cleanly when agents errored or were cancelled (terminal turn)", () => {
    const t = turn(
      [answer("opencode", "cancelled", "partial"), answer("claude", "error", "", "boom")],
      "the narrative summary"
    );
    renderView(t);
    // Summary-first default still renders; the tab row exposes both terminal
    // agents (states mapped by agentStateForStatus, unit-tested separately).
    expect(screen.getByTestId("agent-md").textContent).toBe("the narrative summary");
    expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(3);
  });
});
