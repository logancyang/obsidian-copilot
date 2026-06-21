import type { AgentToolKind } from "@/agentMode/session/types";
import {
  collapseFanoutTurnToSummaryText,
  isWriteOrExecToolKind,
  type FanoutTurn,
} from "./fanoutTypes";

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
