import { EMPTY_ANSWERERS, isFanout, resolveAnswerers } from "@/agentMode/ui/mentionedAgents";

describe("resolveAnswerers", () => {
  const installed = new Set(["opencode", "claude", "codex"]);

  it("returns the frozen empty constant when nothing is mentioned (main is NOT auto-included)", () => {
    expect(resolveAnswerers({ mentionedAgentIds: [], installedAgentIds: installed })).toBe(
      EMPTY_ANSWERERS
    );
  });

  it("returns mentions in order (keeping an explicitly-mentioned main), dedup'd", () => {
    expect(
      resolveAnswerers({
        mentionedAgentIds: ["claude", "opencode", "claude"],
        installedAgentIds: installed,
      })
    ).toEqual(["claude", "opencode"]);
  });

  it("drops mentions of uninstalled agents", () => {
    expect(
      resolveAnswerers({
        mentionedAgentIds: ["claude", "ghost"],
        installedAgentIds: new Set(["opencode", "claude"]),
      })
    ).toEqual(["claude"]);
  });
});

describe("isFanout", () => {
  it("routes single-vs-fan-out: collapses to single-agent only when no non-main answerer exists", () => {
    expect(isFanout([], "claude")).toBe(false);
    expect(isFanout(["claude"], "claude")).toBe(false);
    expect(isFanout(["opencode"], "claude")).toBe(true);
    expect(isFanout(["opencode", "codex"], "claude")).toBe(true);
    expect(isFanout(["claude", "opencode"], "claude")).toBe(true);
  });
});
