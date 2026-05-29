import { ChatModelProviders } from "@/constants";
import { getSettings, resetSettings, setSettings, updateSetting } from "@/settings/model";
import type {
  BackendConfigRegistry,
  ConfiguredModel,
  EnabledBackendEntry,
  Provider,
  ProviderOrigin,
  ProviderRegistry,
  ProviderType,
} from "@/modelManagement";
import type { Skill } from "@/agentMode/skills";
import {
  setDefaultSystemPromptTitle,
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import {
  buildOpencodeConfig,
  OPENCODE_PROVIDER_MAP,
  OpencodeBackend,
  type OpencodeModelDeps,
} from "./OpencodeBackend";
import { COPILOT_PROMPT_BASE } from "@/agentMode/backends/shared/agentSystemPrompt";

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
    location: { kind: "canonical" },
  };
}

function seedSkills(skills: Skill[]): void {
  mockSkills = skills;
  mockSkillManagerReady = skills.length > 0;
}

// ---------------------------------------------------------------------------
// Registry mocks — `buildOpencodeConfig` only calls
// `backendConfigRegistry.resolveEnabled("opencode")` and
// `providerRegistry.getApiKey(providerId)`.
// ---------------------------------------------------------------------------

function makeProvider(
  providerId: string,
  origin: ProviderOrigin,
  overrides: Partial<Pick<Provider, "providerType" | "baseUrl" | "displayName">> = {}
): Provider {
  return {
    providerId,
    providerType: overrides.providerType ?? "anthropic",
    displayName: overrides.displayName ?? providerId,
    baseUrl: overrides.baseUrl,
    origin,
    addedAt: 0,
  };
}

/** A self-hosted OpenAI-compatible BYOK provider (Ollama / LM Studio / custom). */
function makeOpenAICompatibleProvider(
  providerId: string,
  baseUrl: string | undefined,
  displayName = providerId
): Provider {
  return makeProvider(
    providerId,
    { kind: "byok" },
    { providerType: "openai-compatible" as ProviderType, baseUrl, displayName }
  );
}

function makeModel(providerId: string, wireId: string): ConfiguredModel {
  return {
    configuredModelId: `cm-${providerId}-${wireId}`,
    providerId,
    info: { id: wireId, displayName: wireId },
    configuredAt: 0,
  };
}

/** Build an `EnabledBackendEntry` in the `"ok"` state. */
function okEntry(provider: Provider, model: ConfiguredModel): EnabledBackendEntry {
  return {
    configuredModelId: model.configuredModelId,
    state: "ok",
    configuredModel: model,
    provider,
  };
}

/**
 * Construct the registry deps `buildOpencodeConfig` needs from a seeded list
 * of resolved entries and a key map keyed by `providerId`.
 */
function makeDeps(args: {
  resolved: EnabledBackendEntry[];
  keys?: Record<string, string | null>;
}): OpencodeModelDeps {
  const keys = args.keys ?? {};
  return {
    backendConfigRegistry: {
      resolveEnabled: (backend: string) => (backend === "opencode" ? args.resolved : []),
    } as unknown as BackendConfigRegistry,
    providerRegistry: {
      getApiKey: async (providerId: string) => keys[providerId] ?? null,
    } as unknown as ProviderRegistry,
  };
}

const NO_MODELS_DEPS = makeDeps({ resolved: [] });

describe("buildOpencodeConfig — provider/model injection", () => {
  beforeEach(() => {
    resetSettings();
    seedSkills([]);
    resetPromptState();
  });

  it("registers a BYOK provider with its keychain key and injects the model", async () => {
    const provider = makeProvider("p-anthropic", {
      kind: "byok",
      catalogProviderId: "anthropic",
    });
    const model = makeModel("p-anthropic", "claude-sonnet-4-6");
    const deps = makeDeps({
      resolved: [okEntry(provider, model)],
      keys: { "p-anthropic": "anth-123" },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, { options?: { apiKey?: string }; models?: Record<string, unknown> }>;
    };
    expect(cfg.provider.anthropic.options).toEqual({ apiKey: "anth-123" });
    expect(cfg.provider.anthropic.models).toEqual({ "claude-sonnet-4-6": {} });
  });

  it("injects multiple models under the same provider", async () => {
    const provider = makeProvider("p-anthropic", {
      kind: "byok",
      catalogProviderId: "anthropic",
    });
    const deps = makeDeps({
      resolved: [
        okEntry(provider, makeModel("p-anthropic", "claude-sonnet-4-6")),
        okEntry(provider, makeModel("p-anthropic", "claude-haiku")),
      ],
      keys: { "p-anthropic": "anth-123" },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, { models?: Record<string, unknown> }>;
    };
    expect(cfg.provider.anthropic.models).toEqual({
      "claude-sonnet-4-6": {},
      "claude-haiku": {},
    });
  });

  it("registers two distinct providers", async () => {
    const anthropic = makeProvider("p-anthropic", {
      kind: "byok",
      catalogProviderId: "anthropic",
    });
    const openai = makeProvider("p-openai", { kind: "byok", catalogProviderId: "openai" });
    const deps = makeDeps({
      resolved: [
        okEntry(anthropic, makeModel("p-anthropic", "claude-sonnet-4-6")),
        okEntry(openai, makeModel("p-openai", "gpt-5")),
      ],
      keys: { "p-anthropic": "anth-123", "p-openai": "oai-456" },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, { options?: { apiKey?: string }; models?: Record<string, unknown> }>;
    };
    expect(Object.keys(cfg.provider).sort()).toEqual(["anthropic", "openai"]);
    expect(cfg.provider.openai.options).toEqual({ apiKey: "oai-456" });
    expect(cfg.provider.openai.models).toEqual({ "gpt-5": {} });
  });

  it("skips a model when the provider has no key in the keychain", async () => {
    const provider = makeProvider("p-openai", { kind: "byok", catalogProviderId: "openai" });
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-openai", "gpt-5"))],
      keys: { "p-openai": null },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, unknown>;
    };
    expect(cfg.provider).toEqual({});
  });

  it("returns an empty provider map when no models are enabled", async () => {
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      provider: Record<string, unknown>;
    };
    expect(cfg.provider).toEqual({});
  });

  it("ignores broken resolved entries", async () => {
    const deps = makeDeps({
      resolved: [{ configuredModelId: "gone", state: "broken" }],
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, unknown>;
    };
    expect(cfg.provider).toEqual({});
  });

  it("does not inject native (agent-origin) providers — opencode hosts them", async () => {
    const provider = makeProvider("opencode-provider", {
      kind: "agent",
      agentType: "opencode",
    });
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("opencode-provider", "opencode/big-pickle"))],
      keys: { "opencode-provider": "should-not-be-read" },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, unknown>;
    };
    expect(cfg.provider).toEqual({});
  });

  it("skips unroutable providers (BYOK without a catalog id, e.g. azure/bedrock)", async () => {
    const provider = makeProvider("p-azure", { kind: "byok" }, { providerType: "azure" });
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-azure", "my-azure-deploy"))],
      keys: { "p-azure": "azure-key" },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, unknown>;
    };
    expect(cfg.provider).toEqual({});
  });

  it("registers a key-less OpenAI-compatible BYOK provider (Ollama) under its providerId", async () => {
    const provider = makeOpenAICompatibleProvider(
      "p-ollama",
      "http://localhost:11434/v1",
      "Ollama"
    );
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-ollama", "llama3.2"))],
      keys: { "p-ollama": null },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
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
    const entry = cfg.provider["p-ollama"];
    expect(entry.npm).toBe("@ai-sdk/openai-compatible");
    expect(entry.name).toBe("Ollama");
    expect(entry.options?.baseURL).toBe("http://localhost:11434/v1");
    // Key-less: apiKey must be absent, not an empty string.
    expect(entry.options?.apiKey).toBeUndefined();
    expect(entry.models).toEqual({ "llama3.2": {} });
  });

  it("includes apiKey for an OpenAI-compatible BYOK provider that has one", async () => {
    const provider = makeOpenAICompatibleProvider("p-custom", "https://my-endpoint/v1", "Custom");
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-custom", "gpt-5.5"))],
      keys: { "p-custom": "secret-key" },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, { options?: { apiKey?: string } }>;
    };
    expect(cfg.provider["p-custom"].options?.apiKey).toBe("secret-key");
  });

  it("skips an OpenAI-compatible BYOK provider with no baseUrl", async () => {
    const provider = makeOpenAICompatibleProvider("p-nobase", undefined);
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-nobase", "some-model"))],
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, unknown>;
    };
    expect(cfg.provider).toEqual({});
  });

  it("drops a key-less OpenAI-compatible BYOK provider on a public host", async () => {
    // Key tolerance keys off the baseUrl host, not catalog membership: a public
    // endpoint with no key is dropped (its template requires one).
    const provider = makeOpenAICompatibleProvider("p-public", "https://my-proxy.example.com/v1");
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-public", "gpt-5.5"))],
      keys: { "p-public": null },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, unknown>;
    };
    expect(cfg.provider).toEqual({});
  });

  it("keeps a key-less self-hosted provider even when it carries a catalog id", async () => {
    // Guards the catalog-growth scenario: if a local runner like Ollama ever
    // gains a models.dev entry, its localhost baseUrl still tolerates a missing
    // key, so it must not be dropped.
    const provider = makeProvider(
      "p-ollama-catalog",
      { kind: "byok", catalogProviderId: "ollama" },
      { providerType: "openai-compatible", baseUrl: "http://localhost:11434/v1" }
    );
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-ollama-catalog", "llama3.2"))],
      keys: { "p-ollama-catalog": null },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, { models?: Record<string, unknown> }>;
    };
    expect(cfg.provider.ollama?.models).toEqual({ "llama3.2": {} });
  });

  it("omits apiKey entirely when a catalog self-hosted provider has an empty-string keychain entry", async () => {
    // Regression: `apiKey ?? undefined` would preserve `""` and leak
    // `Authorization: Bearer ` downstream — assert the field is absent.
    const provider = makeProvider(
      "p-ollama-catalog",
      { kind: "byok", catalogProviderId: "ollama" },
      { providerType: "openai-compatible", baseUrl: "http://localhost:11434/v1" }
    );
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-ollama-catalog", "llama3.2"))],
      keys: { "p-ollama-catalog": "" },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, { options?: Record<string, unknown> }>;
    };
    const opts = cfg.provider.ollama?.options ?? {};
    expect(opts).not.toHaveProperty("apiKey");
  });

  it("passes a baseUrl override through for a catalog provider (no npm — opencode resolves the SDK natively)", async () => {
    // A catalog provider keeps native resolution (no npm), but when the user
    // overrides its baseUrl we must forward it so opencode routes to the proxy
    // instead of the registry default — matching the chat backend's behavior.
    const provider = makeProvider(
      "p-openai",
      { kind: "byok", catalogProviderId: "openai" },
      { providerType: "openai-compatible", baseUrl: "https://my-proxy.example.com/v1" }
    );
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-openai", "gpt-5"))],
      keys: { "p-openai": "oai-456" },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
      provider: Record<string, { npm?: string; options?: { baseURL?: string; apiKey?: string } }>;
    };
    const entry = cfg.provider.openai;
    expect(entry.npm).toBeUndefined();
    expect(entry.options).toEqual({
      apiKey: "oai-456",
      baseURL: "https://my-proxy.example.com/v1",
    });
  });

  it("registers Copilot Plus as a custom openai-compatible provider from its own fields", async () => {
    // Plus has no catalog identity, so it's registered like a custom endpoint —
    // npm/name/baseURL all read off the provider row (seeded by CopilotPlusSetupApi).
    const provider = makeProvider(
      "p-plus",
      { kind: "copilot-plus" },
      {
        providerType: "openai-compatible",
        displayName: "Copilot Plus",
        baseUrl: "https://models.brevilabs.com/v1",
      }
    );
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-plus", "copilot-plus-flash"))],
      keys: { "p-plus": "plus-token-123" },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), deps)) as {
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
});

describe("buildOpencodeConfig — agent/prompt/mode/skills blocks (preserved)", () => {
  beforeEach(() => {
    resetSettings();
    seedSkills([]);
    resetPromptState();
  });

  it("sets top-level model from the persisted defaultModel.baseModelId", async () => {
    setSettings({
      agentMode: {
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
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as { model?: string };
    expect(cfg.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("appends effort suffix when defaultModel.effort is set", async () => {
    setSettings({
      agentMode: {
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
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as { model?: string };
    expect(cfg.model).toBe("anthropic/claude-sonnet-4-6/high");
  });

  it("omits cfg.model when no defaultModel is set", async () => {
    setSettings({
      agentMode: {
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
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as { model?: string };
    expect(cfg.model).toBeUndefined();
  });

  it("always spawns with canonical default agent (copilot-build)", async () => {
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      default_agent?: string;
    };
    expect(cfg.default_agent).toBe("copilot-build");
  });

  it("overrides system prompt on both build and copilot-build agents", async () => {
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      agent: Record<string, { prompt?: string; permission?: unknown; mode?: string }>;
    };
    expect(cfg.agent["copilot-build"].prompt?.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
    expect(cfg.agent.build.prompt?.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
    expect(cfg.agent["copilot-build"].prompt).toContain("{folder_name}");
    expect(cfg.agent["copilot-build"].prompt).toContain("{activeNote}");
    expect(cfg.agent.build.prompt).toContain("{folder_name}");
    // The prompt carries only the pill-syntax directive. Skill discovery is
    // automatic from `.opencode/skills/`, so the prompt never templates in
    // SKILL.md authoring instructions.
    expect(cfg.agent["copilot-build"].prompt).not.toContain("metadata.copilot-enabled-agents");
    expect(cfg.agent.build.prompt).not.toContain("metadata.copilot-enabled-agents");
    // Regression guard: the copilot-build permission block must survive
    // alongside the new prompt field — opencode's field-wise merge depends
    // on us not stomping native fields.
    expect(cfg.agent["copilot-build"].permission).toEqual({ bash: "ask", edit: "ask" });
    expect(cfg.agent["copilot-build"].mode).toBe("primary");
  });

  it("appends the user's selected custom prompt to both agent prompts", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      agent: Record<string, { prompt?: string }>;
    };
    for (const id of ["copilot-build", "build"]) {
      expect(cfg.agent[id].prompt?.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
      expect(cfg.agent[id].prompt).toContain(
        "<user_custom_instructions>\nrespond in haiku\n</user_custom_instructions>"
      );
    }
  });

  it("suppresses the base prompt when 'disable builtin' is on, keeping the user prompt + pill directive", async () => {
    updateCachedSystemPrompts([makeSystemPrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    setDisableBuiltinSystemPrompt(true);
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      agent: Record<string, { prompt?: string }>;
    };
    for (const id of ["copilot-build", "build"]) {
      expect(cfg.agent[id].prompt).not.toContain(COPILOT_PROMPT_BASE);
      expect(cfg.agent[id].prompt).not.toContain("You are Obsidian Copilot");
      expect(cfg.agent[id].prompt).toContain("respond in haiku");
      // Pill directive is functional wiring, not builtin framing — always sent.
      expect(cfg.agent[id].prompt).toContain("{folder_name}");
    }
  });

  it("does not template a skills folder into the opencode prompts", async () => {
    setSettings({
      agentMode: {
        byok: {},
        mcpServers: [],
        activeBackend: "opencode",
        debugFullFrames: false,
        skills: { folder: "team-skills" },
        backends: {},
      },
    });
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      agent: Record<string, { prompt?: string }>;
    };
    // The pill directive doesn't reference the skills folder at all.
    expect(cfg.agent["copilot-build"].prompt).not.toContain("team-skills");
    expect(cfg.agent.build.prompt).not.toContain("team-skills");
  });

  it("denies a skill enabled for Claude only (cross-discovered, not enabled for opencode)", async () => {
    seedSkills([makeSkill("foo", ["claude"])]);
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      permission?: { skill?: Record<string, string> };
    };
    expect(cfg.permission?.skill?.foo).toBe("deny");
  });

  it("does not deny a skill enabled for both Claude and OpenCode", async () => {
    seedSkills([makeSkill("foo", ["claude", "opencode"])]);
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      permission?: { skill?: Record<string, string> };
    };
    expect(cfg.permission?.skill?.foo).toBeUndefined();
  });

  it("does not emit a permission.skill block when no skills need denying", async () => {
    seedSkills([makeSkill("foo", ["opencode"])]);
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      permission?: { skill?: Record<string, string> };
    };
    expect(cfg.permission).toBeUndefined();
  });

  it("does not emit a permission.skill block when there are no skills at all", async () => {
    seedSkills([]);
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      permission?: unknown;
    };
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
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      permission?: { skill?: Record<string, string> };
    };
    // a is claude-only → denied. e is codex-only → denied (codex also
    // populates the cross-discovered `.agents/skills/` path). b/c/d not denied.
    expect(cfg.permission?.skill).toEqual({ a: "deny", e: "deny" });
  });

  it("skips deny synthesis when SkillManager has not initialised yet", async () => {
    mockSkills = [makeSkill("foo", ["claude"])];
    mockSkillManagerReady = false;
    const cfg = (await buildOpencodeConfig(getSettings(), NO_MODELS_DEPS)) as {
      permission?: unknown;
    };
    expect(cfg.permission).toBeUndefined();
  });
});

describe("OpencodeBackend.buildSpawnDescriptor", () => {
  beforeEach(() => {
    resetSettings();
    seedSkills([]);
    resetPromptState();
  });

  it("throws if no binary is installed", async () => {
    const backend = new OpencodeBackend(NO_MODELS_DEPS);
    await expect(backend.buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
      /binary not installed/
    );
  });

  it("uses agentMode.backends.opencode.binaryPath as command and passes cwd in args, injecting enabled models", async () => {
    updateSetting("agentMode", {
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
    const provider = makeProvider("p-anthropic", {
      kind: "byok",
      catalogProviderId: "anthropic",
    });
    const deps = makeDeps({
      resolved: [okEntry(provider, makeModel("p-anthropic", "claude-sonnet-4-6"))],
      keys: { "p-anthropic": "anth-xyz" },
    });
    const backend = new OpencodeBackend(deps);
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
    expect(desc.command).toBe("/path/to/opencode");
    expect(desc.args).toEqual(["acp", "--cwd", "/vault/abs"]);
    expect(desc.env.OPENCODE_CONFIG_CONTENT).toBeDefined();
    const cfg = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);
    expect(cfg.provider.anthropic.options).toEqual({ apiKey: "anth-xyz" });
    expect(cfg.provider.anthropic.models).toEqual({ "claude-sonnet-4-6": {} });
  });
});

// `COPILOT_PROMPT_BASE` and the full `buildAgentSystemPrompt` composition are
// unit-tested in `backends/shared/agentSystemPrompt.test.ts`. The opencode tests
// above only assert that the composed prompt reaches `cfg.agent.<id>.prompt`.

describe("OPENCODE_PROVIDER_MAP", () => {
  it("maps the BYOK provider ids plus Copilot Plus to opencode provider ids", () => {
    expect(OPENCODE_PROVIDER_MAP[ChatModelProviders.ANTHROPIC]).toBe("anthropic");
    expect(OPENCODE_PROVIDER_MAP[ChatModelProviders.OPENAI]).toBe("openai");
    expect(OPENCODE_PROVIDER_MAP[ChatModelProviders.OPENROUTERAI]).toBe("openrouter");
    expect(OPENCODE_PROVIDER_MAP[ChatModelProviders.COPILOT_PLUS]).toBe("copilot-plus");
  });
});
