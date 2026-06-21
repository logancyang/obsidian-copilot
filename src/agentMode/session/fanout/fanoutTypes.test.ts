import type { AgentToolKind } from "@/agentMode/session/types";
import {
  buildPriorFanoutContextBlock,
  buildSummaryUserPrompt,
  collapseFanoutTurnToSummaryText,
  EMPTY_PENDING_FANOUT_CONTEXT,
  isWriteOrExecToolKind,
  selectSummaryInputs,
  snapshotFanoutTurn,
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

  it("treats a cancelled slot as failed even when it carries partial text", () => {
    const t: FanoutTurn = {
      answers: {
        claude: { backendId: "claude", status: "done", text: "claude answer" },
        codex: { backendId: "codex", status: "cancelled", text: "partial" },
      },
      summary: { status: "pending", text: "" },
    };
    const { succeeded, failed } = selectSummaryInputs(t);
    expect(succeeded).toEqual([{ backendId: "claude", text: "claude answer" }]);
    expect(failed).toEqual(["codex"]);
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

describe("snapshotFanoutTurn", () => {
  const live = (): FanoutTurn => ({
    answers: {
      claude: { backendId: "claude", status: "running", text: "partial" },
      codex: { backendId: "codex", status: "done", text: "full" },
    },
    summary: { status: "streaming", text: "summary so far" },
  });

  it("returns a fresh top-level reference so React state updates do not bail", () => {
    const turn = live();
    const snap = snapshotFanoutTurn(turn);
    expect(snap).not.toBe(turn);
    expect(snap.answers).not.toBe(turn.answers);
    expect(snap.summary).not.toBe(turn.summary);
  });

  it("copies each answer slot so a captured snapshot is stable under later mutation", () => {
    const turn = live();
    const snap = snapshotFanoutTurn(turn);
    // The orchestrator mutates the live turn in place after emitting.
    turn.answers.claude.text += " more";
    turn.answers.claude.status = "done";
    turn.summary.text = "final";
    expect(snap.answers.claude.text).toBe("partial");
    expect(snap.answers.claude.status).toBe("running");
    expect(snap.summary.text).toBe("summary so far");
  });

  it("preserves slot order and values", () => {
    const snap = snapshotFanoutTurn(live());
    expect(Object.keys(snap.answers)).toEqual(["claude", "codex"]);
    expect(snap.answers.codex.text).toBe("full");
  });
});

describe("buildPriorFanoutContextBlock", () => {
  it("returns null for an empty buffer so the prompt stays unchanged", () => {
    expect(buildPriorFanoutContextBlock([])).toBeNull();
    expect(buildPriorFanoutContextBlock(EMPTY_PENDING_FANOUT_CONTEXT)).toBeNull();
  });

  it("frames a single turn as prior conversation with labeled question + summary", () => {
    const block = buildPriorFanoutContextBlock([{ question: "How do X?", summary: "Do Y." }]);
    expect(block).not.toBeNull();
    expect(block).toContain("<prior_turns>");
    expect(block).toContain("</prior_turns>");
    expect(block).toContain("<multi_agent_turn>");
    expect(block).toContain("<question>\nHow do X?\n</question>");
    expect(block).toContain("<summary>\nDo Y.\n</summary>");
    // Reads as history, not a new instruction to re-answer.
    expect(block).toContain("conversation history");
  });

  it("escapes XML-special characters so a stray tag can't break the framing", () => {
    const block = buildPriorFanoutContextBlock([
      { question: "what about <b> & </summary>?", summary: "a < b" },
    ])!;
    expect(block).not.toContain("</summary>?");
    expect(block).toContain("&lt;b&gt;");
    expect(block).toContain("&amp;");
    expect(block).toContain("a &lt; b");
  });

  it("includes every buffered turn in order", () => {
    const block = buildPriorFanoutContextBlock([
      { question: "Q1", summary: "S1" },
      { question: "Q2", summary: "S2" },
    ])!;
    expect(block.indexOf("Q1")).toBeLessThan(block.indexOf("Q2"));
    expect(block.indexOf("S1")).toBeLessThan(block.indexOf("S2"));
    expect((block.match(/<multi_agent_turn>/g) ?? []).length).toBe(2);
  });
});
