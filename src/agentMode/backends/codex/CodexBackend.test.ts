import { resetSettings, setSettings } from "@/settings/model";
import {
  setDefaultSystemPromptTitle,
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import { SYMPOSIUM_WORKSPACE_ROOT_ENV } from "@/symposium/constants";
import * as fs from "node:fs";
import { CodexBackend } from "./CodexBackend";
import { probeCodexAcpCompatibility } from "./codexCompatibility";

jest.mock("node:fs", () => {
  const actual = jest.requireActual("node:fs");
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("./codexCompatibility", () => {
  const actual = jest.requireActual("./codexCompatibility");
  return {
    ...actual,
    probeCodexAcpCompatibility: jest.fn(() => Promise.resolve({ kind: "ready", source: "custom" })),
  };
});

const mockProbeCodexAcpCompatibility = probeCodexAcpCompatibility as jest.MockedFunction<
  typeof probeCodexAcpCompatibility
>;

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

describe("CodexBackend.buildSpawnDescriptor", () => {
  beforeEach(() => {
    mockProbeCodexAcpCompatibility.mockResolvedValue({ kind: "ready", source: "custom" });
    resetSettings();
    resetPromptState();
    setSettings({
      agentMode: {
        byok: {},
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

  it("forwards the Copilot prompt through the maintained adapter config", async () => {
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.command).toBe("/usr/local/bin/codex-acp");
    expect(desc.env[SYMPOSIUM_WORKSPACE_ROOT_ENV]).toBe("/vault");

    const config = JSON.parse(desc.env.CODEX_CONFIG as string);
    expect(config.developer_instructions).toContain("Obsidian Copilot");
    expect(config.developer_instructions).toContain(
      "NOT a software-engineering agent or CLI coding tool"
    );
    expect(config.developer_instructions).toContain("{folder_name}");
    expect(config.developer_instructions).toContain("{activeNote}");
    expect(config.developer_instructions).not.toContain("metadata.copilot-enabled-agents");
    expect(config.developer_instructions).not.toContain("copilot/skills/<name>/SKILL.md");

    expect(desc.args).toEqual([]);
  });

  it("rejects an adapter replaced in place before creating a fresh spawn descriptor", async () => {
    mockProbeCodexAcpCompatibility.mockResolvedValueOnce({
      kind: "error",
      message: "Install the maintained adapter.",
    });

    await expect(
      new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "/vault" })
    ).rejects.toThrow("Install the maintained adapter.");
    expect(mockProbeCodexAcpCompatibility).toHaveBeenCalledWith(
      "/usr/local/bin/codex-acp",
      undefined,
      process.platform,
      expect.objectContaining({ PATH: expect.any(String) })
    );
  });

  it("runs the maintained Windows npm adapter through Node without a shell", async () => {
    const originalPlatform = process.platform;
    const actualReadFileSync = jest.requireActual("node:fs").readFileSync;
    const binaryPath = "C:\\Users\\me\\AppData\\Roaming\\npm\\codex-acp.cmd";
    Object.defineProperty(process, "platform", { value: "win32" });
    (fs.readFileSync as jest.Mock).mockImplementation((filePath, encoding) =>
      filePath === binaryPath
        ? '"%_prog%" "%dp0%\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js" %*'
        : actualReadFileSync(filePath, encoding)
    );
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
            binaryPath,
            envOverrides: { Path: "D:\\portable-node\\bin" },
          },
        },
      },
    });

    try {
      const desc = await new CodexBackend().buildSpawnDescriptor({ vaultBasePath: "C:\\vault" });

      expect(desc.command).toBe("node");
      expect(desc.args[0]).toBe(
        "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js"
      );
      expect(Object.keys(desc.env).filter((key) => key.toLowerCase() === "path")).toEqual(["PATH"]);
      expect(desc.env.PATH).toBe("D:\\portable-node\\bin");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      (fs.readFileSync as jest.Mock).mockImplementation(actualReadFileSync);
    }
  });

  it("appends the user's selected custom prompt to developer_instructions", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const value = JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions;
    expect(value).toContain("Obsidian Copilot");
    expect(value).toContain("<user_custom_instructions>");
    expect(value).toContain("respond in haiku");
  });

  it("suppresses the base prompt when 'disable builtin' is on, keeping the user prompt + pill directive", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    setDisableBuiltinSystemPrompt(true);
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    const value = JSON.parse(desc.env.CODEX_CONFIG as string).developer_instructions;
    expect(value).not.toContain("Obsidian Copilot");
    expect(value).toContain("respond in haiku");
    // Pill directive is functional wiring, not builtin framing — always sent.
    expect(value).toContain("{folder_name}");
  });

  it("does not template a skills folder into developer_instructions", async () => {
    setSettings({
      agentMode: {
        byok: {},
        activeBackend: "codex",
        debugFullFrames: false,
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

  it("pins approval_policy and sandbox_mode in the maintained adapter config", async () => {
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
    // Session-start ensureAgentsMirror supersedes the spawn-level fallback for project scopes;
    // omitting it also prevents a GLOBAL session from treating a vault-root project.md note as
    // codex instructions (the spawn descriptor has no scope to gate on).
    const backend = new CodexBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault" });
    expect(desc.args).not.toContainEqual(expect.stringContaining("project_doc_fallback_filenames"));
  });

  it("throws when the codex binary path is unset", async () => {
    setSettings({
      agentMode: {
        byok: {},
        activeBackend: "codex",
        debugFullFrames: false,
        welcomeDismissed: false,
        skills: { folder: "copilot/skills" },
        backends: {},
      },
    });
    const backend = new CodexBackend();
    await expect(backend.buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
      /Codex binary path not configured/
    );
  });
});
