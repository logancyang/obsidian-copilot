import type { AgentFileManager } from "@/agents/AgentFileManager";
import type { CustomAgent } from "@/agents/types";
import {
  COPILOT_SESSION_AGENT,
  loadSessionAgent,
  missingSessionAgent,
} from "@/agentMode/session/sessionAgent";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const MEMORY_MODIFIED_MS = new Date(2026, 8, 14, 15, 0, 0).getTime();

function jennifer(overrides: Partial<CustomAgent> = {}): CustomAgent {
  return {
    slug: "jennifer",
    name: "Jennifer",
    description: "Skeptical editor.",
    icon: "🪶",
    backendId: null,
    modelId: null,
    effort: null,
    memoryEnabled: true,
    created: "2026-09-16T10:00:00Z",
    instructions: "You are Jennifer, a developmental editor.",
    ...overrides,
  };
}

function buildFiles(
  readMemoryDocument: jest.Mock = jest.fn(async () => ({
    text: "## About the user\n\n- Writes a climate newsletter.",
    modifiedAtMs: MEMORY_MODIFIED_MS,
  }))
): { files: AgentFileManager; readMemoryDocument: jest.Mock } {
  return { files: { readMemoryDocument } as unknown as AgentFileManager, readMemoryDocument };
}

describe("sessionAgent", () => {
  describe("loadSessionAgent()", () => {
    it("carries the agent's display fields and its persona and memory blocks", async () => {
      const { files } = buildFiles();

      const agent = await loadSessionAgent(files, jennifer());

      expect(agent).toMatchObject({ slug: "jennifer", name: "Jennifer", icon: "🪶" });
      expect(agent.personaBlock).toContain('<agent_persona name="Jennifer">');
      expect(agent.personaBlock).toContain('<agent_memory name="Jennifer" updated="2026-09-14">');
      expect(agent.personaBlock).toContain("Writes a climate newsletter.");
    });

    it("never reads the memory file when the agent's memory toggle is off", async () => {
      const { files, readMemoryDocument } = buildFiles();

      const agent = await loadSessionAgent(files, jennifer({ memoryEnabled: false }));

      expect(readMemoryDocument).not.toHaveBeenCalled();
      expect(agent.personaBlock).not.toContain("<agent_memory");
    });

    it("sends the persona alone when MEMORY.md is missing", async () => {
      const { files } = buildFiles(jest.fn(async () => null));

      const agent = await loadSessionAgent(files, jennifer());

      expect(agent.personaBlock).toContain("<agent_persona");
      expect(agent.personaBlock).not.toContain("<agent_memory");
    });

    it("still binds the chat when the memory file cannot be read", async () => {
      // An unreadable notebook is not a reason to refuse the conversation; the
      // agent answers in character with nothing recalled.
      const { files } = buildFiles(
        jest.fn(async () => {
          throw new Error("EACCES");
        })
      );

      const agent = await loadSessionAgent(files, jennifer());

      expect(agent.name).toBe("Jennifer");
      expect(agent.personaBlock).not.toContain("<agent_memory");
    });
  });

  describe("missingSessionAgent()", () => {
    it("keeps the deleted agent's name as a label and sends no persona", async () => {
      // `designdocs/CUSTOM_AGENTS.md` §1: the chat opens, shows who it was held
      // with, and runs as the default assistant.
      expect(missingSessionAgent("night-editor")).toEqual({
        slug: "night-editor",
        name: "Night Editor",
        icon: "",
        personaBlock: null,
      });
    });
  });

  describe("COPILOT_SESSION_AGENT", () => {
    it("names no agent and carries no persona, which is today's assistant", () => {
      expect(COPILOT_SESSION_AGENT.slug).toBeNull();
      expect(COPILOT_SESSION_AGENT.name).toBe("Copilot");
      expect(COPILOT_SESSION_AGENT.personaBlock).toBeNull();
    });
  });
});
