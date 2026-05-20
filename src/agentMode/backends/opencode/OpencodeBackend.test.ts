import { ChatModelProviders } from "@/constants";
import { resetSettings, setSettings, updateSetting } from "@/settings/model";
import type { Skill } from "@/agentMode/skills";
import { buildOpencodeConfig, OPENCODE_PROVIDER_MAP, OpencodeBackend } from "./OpencodeBackend";
import { COPILOT_PROMPT_BASE, selectCopilotPrompt } from "./prompts";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// Mock the skills package so we can drive the deny-list synthesis path
// without booting the real jotai store / Obsidian App singleton.
let mockSkills: Skill[] = [];
let mockSkillManagerReady = false;

jest.mock("@/agentMode/skills", () => {
  const actual = jest.requireActual("@/agentMode/skills");
  return {
    ...actual,
    getManagedSkills: () => mockSkills,
    SkillManager: {
      hasInstance: () => mockSkillManagerReady,
      getInstance: () => {
        if (!mockSkillManagerReady) {
          throw new Error("SkillManager.getInstance called before initialize");
        }
        return { getAgentDirsProjectRel: () => ({}) } as unknown;
      },
    },
  };
});

function makeSkill(name: string, enabledAgents: Skill["enabledAgents"]): Skill {
  return {
    name,
    description: `${name} skill`,
    filePath: `/x/${name}/SKILL.md`,
    dirPath: `/x/${name}`,
    body: "",
    enabledAgents,
  };
}

function seedSkills(skills: Skill[]): void {
  mockSkills = skills;
  mockSkillManagerReady = skills.length > 0;
}

/**
 * Most tests below disable the built-in `activeModels` so injection is a
 * blank slate. The few that exercise injection set their own active models
 * explicitly.
 */
function clearActiveModels() {
  setSettings({ activeModels: [] });
}

describe("buildOpencodeConfig", () => {
  beforeEach(() => {
    resetSettings();
    clearActiveModels();
    seedSkills([]);
  });

  it("emits provider entries only for non-empty keys", async () => {
    updateSetting("anthropicApiKey", "anth-123");
    updateSetting("openAIApiKey", "");
    updateSetting("googleApiKey", "g-456");
    const cfg = (await buildOpencodeConfig()) as { provider: Record<string, unknown> };
    expect(Object.keys(cfg.provider).sort()).toEqual(["anthropic", "google"]);
    expect(cfg.provider.anthropic).toEqual({ options: { apiKey: "anth-123" } });
    expect(cfg.provider.google).toEqual({ options: { apiKey: "g-456" } });
  });

  it("returns empty provider map when no keys are set", async () => {
    const cfg = (await buildOpencodeConfig()) as { provider: Record<string, unknown> };
    expect(cfg.provider).toEqual({});
  });

  it("injects enabled active models under their provider's `models` map", async () => {
    updateSetting("anthropicApiKey", "anth-123");
    setSettings({
      activeModels: [
        {
          name: "claude-sonnet-4-6",
          provider: ChatModelProviders.ANTHROPIC,
          enabled: true,
        },
        {
          name: "claude-haiku",
          provider: ChatModelProviders.ANTHROPIC,
          enabled: false, // disabled — should NOT inject
        },
      ],
    });
    const cfg = (await buildOpencodeConfig()) as {
      provider: Record<string, { options?: unknown; models?: Record<string, unknown> }>;
    };
    expect(cfg.provider.anthropic.models).toEqual({ "claude-sonnet-4-6": {} });
  });

  it("does not inject a model when neither top-level nor per-model key is available", async () => {
    setSettings({
      activeModels: [
        {
          name: "gpt-5",
          provider: ChatModelProviders.OPENAI,
          enabled: true,
        },
      ],
    });
    // Neither openAIApiKey nor model.apiKey configured
    const cfg = (await buildOpencodeConfig()) as { provider: Record<string, unknown> };
    expect(cfg.provider).toEqual({});
  });

  it("falls back to per-model apiKey when top-level provider key is missing", async () => {
    setSettings({
      activeModels: [
        {
          name: "gpt-5",
          provider: ChatModelProviders.OPENAI,
          enabled: true,
          apiKey: "per-model-key",
        },
      ],
    });
    // No openAIApiKey configured globally, but the model carries its own key.
    const cfg = (await buildOpencodeConfig()) as {
      provider: Record<string, { options?: { apiKey?: string }; models?: Record<string, unknown> }>;
    };
    expect(cfg.provider.openai.options).toEqual({ apiKey: "per-model-key" });
    expect(cfg.provider.openai.models).toEqual({ "gpt-5": {} });
  });

  it("prefers the top-level provider key when both are present", async () => {
    updateSetting("openAIApiKey", "global-key");
    setSettings({
      activeModels: [
        {
          name: "gpt-5",
          provider: ChatModelProviders.OPENAI,
          enabled: true,
          apiKey: "per-model-key",
        },
      ],
    });
    const cfg = (await buildOpencodeConfig()) as {
      provider: Record<string, { options?: { apiKey?: string } }>;
    };
    // Top-level wins because the provider entry is built before the
    // per-model fallback runs — keeps the historical behaviour.
    expect(cfg.provider.openai.options).toEqual({ apiKey: "global-key" });
  });

  it("does not inject models for providers OpenCode cannot route", async () => {
    setSettings({
      activeModels: [
        {
          name: "claude-via-bedrock",
          provider: ChatModelProviders.AMAZON_BEDROCK,
          enabled: true,
        },
        {
          name: "llama",
          provider: ChatModelProviders.OLLAMA,
          enabled: true,
        },
      ],
    });
    const cfg = (await buildOpencodeConfig()) as { provider: Record<string, unknown> };
    expect(cfg.provider).toEqual({});
  });

  it("skips embedding models", async () => {
    updateSetting("openAIApiKey", "key");
    setSettings({
      activeModels: [
        {
          name: "text-embedding-3-large",
          provider: ChatModelProviders.OPENAI,
          enabled: true,
          isEmbeddingModel: true,
        },
        {
          name: "gpt-test",
          provider: ChatModelProviders.OPENAI,
          enabled: true,
        },
      ],
    });
    const cfg = (await buildOpencodeConfig()) as {
      provider: Record<string, { models?: Record<string, unknown> }>;
    };
    // gpt-test is injected; the embedding model is not, even though both have
    // the same provider and enabled flag.
    expect(cfg.provider.openai.models).toHaveProperty("gpt-test");
    expect(cfg.provider.openai.models).not.toHaveProperty("text-embedding-3-large");
  });

  it("sets top-level model from the persisted defaultModel.baseModelId", async () => {
    updateSetting("anthropicApiKey", "anth-123");
    setSettings({
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "opencode",
        debugFullFrames: false,
        skills: { folder: "copilot/skills" },
        backends: {
          opencode: {
            binaryPath: "/x",
            defaultModel: { baseModelId: "anthropic/claude-sonnet-4-6", effort: null },
          },
        },
      },
    });
    const cfg = (await buildOpencodeConfig()) as { model?: string };
    expect(cfg.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("appends effort suffix when defaultModel.effort is set", async () => {
    updateSetting("anthropicApiKey", "anth-123");
    setSettings({
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "opencode",
        debugFullFrames: false,
        skills: { folder: "copilot/skills" },
        backends: {
          opencode: {
            binaryPath: "/x",
            defaultModel: { baseModelId: "anthropic/claude-sonnet-4-6", effort: "high" },
          },
        },
      },
    });
    const cfg = (await buildOpencodeConfig()) as { model?: string };
    expect(cfg.model).toBe("anthropic/claude-sonnet-4-6/high");
  });

  it("registers a custom copilot-plus provider when plusLicenseKey is set", async () => {
    updateSetting("plusLicenseKey", "plus-token-123");
    setSettings({
      activeModels: [
        {
          name: "copilot-plus-flash",
          provider: ChatModelProviders.COPILOT_PLUS,
          enabled: true,
        },
      ],
    });
    const cfg = (await buildOpencodeConfig()) as {
      provider: Record<
        string,
        {
          npm?: string;
          name?: string;
          options?: { baseURL?: string; apiKey?: string };
          models?: Record<string, unknown>;
        }
      >;
    };
    const cp = cfg.provider["copilot-plus"];
    expect(cp.npm).toBe("@ai-sdk/openai-compatible");
    expect(cp.name).toBe("Copilot Plus");
    expect(cp.options?.baseURL).toBe("https://models.brevilabs.com/v1");
    expect(cp.options?.apiKey).toBe("plus-token-123");
    expect(cp.models).toEqual({ "copilot-plus-flash": {} });
  });

  it("does not register copilot-plus provider when plusLicenseKey is empty", async () => {
    setSettings({
      activeModels: [
        {
          name: "copilot-plus-flash",
          provider: ChatModelProviders.COPILOT_PLUS,
          enabled: true,
        },
      ],
    });
    const cfg = (await buildOpencodeConfig()) as { provider: Record<string, unknown> };
    expect(cfg.provider["copilot-plus"]).toBeUndefined();
  });

  it("uses a Copilot-Plus-shaped defaultModel.baseModelId verbatim", async () => {
    updateSetting("plusLicenseKey", "plus-token-123");
    setSettings({
      activeModels: [
        {
          name: "copilot-plus-flash",
          provider: ChatModelProviders.COPILOT_PLUS,
          enabled: true,
        },
      ],
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "opencode",
        debugFullFrames: false,
        skills: { folder: "copilot/skills" },
        backends: {
          opencode: {
            binaryPath: "/x",
            defaultModel: { baseModelId: "copilot-plus/copilot-plus-flash", effort: null },
          },
        },
      },
    });
    const cfg = (await buildOpencodeConfig()) as { model?: string };
    expect(cfg.model).toBe("copilot-plus/copilot-plus-flash");
  });

  it("always spawns with canonical default agent (copilot-build)", async () => {
    const cfg = (await buildOpencodeConfig()) as { default_agent?: string };
    expect(cfg.default_agent).toBe("copilot-build");
  });

  it("overrides system prompt on both build and copilot-build agents", async () => {
    const cfg = (await buildOpencodeConfig()) as {
      agent: Record<string, { prompt?: string; permission?: unknown; mode?: string }>;
    };
    // Prompt now starts with the COPILOT_PROMPT_BASE and ends with the
    // spawn-time skill-creation directive (see the Skills Management
    // spec). Assert the base is the prefix so future directive changes
    // don't break this test.
    expect(cfg.agent["copilot-build"].prompt?.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
    expect(cfg.agent.build.prompt?.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
    expect(cfg.agent["copilot-build"].prompt).toContain(
      'metadata.copilot-enabled-agents: "opencode"'
    );
    expect(cfg.agent.build.prompt).toContain('metadata.copilot-enabled-agents: "opencode"');
    // Regression guard: the copilot-build permission block must survive
    // alongside the new prompt field — opencode's field-wise merge depends
    // on us not stomping native fields.
    expect(cfg.agent["copilot-build"].permission).toEqual({ bash: "ask", edit: "ask" });
    expect(cfg.agent["copilot-build"].mode).toBe("primary");
  });

  it("templates a custom skills folder into the opencode directive", async () => {
    setSettings({
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "opencode",
        debugFullFrames: false,
        skills: { folder: "team-skills" },
        backends: {},
      },
    });
    const cfg = (await buildOpencodeConfig()) as {
      agent: Record<string, { prompt?: string }>;
    };
    expect(cfg.agent["copilot-build"].prompt).toContain("<vault>/team-skills/<name>/SKILL.md");
    expect(cfg.agent.build.prompt).toContain("<vault>/team-skills/<name>/SKILL.md");
  });

  it("denies a skill enabled for Claude only (cross-discovered, not enabled for opencode)", async () => {
    seedSkills([makeSkill("foo", ["claude"])]);
    const cfg = (await buildOpencodeConfig()) as {
      permission?: { skill?: Record<string, string> };
    };
    expect(cfg.permission?.skill?.foo).toBe("deny");
  });

  it("does not deny a skill enabled for both Claude and OpenCode", async () => {
    seedSkills([makeSkill("foo", ["claude", "opencode"])]);
    const cfg = (await buildOpencodeConfig()) as {
      permission?: { skill?: Record<string, string> };
    };
    expect(cfg.permission?.skill?.foo).toBeUndefined();
  });

  it("does not emit a permission.skill block when no skills need denying", async () => {
    seedSkills([makeSkill("foo", ["opencode"])]);
    const cfg = (await buildOpencodeConfig()) as {
      permission?: { skill?: Record<string, string> };
    };
    expect(cfg.permission).toBeUndefined();
  });

  it("does not emit a permission.skill block when there are no skills at all", async () => {
    seedSkills([]);
    const cfg = (await buildOpencodeConfig()) as { permission?: unknown };
    expect(cfg.permission).toBeUndefined();
  });

  it("synthesises deny rules for a mix of skills (only cross-discovered + not-enabled wins)", async () => {
    seedSkills([
      makeSkill("a", ["claude"]),
      makeSkill("b", ["claude", "opencode"]),
      makeSkill("c", []),
      makeSkill("d", ["opencode"]),
      makeSkill("e", ["codex"]),
    ]);
    const cfg = (await buildOpencodeConfig()) as {
      permission?: { skill?: Record<string, string> };
    };
    // a is claude-only → denied. e is codex-only → denied (codex also
    // populates the cross-discovered `.agents/skills/` path). b/c/d not denied.
    expect(cfg.permission?.skill).toEqual({ a: "deny", e: "deny" });
  });

  it("skips deny synthesis when SkillManager has not initialised yet", async () => {
    // Place a skill in the snapshot, but mark the singleton as not ready.
    mockSkills = [makeSkill("foo", ["claude"])];
    mockSkillManagerReady = false;
    const cfg = (await buildOpencodeConfig()) as { permission?: unknown };
    expect(cfg.permission).toBeUndefined();
  });

  it("omits cfg.model when no defaultModel is set", async () => {
    updateSetting("anthropicApiKey", "anth-123");
    setSettings({
      activeModels: [],
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "opencode",
        debugFullFrames: false,
        skills: { folder: "copilot/skills" },
        backends: {
          opencode: { binaryPath: "/x" },
        },
      },
    });
    const cfg = (await buildOpencodeConfig()) as { model?: string };
    expect(cfg.model).toBeUndefined();
  });
});

describe("OpencodeBackend.buildSpawnDescriptor", () => {
  beforeEach(() => {
    resetSettings();
    clearActiveModels();
  });

  it("throws if no binary is installed", async () => {
    const backend = new OpencodeBackend();
    await expect(backend.buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
      /binary not installed/
    );
  });

  it("uses agentMode.backends.opencode.binaryPath as command and passes cwd in args", async () => {
    updateSetting("agentMode", {
      enabled: true,
      byok: {},
      mcpServers: [],
      activeBackend: "opencode",
      debugFullFrames: false,
      skills: { folder: "copilot/skills" },
      backends: {
        opencode: {
          binaryPath: "/path/to/opencode",
          binaryVersion: "1.3.17",
          binarySource: "managed",
        },
      },
    });
    updateSetting("anthropicApiKey", "anth-xyz");
    const backend = new OpencodeBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
    expect(desc.command).toBe("/path/to/opencode");
    expect(desc.args).toEqual(["acp", "--cwd", "/vault/abs"]);
    expect(desc.env.OPENCODE_CONFIG_CONTENT).toBeDefined();
    const cfg = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);
    expect(cfg.provider.anthropic.options).toEqual({ apiKey: "anth-xyz" });
  });
});

describe("selectCopilotPrompt", () => {
  it("returns COPILOT_PROMPT_BASE for any model id (no per-provider variants yet)", () => {
    expect(selectCopilotPrompt(undefined)).toBe(COPILOT_PROMPT_BASE);
    expect(selectCopilotPrompt("copilot-plus-flash")).toBe(COPILOT_PROMPT_BASE);
    expect(selectCopilotPrompt("copilot-plus/copilot-plus-flash")).toBe(COPILOT_PROMPT_BASE);
    expect(selectCopilotPrompt("anthropic/claude-sonnet-4-6")).toBe(COPILOT_PROMPT_BASE);
    expect(selectCopilotPrompt("google/gemini-2.5-flash")).toBe(COPILOT_PROMPT_BASE);
  });
});

describe("COPILOT_PROMPT_BASE", () => {
  it("establishes Obsidian Copilot identity, not a CLI/coding agent", () => {
    expect(COPILOT_PROMPT_BASE).toMatch(/Obsidian Copilot/);
    expect(COPILOT_PROMPT_BASE).toMatch(/NOT a software-engineering agent or CLI coding tool/);
  });

  it("does not carry chat-mode-only baggage that misfires in tool-driven agents", () => {
    // @vault and getCurrentTime/getTimeRangeMs are chat-mode injections that
    // do not exist in opencode. YouTube auto-transcription is also chat-only.
    expect(COPILOT_PROMPT_BASE).not.toMatch(/@vault/);
    expect(COPILOT_PROMPT_BASE).not.toMatch(/getCurrentTime/);
    expect(COPILOT_PROMPT_BASE).not.toMatch(/getTimeRangeMs/);
    expect(COPILOT_PROMPT_BASE).not.toMatch(/YouTube/);
  });

  it("ports AGENT_LOOP_GUIDANCE behavior bullets", () => {
    expect(COPILOT_PROMPT_BASE).toMatch(/NEVER search for the same/);
  });
});

describe("OPENCODE_PROVIDER_MAP", () => {
  it("includes the eight BYOK-mapped providers plus Copilot Plus", () => {
    expect(Object.keys(OPENCODE_PROVIDER_MAP).sort()).toEqual(
      [
        ChatModelProviders.ANTHROPIC,
        ChatModelProviders.COPILOT_PLUS,
        ChatModelProviders.DEEPSEEK,
        ChatModelProviders.GOOGLE,
        ChatModelProviders.GROQ,
        ChatModelProviders.MISTRAL,
        ChatModelProviders.OPENAI,
        ChatModelProviders.OPENROUTERAI,
        ChatModelProviders.XAI,
      ].sort()
    );
  });
});
