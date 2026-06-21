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

import {
  agentStateForStatus,
  buildFanoutOptions,
  defaultFanoutOption,
  FANOUT_SUMMARY_OPTION,
  selectedAnswer,
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
  summaryStatus = "done" as const
): FanoutTurn {
  const map: Record<string, AgentAnswer> = {};
  for (const a of answers) map[a.backendId] = a;
  return { answers: map, summary: { status: summaryStatus, text: summaryText } };
}

describe("agentStateForStatus", () => {
  it("maps running to a streaming spinner state", () => {
    expect(agentStateForStatus("running")).toBe("streaming");
  });
  it("maps done to the answer state", () => {
    expect(agentStateForStatus("done")).toBe("answer");
  });
  it("maps error to the error state", () => {
    expect(agentStateForStatus("error")).toBe("error");
  });
  it("maps cancelled to the cancelled state", () => {
    expect(agentStateForStatus("cancelled")).toBe("cancelled");
  });
});

describe("buildFanoutOptions", () => {
  it("lists the summary first, then each agent in slot order", () => {
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
  });

  it("resolves each agent's display name and brand icon from the registry", () => {
    const options = buildFanoutOptions(turn([answer("claude", "done", "x")]));
    const claude = options.find((o) => o.value === "claude");
    expect(claude?.label).toBe("Claude");
    expect(claude?.Icon).toBeDefined();
  });

  it("reflects each agent's live state (running -> streaming, done -> answer, error -> error)", () => {
    const options = buildFanoutOptions(
      turn([
        answer("opencode", "done", "a"),
        answer("claude", "running"),
        answer("codex", "error", "", "x"),
      ])
    );
    expect(options.find((o) => o.value === "opencode")?.state).toBe("answer");
    expect(options.find((o) => o.value === "claude")?.state).toBe("streaming");
    expect(options.find((o) => o.value === "codex")?.state).toBe("error");
  });

  it("maps a cancelled slot to the cancelled state", () => {
    const options = buildFanoutOptions(turn([answer("claude", "cancelled", "partial")]));
    expect(options.find((o) => o.value === "claude")?.state).toBe("cancelled");
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
  it("returns null for the summary value", () => {
    const t = turn([answer("opencode", "done", "a")]);
    expect(selectedAnswer(t, FANOUT_SUMMARY_OPTION)).toBeNull();
  });
  it("returns the agent's slot for an agent value", () => {
    const t = turn([answer("opencode", "done", "a")]);
    expect(selectedAnswer(t, "opencode")?.text).toBe("a");
  });
  it("returns null when the agent has no slot", () => {
    const t = turn([answer("opencode", "done", "a")]);
    expect(selectedAnswer(t, "ghost")).toBeNull();
  });
});
