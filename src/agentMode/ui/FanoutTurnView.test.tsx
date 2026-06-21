import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
import { defaultFanoutOption, type FanoutOptionValue } from "@/agentMode/ui/fanoutDropdown";

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

// FanoutTurnView is controlled (the card owns the selected tab); a tiny stateful
// harness supplies value/onSelect so a tab click still switches the body.
const Harness: React.FC<{ t: FanoutTurn }> = ({ t }) => {
  const [value, setValue] = useState<FanoutOptionValue>(() => defaultFanoutOption(t));
  return <FanoutTurnView turn={t} app={app} value={value} onSelect={setValue} />;
};

const renderView = (t: FanoutTurn) => render(<Harness t={t} />);

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
});
