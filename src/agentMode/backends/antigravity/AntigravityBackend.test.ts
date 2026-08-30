import { resetSettings, setSettings } from "@/settings/model";
import {
  setDefaultSystemPromptTitle,
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import { AntigravityBackend } from "./AntigravityBackend";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

/** The system-prompt jotai store is module-global — reset it between tests. */
function resetPromptState(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
  setDefaultSystemPromptTitle("");
  updateCachedSystemPrompts([]);
}

jest.mock("@/agentMode/skills", () => {
  const actual = jest.requireActual("@/agentMode/skills");
  return {
    ...actual,
    SkillManager: {
      hasInstance: () => true,
      getInstance: () => ({
        getAgentDirsProjectRel: () => ({
          claude: ".claude/skills",
          codex: ".agents/skills",
          opencode: ".opencode/skills",
          antigravity: ".gemini/skills",
        }),
      }),
    },
  };
});

describe("AntigravityBackend", () => {
  describe("AntigravityBackend", () => {
    beforeEach(() => {
      resetSettings();
      resetPromptState();
      setSettings({
        agentMode: {
          byok: {},
          activeBackend: "antigravity",
          debugFullFrames: false,
          notificationSound: false,
          notificationSoundId: "piano",
          welcomeDismissed: false,
          skills: { folder: "copilot/skills" },
          backends: {
            antigravity: { binaryPath: "/usr/local/bin/antigravity-acp" },
          },
        },
      });
    });

    describe("buildSpawnDescriptor()", () => {
      it("builds the spawn descriptor with command, env, and system prompt", async () => {
        const backend = new AntigravityBackend();
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        expect(desc.command).toBe("/usr/local/bin/antigravity-acp");
        expect(desc.env.INITIAL_AGENT_MODE).toBe("agent");
        expect(desc.env.ANTIGRAVITY_SYSTEM_PROMPT).toBeDefined();
      });

      it("throws when binary path is not configured", async () => {
        setSettings({
          agentMode: {
            byok: {},
            activeBackend: "antigravity",
            debugFullFrames: false,
            notificationSound: false,
            notificationSoundId: "piano",
            welcomeDismissed: false,
            skills: { folder: "copilot/skills" },
            backends: {
              antigravity: { binaryPath: "" },
            },
          },
        });
        const backend = new AntigravityBackend();
        await expect(backend.buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
          "Antigravity binary path not configured"
        );
      });
    });
  });
});
