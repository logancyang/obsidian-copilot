import { resetSettings, setSettings } from "@/settings/model";
import {
  setDefaultSystemPromptTitle,
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import { OPENARTIFACTS_WORKSPACE_ROOT_ENV } from "@/openArtifacts/constants";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  MIYO_SEARCH_FOLDER_ENV,
  MIYO_SEARCH_SCOPE_ENV,
} from "@/agentMode/skills/builtin/builtinSkills";
import { detectBinary } from "@/utils/detectBinary";
import { CodexBackend } from "./CodexBackend";
import { resolveSupportedCodexAcpEntry } from "./codexVersion";

jest.mock("@/utils/detectBinary", () => ({ detectBinary: jest.fn() }));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("./codexVersion", () => {
  const actual = jest.requireActual("./codexVersion");
  return {
    ...actual,
    resolveSupportedCodexAcpEntry: jest
      .fn()
      .mockReturnValue("/npm/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js"),
  };
});

function makeSystemPrompt(title: string, content: string): UserSystemPrompt {
  return { title, content, createdMs: 0, modifiedMs: 0, lastUsedMs: 0 };
}

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
        }),
      }),
    },
  };
});

describe("CodexBackend", () => {
  describe("CodexBackend", () => {
    describe("buildSpawnDescriptor()", () => {
      beforeEach(() => {
        jest
          .mocked(resolveSupportedCodexAcpEntry)
          .mockReset()
          .mockReturnValue("/npm/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js");
        resetSettings();
        resetPromptState();
        setSettings({
          agentMode: {
            byok: {},
            activeBackend: "codex",
            debugFullFrames: false,
            notificationSound: false,
            notificationSoundId: "piano",
            welcomeDismissed: false,
            skills: { folder: "copilot/skills" },
            backends: {
              codex: { binaryPath: "/usr/local/bin/codex-acp" },
            },
          },
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 launches a Windows native bundle without detecting Node", async () => {
        const platform = process.platform;
        Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
        jest.mocked(resolveSupportedCodexAcpEntry).mockReturnValue("C:\\bundle\\codex-acp.exe");
        jest.mocked(detectBinary).mockClear();
        try {
          const result = await new CodexBackend().buildSpawnDescriptor({
            vaultBasePath: "C:\\vault",
          });
          expect(result.command).toBe("C:\\bundle\\codex-acp.exe");
          expect(detectBinary).not.toHaveBeenCalled();
        } finally {
          Object.defineProperty(process, "platform", { configurable: true, value: platform });
        }
      });

      it("forwards the Copilot prompt through the current adapter config", async () => {
        const backend = new CodexBackend();
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        expect(desc.command).toBe(
          "/npm/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js"
        );
        expect(desc.args).toEqual([]);
        expect(desc.env[OPENARTIFACTS_WORKSPACE_ROOT_ENV]).toBe("/vault");

        const config = JSON.parse(desc.env.CODEX_CONFIG as string);
        expect(config.developer_instructions).toContain("Obsidian Copilot");
        expect(config.developer_instructions).toContain(
          "NOT a software-engineering agent or CLI coding tool"
        );
        expect(config.developer_instructions).toContain("{folder_name}");
        expect(config.developer_instructions).toContain("{activeNote}");
        expect(config.developer_instructions).not.toContain("metadata.copilot-enabled-agents");
        expect(config.developer_instructions).not.toContain("copilot/skills/<name>/SKILL.md");
      });

      it("passes the plugin version to built-in Copilot Plus skills", async () => {
        setSettings({ isPaidUser: true, plusLicenseKey: "plus-token", userId: "user-1" });

        const desc = await new CodexBackend("4.0.0-preview-260802").buildSpawnDescriptor({
          vaultBasePath: "/vault",
        });

        expect(desc.env.COPILOT_CLIENT_VERSION).toBe("4.0.0-preview-260802");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 gives global and Project sessions the same protected active-vault Miyo identity", async () => {
        setSettings({
          miyoSearchAll: false,
          agentMode: {
            byok: {},
            activeBackend: "codex",
            debugFullFrames: false,
            notificationSound: false,
            notificationSoundId: "piano",
            welcomeDismissed: false,
            skills: { folder: "copilot/skills" },
            backends: {
              codex: {
                binaryPath: "/usr/local/bin/codex-acp",
                envOverrides: {
                  [MIYO_SEARCH_SCOPE_ENV]: "unrestricted",
                  [MIYO_SEARCH_FOLDER_ENV]: "other-vault",
                },
              },
            },
          },
        });

        const desc = await new CodexBackend().buildSpawnDescriptor({
          vaultBasePath: "/active-vault",
          vaultName: "active-vault",
        });

        expect(desc.env[MIYO_SEARCH_SCOPE_ENV]).toBe("current");
        expect(desc.env[MIYO_SEARCH_FOLDER_ENV]).toBe("active-vault");
      });

      it("encodes the shared product prompt byte for byte", async () => {
        const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
        const shared = buildAgentSystemPrompt();

        // `toBe`, not `toContain`: this string is the provider cache prefix, and a containment
        // check passes while stray bytes push everything after it out of the cache.
        expect(JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions).toBe(shared);
      });

      it("keeps those bytes identical when the vault path changes", async () => {
        const backend = new CodexBackend();
        const a = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        const b = await backend.buildSpawnDescriptor({ vaultBasePath: "/somewhere/else/vault" });

        expect(JSON.parse(b.env.CODEX_CONFIG as string).developer_instructions).toBe(
          JSON.parse(a.env.CODEX_CONFIG as string).developer_instructions
        );
      });

      it("does not copy Chat mode custom prompts into developer_instructions", async () => {
        updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
        setSelectedPromptTitle("Haiku");
        const backend = new CodexBackend();
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        const value = JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions;
        expect(value).toContain("Obsidian Copilot");
        expect(value).not.toContain("<user_custom_instructions>");
        expect(value).not.toContain("respond in haiku");
      });

      it("suppresses the base prompt when 'disable builtin' is on, keeping the pill directive", async () => {
        updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
        setSelectedPromptTitle("Haiku");
        setDisableBuiltinSystemPrompt(true);
        const backend = new CodexBackend();
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        const value = JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions;
        expect(value).not.toContain("Obsidian Copilot");
        expect(value).not.toContain("respond in haiku");
        // Pill directive is functional wiring, not builtin framing — always sent.
        expect(value).toContain("{folder_name}");
      });

      it("does not template a skills folder into developer_instructions", async () => {
        setSettings({
          agentMode: {
            byok: {},
            activeBackend: "codex",
            debugFullFrames: false,
            notificationSound: false,
            notificationSoundId: "piano",
            welcomeDismissed: false,
            skills: { folder: "team-skills" },
            backends: { codex: { binaryPath: "/usr/local/bin/codex-acp" } },
          },
        });
        const backend = new CodexBackend();
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        const value = JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions;
        // The pill directive doesn't reference the skills folder at all.
        expect(value).not.toContain("team-skills");
        expect(value).not.toContain("copilot/skills");
      });

      it("pins spawn-time approval policy, reviewer, and sandbox without legacy argv", async () => {
        const backend = new CodexBackend();
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        expect(desc.args).toEqual([]);
        expect(JSON.parse(desc.env.CODEX_CONFIG as string)).toEqual(
          expect.objectContaining({
            approval_policy: "on-request",
            approvals_reviewer: "user",
            sandbox_mode: "workspace-write",
          })
        );
      });

      it("preserves user CODEX_CONFIG keys while enforcing Copilot-owned fields", async () => {
        setSettings({
          agentMode: {
            byok: {},
            activeBackend: "codex",
            debugFullFrames: false,
            notificationSound: false,
            notificationSoundId: "piano",
            welcomeDismissed: false,
            skills: { folder: "copilot/skills" },
            backends: {
              codex: {
                binaryPath: "/usr/local/bin/codex-acp",
                envOverrides: {
                  CODEX_CONFIG: JSON.stringify({
                    model: "custom-model",
                    developer_instructions: "drop Copilot prompt",
                    approval_policy: "never",
                    approvals_reviewer: "auto_review",
                    sandbox_mode: "danger-full-access",
                  }),
                },
              },
            },
          },
        });

        const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
        const config = JSON.parse(desc.env.CODEX_CONFIG as string);
        expect(config).toEqual(
          expect.objectContaining({
            model: "custom-model",
            approval_policy: "on-request",
            approvals_reviewer: "user",
            sandbox_mode: "workspace-write",
          })
        );
        expect(config.developer_instructions).toContain("Obsidian Copilot");
        expect(config.developer_instructions).not.toContain("drop Copilot prompt");
      });

      it.each(["not-json", "[]", "null"])(
        "rejects an invalid CODEX_CONFIG override without echoing it (%s)",
        async (CODEX_CONFIG) => {
          setSettings({
            agentMode: {
              byok: {},
              activeBackend: "codex",
              debugFullFrames: false,
              notificationSound: false,
              notificationSoundId: "piano",
              welcomeDismissed: false,
              skills: { folder: "copilot/skills" },
              backends: {
                codex: {
                  binaryPath: "/usr/local/bin/codex-acp",
                  envOverrides: { CODEX_CONFIG },
                },
              },
            },
          });

          await expect(
            new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" })
          ).rejects.toThrow("Codex CODEX_CONFIG must be a valid JSON object.");
        }
      );

      it("starts current codex-acp adapters in their canonical default mode", async () => {
        const backend = new CodexBackend();
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        expect(desc.env.INITIAL_AGENT_MODE).toBe("agent");
      });

      it("lets a user override the initial codex-acp mode", async () => {
        setSettings({
          agentMode: {
            byok: {},
            activeBackend: "codex",
            debugFullFrames: false,
            notificationSound: false,
            notificationSoundId: "piano",
            welcomeDismissed: false,
            skills: { folder: "copilot/skills" },
            backends: {
              codex: {
                binaryPath: "/usr/local/bin/codex-acp",
                envOverrides: { INITIAL_AGENT_MODE: "read-only" },
              },
            },
          },
        });
        const backend = new CodexBackend();
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        expect(desc.env.INITIAL_AGENT_MODE).toBe("read-only");
      });

      it("does not add a project.md fallback to the codex spawn args", async () => {
        // Omitting the fallback prevents a GLOBAL session from treating a vault-root project.md note
        // as codex instructions (the spawn descriptor has no scope to gate on).
        const backend = new CodexBackend();
        const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
        expect(desc.args).not.toContainEqual(
          expect.stringContaining("project_doc_fallback_filenames")
        );
      });

      it("https://github.com/logancyang/obsidian-copilot/issues/2916 enforces the supported adapter before spawning", async () => {
        jest.mocked(resolveSupportedCodexAcpEntry).mockImplementationOnce(() => {
          throw new Error("unsupported Codex adapter");
        });

        await expect(
          new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" })
        ).rejects.toThrow("unsupported Codex adapter");
        expect(resolveSupportedCodexAcpEntry).toHaveBeenCalledWith("/usr/local/bin/codex-acp");
      });

      it("throws when the codex binary path is unset", async () => {
        setSettings({
          agentMode: {
            byok: {},
            activeBackend: "codex",
            debugFullFrames: false,
            notificationSound: false,
            notificationSoundId: "piano",
            welcomeDismissed: false,
            skills: { folder: "copilot/skills" },
            backends: {},
          },
        });
        const backend = new CodexBackend();
        await expect(backend.buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
          /Codex adapter path not configured/
        );
      });
    });
  });
});
