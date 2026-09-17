import {
  EMPTY_ANSWERERS,
  isFanout,
  listMentionableAgents,
  resolveAnswerers,
} from "@/agentMode/ui/mentionedAgents";
import { EMPTY_AGENT_MENTIONS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { BUILTIN_AGENT, toAgentEntry, type CustomAgent } from "@/agents/types";

function agent(slug: string, over: Partial<CustomAgent> = {}): CustomAgent {
  return {
    slug,
    name: slug[0].toUpperCase() + slug.slice(1),
    description: `${slug} does things`,
    icon: "🪶",
    backendId: null,
    modelId: null,
    memoryEnabled: true,
    created: "2026-09-16T10:00:00Z",
    instructions: "Be yourself.",
    ...over,
  };
}

describe("mentionedAgents", () => {
  describe("listMentionableAgents()", () => {
    it("offers every custom agent with its name, description and icon", () => {
      const entries = listMentionableAgents([
        BUILTIN_AGENT,
        toAgentEntry(agent("jennifer")),
        toAgentEntry(agent("vancat", { icon: "🐱" })),
      ]);

      expect(entries).toEqual([
        { slug: "jennifer", name: "Jennifer", description: "jennifer does things", icon: "🪶" },
        { slug: "vancat", name: "Vancat", description: "vancat does things", icon: "🐱" },
      ]);
    });

    it("never offers the built-in Copilot, which is already who the chat is talking to", () => {
      expect(listMentionableAgents([BUILTIN_AGENT])).toBe(EMPTY_AGENT_MENTIONS);
    });
  });

  describe("resolveAnswerers()", () => {
    const known = new Set(["jennifer", "vancat", "rafa"]);

    it("returns the frozen empty constant when nothing is mentioned", () => {
      expect(resolveAnswerers({ mentionedSlugs: [], knownSlugs: known })).toBe(EMPTY_ANSWERERS);
    });

    it("keeps mentions in editor order and drops repeats", () => {
      expect(
        resolveAnswerers({
          mentionedSlugs: ["vancat", "jennifer", "vancat"],
          knownSlugs: known,
        })
      ).toEqual(["vancat", "jennifer"]);
    });

    it("drops a mention of an agent that no longer exists rather than asking nobody", () => {
      expect(
        resolveAnswerers({ mentionedSlugs: ["jennifer", "ghost"], knownSlugs: known })
      ).toEqual(["jennifer"]);
    });
  });

  describe("isFanout()", () => {
    it("collapses a lone mention of the chat's own persona to the single-agent path", () => {
      // designdocs/CUSTOM_AGENTS.md §6 — the chat's own agent must never both
      // answer through a sub-session and summarize itself.
      expect(isFanout([], "jennifer")).toBe(false);
      expect(isFanout(["jennifer"], "jennifer")).toBe(false);
    });

    it("fans out for any other answerer, including the own persona alongside another", () => {
      expect(isFanout(["vancat"], "jennifer")).toBe(true);
      expect(isFanout(["vancat", "rafa"], "jennifer")).toBe(true);
      expect(isFanout(["jennifer", "vancat"], "jennifer")).toBe(true);
    });

    it("fans out from a Copilot chat, which has no slug of its own to collapse against", () => {
      expect(isFanout(["vancat"], null)).toBe(true);
      expect(isFanout([], null)).toBe(false);
    });
  });
});
