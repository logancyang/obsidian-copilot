import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentAnswer, AgentAnswerStatus } from "@/agentMode/session/fanout/fanoutTypes";

// Mock the registry so the helper resolves brands without dragging in the
// heavy real backend descriptors (each pulls its ACP/permission chain).
jest.mock("@/agentMode/backends/registry", () => {
  const Icon = () => null;
  return {
    backendRegistry: {
      opencode: { id: "opencode", displayName: "opencode", Icon },
      claude: { id: "claude", displayName: "Claude", Icon },
      codex: { id: "codex", displayName: "Codex", Icon },
    },
  };
});

import type { FanoutSummaryStatus } from "@/agentMode/session/fanout/fanoutTypes";
import {
  agentStateForStatus,
  buildFanoutOptions,
  defaultFanoutOption,
  FANOUT_SUMMARY_OPTION,
  selectedAnswer,
  summaryDisplayState,
} from "@/agentMode/ui/fanoutDropdown";

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
  summaryStatus: FanoutSummaryStatus = "done"
): FanoutTurn {
  const map: Record<string, AgentAnswer> = {};
  for (const a of answers) map[a.backendId] = a;
  return { answers: map, summary: { status: summaryStatus, text: summaryText } };
}

describe("agentStateForStatus", () => {
  it("maps each slot status to its display state", () => {
    expect(agentStateForStatus("running")).toBe("streaming");
    expect(agentStateForStatus("done")).toBe("answer");
    expect(agentStateForStatus("error")).toBe("error");
    expect(agentStateForStatus("cancelled")).toBe("cancelled");
  });
});

describe("buildFanoutOptions", () => {
  it("lists the summary first then each agent in slot order, resolving name/icon and live state", () => {
    const t = turn([
      answer("opencode", "done", "main answer"),
      answer("claude", "running"),
      answer("codex", "error", "", "boom"),
    ]);
    const options = buildFanoutOptions(t);

    expect(options.map((o) => o.value)).toEqual([
      FANOUT_SUMMARY_OPTION,
      "opencode",
      "claude",
      "codex",
    ]);
    expect(options[0].label).toBe("Summary");
    expect(options[0].Icon).toBeUndefined();
    // Brand name + icon resolved from the registry; state mirrors slot status.
    const claude = options.find((o) => o.value === "claude");
    expect(claude?.label).toBe("Claude");
    expect(claude?.Icon).toBeDefined();
    expect(claude?.state).toBe("streaming");
    expect(options.find((o) => o.value === "opencode")?.state).toBe("answer");
    expect(options.find((o) => o.value === "codex")?.state).toBe("error");
  });

  it("falls back to the backend id when the registry has no entry", () => {
    const options = buildFanoutOptions(turn([answer("mystery", "done", "x")]));
    const entry = options.find((o) => o.value === "mystery");
    expect(entry?.label).toBe("mystery");
    expect(entry?.Icon).toBeUndefined();
  });
});

describe("defaultFanoutOption", () => {
  it("defaults to the summary (summary-first, D8)", () => {
    const t = turn([answer("opencode", "done", "a"), answer("claude", "done", "b")]);
    expect(defaultFanoutOption(t)).toBe(FANOUT_SUMMARY_OPTION);
  });
});

describe("selectedAnswer", () => {
  it("returns null for the summary value and the agent's slot for an agent value", () => {
    const t = turn([answer("opencode", "done", "a")]);
    expect(selectedAnswer(t, FANOUT_SUMMARY_OPTION)).toBeNull();
    expect(selectedAnswer(t, "opencode")?.text).toBe("a");
    expect(selectedAnswer(t, "ghost")).toBeNull();
  });
});

describe("summaryDisplayState", () => {
  it("is cancelled when pending but every agent is terminal (turn aborted before summary)", () => {
    const t = turn([answer("opencode", "cancelled"), answer("claude", "done", "b")], "", "pending");
    expect(summaryDisplayState(t)).toBe("cancelled");
  });
  it("is unavailable when done with no text (summary generation failed)", () => {
    const t = turn([answer("opencode", "done", "a")], "", "done");
    expect(summaryDisplayState(t)).toBe("unavailable");
  });
});
