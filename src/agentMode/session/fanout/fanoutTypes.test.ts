import type { AgentToolKind } from "@/agentMode/session/types";
import {
  buildSummaryUserPrompt,
  collapseFanoutTurnToSummaryText,
  isWriteOrExecToolKind,
  selectSummaryInputs,
  type FanoutTurn,
} from "./fanoutTypes";

const upper = (id: string) => id.toUpperCase();

describe("isWriteOrExecToolKind", () => {
  it("denies write/exec tool kinds", () => {
    const denied: AgentToolKind[] = ["edit", "delete", "move", "execute"];
    for (const kind of denied) {
      expect(isWriteOrExecToolKind(kind)).toBe(true);
    }
  });

  it("allows read/search/fetch/think/switch_mode/other tool kinds", () => {
    const allowed: AgentToolKind[] = ["read", "search", "fetch", "think", "switch_mode", "other"];
    for (const kind of allowed) {
      expect(isWriteOrExecToolKind(kind)).toBe(false);
    }
  });

  it("fails safe (denies) when the kind is unknown", () => {
    expect(isWriteOrExecToolKind(undefined)).toBe(true);
  });
});

describe("collapseFanoutTurnToSummaryText", () => {
  const turnWith = (summaryText: string): FanoutTurn => ({
    answers: {
      claude: { backendId: "claude", status: "done", text: "claude's full answer" },
      codex: { backendId: "codex", status: "done", text: "codex's full answer" },
    },
    summary: { status: summaryText ? "done" : "pending", text: summaryText },
  });

  it("returns the trimmed summary text only — never per-agent answers", () => {
    const text = collapseFanoutTurnToSummaryText(turnWith("  the narrative summary  "));
    expect(text).toBe("the narrative summary");
    expect(text).not.toContain("full answer");
  });

  it("returns empty string for a pending summary (Phase 2 leaves it unfilled)", () => {
    expect(collapseFanoutTurnToSummaryText(turnWith(""))).toBe("");
  });
});

describe("selectSummaryInputs", () => {
  const turn = (): FanoutTurn => ({
    answers: {
      claude: { backendId: "claude", status: "done", text: "claude answer" },
      codex: { backendId: "codex", status: "error", text: "", error: "boom" },
      opencode: { backendId: "opencode", status: "done", text: "  " },
    },
    summary: { status: "pending", text: "" },
  });

  it("keeps only done slots with non-empty text, in insertion order", () => {
    const { succeeded } = selectSummaryInputs(turn());
    expect(succeeded).toEqual([{ backendId: "claude", text: "claude answer" }]);
  });

  it("treats errored and done-but-empty slots as failed", () => {
    const { failed } = selectSummaryInputs(turn());
    expect(failed).toEqual(["codex", "opencode"]);
  });
});

describe("buildSummaryUserPrompt", () => {
  it("returns null when zero agents succeeded (never fabricates)", () => {
    const prompt = buildSummaryUserPrompt(
      "the question",
      { succeeded: [], failed: ["claude", "codex"] },
      upper
    );
    expect(prompt).toBeNull();
  });

  it("composes a single text block with the question, labeled answers, and a failure note", () => {
    const prompt = buildSummaryUserPrompt(
      "  the question  ",
      {
        succeeded: [
          { backendId: "claude", text: "claude says X" },
          { backendId: "opencode", text: "opencode says Y" },
        ],
        failed: ["codex"],
      },
      upper
    );
    expect(prompt).not.toBeNull();
    expect(prompt!).toHaveLength(1);
    expect(prompt![0].type).toBe("text");
    const text = (prompt![0] as { text: string }).text;
    expect(text).toContain("the question");
    expect(text).toContain("### CLAUDE\nclaude says X");
    expect(text).toContain("### OPENCODE\nopencode says Y");
    expect(text).toContain("did not return an answer: CODEX");
  });

  it("omits the failure note when every agent succeeded", () => {
    const prompt = buildSummaryUserPrompt(
      "q",
      { succeeded: [{ backendId: "claude", text: "a" }], failed: [] },
      upper
    );
    const text = (prompt![0] as { text: string }).text;
    expect(text).not.toContain("did not return an answer");
  });
});
