import { getSettings, resetSettings, setSettings, updateSetting } from "@/settings/model";
import { OPENARTIFACTS_WORKSPACE_ROOT_ENV } from "@/openArtifacts/constants";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { MIYO_SEARCH_FOLDER_ENV, MIYO_SEARCH_SCOPE_ENV } from "@/builtinSkills/builtinSkills";
import { detectBinary } from "@/utils/detectBinary";
import { setDisableBuiltinSystemPrompt } from "@/system-prompts/state";
import { CODEX_QUESTION_CARD_STEERING, CodexBackend } from "./CodexBackend";
import * as codexVersion from "./codexVersion";

jest.mock("@/utils/detectBinary", () => ({ detectBinary: jest.fn() }));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const mockAdapterEntry = jest.fn();

jest.mock("./codexVersion", () => {
  const actual = jest.requireActual("./codexVersion");
  return {
    ...actual,
    __esModule: true,
    inspectCodexAcpPackage: (path: string) => ({
      entryPath: mockAdapterEntry(path),
      version: "2.0.0",
      runtimeVersion: "2.0.0",
    }),
  };
});

function useCodexSettings(codex?: Record<string, unknown>): void {
  setSettings({
    agentMode: {
      byok: {},
      activeBackend: "codex",
      debugFullFrames: false,
      notificationSound: false,
      notificationSoundId: "piano",
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
      backends: codex ? { codex } : {},
    },
  });
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
        }),
      }),
    },
  };
});

describe("CodexBackend", () => {
  describe("CodexBackend", () => {
    describe("buildSpawnDescriptor()", () => {
      const hostPlatform = process.platform;
      afterEach(() => Object.defineProperty(process, "platform", { value: hostPlatform }));
      beforeEach(() => {
        Object.defineProperty(process, "platform", { value: "darwin" });
        mockAdapterEntry
          .mockReset()
          .mockReturnValue("/npm/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js");
        resetSettings();
        useCodexSettings({ binaryPath: "/usr/local/bin/codex-acp" });
      });

      it("launches the validated adapter entry with the workspace root in its environment", async () => {
        const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });

        expect(desc.command).toBe(
          "/npm/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js"
        );
        expect(desc.args).toEqual([]);
        expect(desc.env[OPENARTIFACTS_WORKSPACE_ROOT_ENV]).toBe("/vault");
      });

      it("encodes the shared product prompt byte for byte, followed by the question-card steering", async () => {
        const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });

        expect(JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions).toBe(
          `${buildAgentSystemPrompt("codex")}\n\n${CODEX_QUESTION_CARD_STEERING}`
        );
      });

      it("https://github.com/logancyang/obsidian-copilot/issues/3536 steers Codex to the request_user_input card even when the built-in system prompt is disabled", async () => {
        setDisableBuiltinSystemPrompt(true);
        try {
          const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
          const prompt = JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions;

          expect(prompt).not.toContain("You are Obsidian Copilot");
          expect(prompt).toContain("call the `request_user_input` tool");
          expect(prompt).toContain("including Default");
        } finally {
          setDisableBuiltinSystemPrompt(false);
        }
      });

      it("passes the plugin version to built-in Copilot Plus skills", async () => {
        setSettings({ isPaidUser: true, plusLicenseKey: "plus-token", userId: "user-1" });

        const desc = await new CodexBackend("4.0.0-preview-260802").buildSpawnDescriptor({
          vaultBasePath: "/vault",
        });

        expect(desc.env.COPILOT_CLIENT_VERSION).toBe("4.0.0-preview-260802");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/618 starts Codex in the read-only mode that asks before workspace edits", async () => {
        const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });

        expect(desc.env.INITIAL_AGENT_MODE).toBe("read-only");
      });

      it("lets a user override the initial codex-acp mode", async () => {
        useCodexSettings({
          binaryPath: "/usr/local/bin/codex-acp",
          envOverrides: { INITIAL_AGENT_MODE: "agent" },
        });

        const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });

        expect(desc.env.INITIAL_AGENT_MODE).toBe("agent");
      });

      it("preserves user CODEX_CONFIG keys while enforcing Copilot-owned fields", async () => {
        useCodexSettings({
          binaryPath: "/usr/local/bin/codex-acp",
          envOverrides: {
            CODEX_CONFIG: JSON.stringify({
              model: "custom-model",
              developer_instructions: "drop Copilot prompt",
              approval_policy: "never",
            }),
          },
        });

        const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
        const config = JSON.parse(desc.env.CODEX_CONFIG as string);

        expect(config).toEqual(
          expect.objectContaining({ model: "custom-model", approval_policy: "on-request" })
        );
        expect(config.developer_instructions).toContain("Obsidian Copilot");
        expect(config.developer_instructions).not.toContain("drop Copilot prompt");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 gives global and Project sessions the same protected active-vault Miyo identity", async () => {
        setSettings({ miyoSearchAll: false });
        useCodexSettings({
          binaryPath: "/usr/local/bin/codex-acp",
          envOverrides: {
            [MIYO_SEARCH_SCOPE_ENV]: "unrestricted",
            [MIYO_SEARCH_FOLDER_ENV]: "other-vault",
          },
        });

        const desc = await new CodexBackend().buildSpawnDescriptor({
          vaultBasePath: "/active-vault",
          vaultName: "active-vault",
        });

        expect(desc.env[MIYO_SEARCH_SCOPE_ENV]).toBe("current");
        expect(desc.env[MIYO_SEARCH_FOLDER_ENV]).toBe("active-vault");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/599 names only the builtin skills enabled for Codex", async () => {
        const agentMode = getSettings().agentMode;
        updateSetting("agentMode", {
          ...agentMode,
          skills: {
            ...agentMode.skills,
            builtinPreferences: { "copilot-web-search": { disabledAgents: ["codex"] } },
          },
        });

        const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
        const prompt = JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions;

        expect(prompt).not.toContain("copilot-web-search");
        expect(prompt).toContain("copilot-web-fetch for pages/URLs");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 launches a Windows native bundle without detecting Node", async () => {
        Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
        mockAdapterEntry.mockReturnValue("C:\\bundle\\codex-acp.exe");
        jest.mocked(detectBinary).mockClear();

        const result = await new CodexBackend().buildSpawnDescriptor({
          vaultBasePath: "C:\\vault",
        });

        expect(result.command).toBe("C:\\bundle\\codex-acp.exe");
        expect(detectBinary).not.toHaveBeenCalled();
      });

      it("rejects a runtime below the plugin minimum before returning a launch command (https://github.com/Brevilabs/obsidian-copilot-private/issues/535)", async () => {
        const minimum = jest.replaceProperty<{ CODEX_MIN_VERSION: string }, "CODEX_MIN_VERSION">(
          codexVersion,
          "CODEX_MIN_VERSION",
          "2.1.0"
        );
        try {
          await expect(
            new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" })
          ).rejects.toThrow("2.0.0");
        } finally {
          minimum.restore();
        }
      });

      it("https://github.com/logancyang/obsidian-copilot/issues/2916 enforces the supported adapter before spawning", async () => {
        mockAdapterEntry.mockImplementationOnce(() => {
          throw new Error("unsupported Codex adapter");
        });

        await expect(
          new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" })
        ).rejects.toThrow("unsupported Codex adapter");
        expect(mockAdapterEntry).toHaveBeenCalledWith("/usr/local/bin/codex-acp");
      });

      it("throws when the codex binary path is unset", async () => {
        useCodexSettings();

        await expect(
          new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" })
        ).rejects.toThrow(/Codex adapter path not configured/);
      });
    });

    describe("clientCapabilitiesMeta", () => {
      it("opts into Codex's own turn diff when the client initializes https://github.com/agentclientprotocol/codex-acp/issues/601", () => {
        expect(new CodexBackend().clientCapabilitiesMeta).toEqual({ codex: { turnDiff: true } });
      });
    });

    describe("readTurnDiff()", () => {
      it("returns the unified diff and its root from a completed turn's prompt result https://github.com/agentclientprotocol/codex-acp/issues/601", () => {
        const meta = {
          quota: { token_count: { totalTokens: 10 } },
          codex: {
            turnDiff: {
              status: "reported",
              turnId: "turn-1",
              root: "/repo",
              diff: "diff --git a/vault/a.md b/vault/a.md\n",
            },
          },
        };

        expect(new CodexBackend().readTurnDiff(meta)).toEqual({
          root: "/repo",
          unifiedDiff: "diff --git a/vault/a.md b/vault/a.md\n",
        });
      });

      it("returns null when Codex withholds a turn diff that was too large https://github.com/agentclientprotocol/codex-acp/issues/601", () => {
        const meta = {
          codex: { turnDiff: { status: "unavailable", turnId: "turn-1", reason: "tooLarge" } },
        };

        expect(new CodexBackend().readTurnDiff(meta)).toBeNull();
      });

      it("returns null for a prompt result without a turn diff, as a cancelled turn or an older adapter sends https://github.com/agentclientprotocol/codex-acp/issues/601", () => {
        expect(new CodexBackend().readTurnDiff({ quota: {} })).toBeNull();
        expect(new CodexBackend().readTurnDiff(null)).toBeNull();
      });
    });
  });
});
