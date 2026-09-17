import { BUILTIN_AGENT, resolveAgentEntry, toAgentEntry, type CustomAgent } from "@/agents/types";

const JENNIFER: CustomAgent = {
  slug: "jennifer",
  name: "Jennifer",
  description: "Skeptical editor.",
  icon: "🪶",
  backendId: null,
  modelId: null,
  memoryEnabled: true,
  created: "2026-09-16T10:00:00Z",
  instructions: "",
};

describe("agents/types", () => {
  describe("toAgentEntry()", () => {
    it("presents a custom agent with the same fields the built-in entry offers", () => {
      expect(toAgentEntry(JENNIFER)).toEqual({
        kind: "custom",
        slug: "jennifer",
        name: "Jennifer",
        description: "Skeptical editor.",
        icon: "🪶",
        agent: JENNIFER,
      });
    });
  });

  describe("resolveAgentEntry()", () => {
    it("returns the named agent when it exists", () => {
      expect(resolveAgentEntry("jennifer", [JENNIFER])).toEqual(toAgentEntry(JENNIFER));
    });

    it("returns the built-in Copilot entry when no agent is named", () => {
      expect(resolveAgentEntry(null, [JENNIFER])).toBe(BUILTIN_AGENT);
      expect(resolveAgentEntry(undefined, [JENNIFER])).toBe(BUILTIN_AGENT);
    });

    it("returns the built-in entry for its own reserved slug", () => {
      expect(resolveAgentEntry("copilot", [JENNIFER])).toBe(BUILTIN_AGENT);
    });

    // designdocs/CUSTOM_AGENTS.md §1: a chat that referenced a deleted agent
    // still has to open, running as the default assistant.
    it("falls back to the built-in entry when the named agent was deleted", () => {
      expect(resolveAgentEntry("vancat", [JENNIFER])).toBe(BUILTIN_AGENT);
    });
  });

  describe("BUILTIN_AGENT", () => {
    it("is frozen, so no caller can turn the shared entry into per-vault state", () => {
      expect(Object.isFrozen(BUILTIN_AGENT)).toBe(true);
    });
  });
});
