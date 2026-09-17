import type {
  AgentAnswer,
  AgentAnswerStatus,
  FanoutSummaryStatus,
  FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import {
  agentStateForAnswer,
  agentStateForStatus,
  buildFanoutOptions,
  defaultFanoutOption,
  FANOUT_SUMMARY_OPTION,
  selectedAnswer,
  summaryDisplayState,
} from "@/agentMode/ui/fanoutDropdown";

function answer(
  agentSlug: string,
  status: AgentAnswerStatus,
  text = "",
  over: Partial<AgentAnswer> = {}
): AgentAnswer {
  return {
    agentSlug,
    name: agentSlug[0].toUpperCase() + agentSlug.slice(1),
    icon: "🪶",
    status,
    text,
    ...over,
  };
}

function turn(
  answers: AgentAnswer[],
  summaryText = "",
  summaryStatus: FanoutSummaryStatus = "done"
): FanoutTurn {
  const map: Record<string, AgentAnswer> = {};
  for (const a of answers) map[a.agentSlug] = a;
  return { answers: map, summary: { status: summaryStatus, text: summaryText } };
}

describe("fanoutDropdown", () => {
  describe("agentStateForStatus()", () => {
    it("maps each slot status to its display state", () => {
      expect(agentStateForStatus("running")).toBe("streaming");
      expect(agentStateForStatus("done")).toBe("answer");
      expect(agentStateForStatus("error")).toBe("error");
      expect(agentStateForStatus("cancelled")).toBe("cancelled");
    });
  });

  describe("agentStateForAnswer()", () => {
    it("maps a done slot with text to answer, but a done slot with no text to empty", () => {
      expect(agentStateForAnswer(answer("vancat", "done", "hi"))).toBe("answer");
      // The bug: a finished-but-empty slot must NOT read as a success check.
      expect(agentStateForAnswer(answer("vancat", "done", "   "))).toBe("empty");
    });

    it("defers to the raw status for non-done slots", () => {
      expect(agentStateForAnswer(answer("vancat", "running", ""))).toBe("streaming");
      expect(agentStateForAnswer(answer("vancat", "error", "", { error: "x" }))).toBe("error");
    });
  });

  describe("buildFanoutOptions()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/481 omits Summary when exactly one agent answered", () => {
      const options = buildFanoutOptions(turn([answer("jennifer", "done", "Jennifer answer")]));

      expect(options.map((option) => option.value)).toEqual(["jennifer"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/481 preserves Summary for a saved one-agent turn that already has one", () => {
      const options = buildFanoutOptions(
        turn([answer("jennifer", "done", "Jennifer answer")], "Existing summary")
      );

      expect(options.map((option) => option.value)).toEqual([FANOUT_SUMMARY_OPTION, "jennifer"]);
    });

    it("lists the summary first then each agent in mention order, with its name, icon and live state", () => {
      const options = buildFanoutOptions(
        turn([
          answer("jennifer", "done", "main answer"),
          answer("vancat", "running", "", { icon: "🐱" }),
          answer("rafa", "error", "", { error: "boom" }),
        ])
      );

      expect(options.map((o) => o.value)).toEqual([
        FANOUT_SUMMARY_OPTION,
        "jennifer",
        "vancat",
        "rafa",
      ]);
      expect(options[0].label).toBe("Summary");
      expect(options[0].icon).toBeUndefined();
      const vancat = options.find((o) => o.value === "vancat");
      expect(vancat).toMatchObject({ label: "Vancat", icon: "🐱", state: "streaming" });
      expect(options.find((o) => o.value === "jennifer")?.state).toBe("answer");
      expect(options.find((o) => o.value === "rafa")?.state).toBe("error");
    });

    it("labels a legacy brand answer from the name the composite saved, with no icon", () => {
      // A turn persisted before agents replaced backend brands as answerers.
      // designdocs/CUSTOM_AGENTS.md §6.
      const options = buildFanoutOptions(
        turn([answer("claude", "done", "x", { name: "Claude", icon: "" })])
      );

      expect(options[0]).toMatchObject({ value: "claude", label: "Claude", icon: "" });
    });
  });

  describe("defaultFanoutOption()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/481 selects the sole mentioned agent directly", () => {
      expect(defaultFanoutOption(turn([answer("jennifer", "done", "Jennifer answer")]))).toBe(
        "jennifer"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/481 defaults to an existing summary in a saved one-agent turn", () => {
      expect(
        defaultFanoutOption(turn([answer("jennifer", "done", "answer")], "Existing summary"))
      ).toBe(FANOUT_SUMMARY_OPTION);
    });

    it("defaults to the summary (summary-first, D8)", () => {
      const t = turn([answer("jennifer", "done", "a"), answer("vancat", "done", "b")]);
      expect(defaultFanoutOption(t)).toBe(FANOUT_SUMMARY_OPTION);
    });
  });

  describe("selectedAnswer()", () => {
    it("returns null for the summary value and the agent's slot for an agent value", () => {
      const t = turn([answer("jennifer", "done", "a")]);
      expect(selectedAnswer(t, FANOUT_SUMMARY_OPTION)).toBeNull();
      expect(selectedAnswer(t, "jennifer")?.text).toBe("a");
      expect(selectedAnswer(t, "ghost")).toBeNull();
    });
  });

  describe("summaryDisplayState()", () => {
    it("is cancelled when pending but every agent is terminal (turn aborted before summary)", () => {
      const t = turn(
        [answer("jennifer", "cancelled"), answer("vancat", "done", "b")],
        "",
        "pending"
      );
      expect(summaryDisplayState(t)).toBe("cancelled");
    });

    it("is unavailable when done with no text (summary generation failed)", () => {
      expect(summaryDisplayState(turn([answer("jennifer", "done", "a")], "", "done"))).toBe(
        "unavailable"
      );
    });
  });
});
