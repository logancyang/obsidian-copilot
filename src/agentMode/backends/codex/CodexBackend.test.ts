import { resetSettings, setSettings } from "@/settings/model";
import {
  setDefaultSystemPromptTitle,
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import { CodexBackend } from "./CodexBackend";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

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

function makeSystemPrompt(title: string, content: string): UserSystemPrompt {
  return { title, content, createdMs: 0, modifiedMs: 0, lastUsedMs: 0 };
}

function resetPromptState(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
  setDefaultSystemPromptTitle("");
  updateCachedSystemPrompts([]);
}

function codexConfig(env: NodeJS.ProcessEnv): Record<string, unknown> {
  return JSON.parse(env.CODEX_CONFIG ?? "") as Record<string, unknown>;
}

describe("CodexBackend.buildSpawnDescriptor", () => {
  beforeEach(() => {
    resetSettings();
    resetPromptState();
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {
          codex: { binaryPath: "/usr/local/bin/codex-acp" },
        },
      },
    });
  });

  it("transports the composed Copilot instructions through CODEX_CONFIG", async () => {
    const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const instructions = codexConfig(desc.env).developer_instructions;

    expect(desc.command).toBe("/usr/local/bin/codex-acp");
    expect(desc.args).toEqual([]);
    expect(instructions).toEqual(expect.any(String));
    expect(instructions).toContain("Obsidian Copilot");
    expect(instructions).toContain("NOT a software-engineering agent or CLI coding tool");
    expect(instructions).toContain("{folder_name}");
    expect(instructions).toContain("{activeNote}");
    expect(instructions).not.toContain("metadata.copilot-enabled-agents");
    expect(instructions).not.toContain("copilot/skills/<name>/SKILL.md");
  });

  it("preserves the selected custom prompt in developer_instructions", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");

    const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const instructions = codexConfig(desc.env).developer_instructions;

    expect(instructions).toContain("Obsidian Copilot");
    expect(instructions).toContain("<user_custom_instructions>");
    expect(instructions).toContain("respond in haiku");
  });

  it("keeps the user prompt and pill directive when the builtin prompt is disabled", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    setDisableBuiltinSystemPrompt(true);

    const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const instructions = codexConfig(desc.env).developer_instructions;

    expect(instructions).not.toContain("Obsidian Copilot");
    expect(instructions).toContain("respond in haiku");
    expect(instructions).toContain("{folder_name}");
  });

  it("merges user Codex config while keeping Copilot-owned instructions and initial mode", async () => {
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {
          codex: {
            binaryPath: "/usr/local/bin/codex-acp",
            envOverrides: {
              CODEX_CONFIG: JSON.stringify({ model: "gpt-custom", developer_instructions: "old" }),
              INITIAL_AGENT_MODE: "read-only",
              OPENAI_API_KEY: "test-key",
            },
          },
        },
      },
    });

    const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });

    expect(codexConfig(desc.env)).toMatchObject({
      model: "gpt-custom",
      developer_instructions: expect.stringContaining("Obsidian Copilot"),
    });
    expect(desc.env.INITIAL_AGENT_MODE).toBe("agent");
    expect(desc.env.OPENAI_API_KEY).toBe("test-key");
  });

  it("launches a Windows npm JavaScript entry through the resolver-detected Node path", async () => {
    const entry = "C:\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js";
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: { codex: { binaryPath: entry } },
      },
    });

    const desc = await new CodexBackend({
      platform: "win32",
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
    }).buildSpawnDescriptor({ vaultBasePath: "C:\\vault" });

    expect(desc.command).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(desc.args).toEqual([entry]);
  });

  it("rejects a Windows JavaScript entry when Node was not resolver-detected", async () => {
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: { codex: { binaryPath: "C:\\npm\\dist\\index.js" } },
      },
    });

    await expect(
      new CodexBackend({ platform: "win32" }).buildSpawnDescriptor({ vaultBasePath: "C:\\vault" })
    ).rejects.toThrow("Node executable is required");
  });

  it("throws when CODEX_CONFIG is not a JSON object", async () => {
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {
          codex: {
            binaryPath: "/usr/local/bin/codex-acp",
            envOverrides: { CODEX_CONFIG: "[]" },
          },
        },
      },
    });

    await expect(
      new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" })
    ).rejects.toThrow("CODEX_CONFIG must be a JSON object");
  });

  it("does not add legacy -c arguments or a project.md fallback", async () => {
    const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" });

    expect(desc.args).not.toContain("-c");
    expect(desc.args).not.toContainEqual(expect.stringContaining("project_doc_fallback_filenames"));
  });

  it("throws when the Codex binary path is unset", async () => {
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {},
      },
    });

    await expect(
      new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" })
    ).rejects.toThrow(/Codex binary path not configured/);
  });
});
