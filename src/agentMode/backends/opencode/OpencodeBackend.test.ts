import { ChatModelProviders } from "@/constants";
import { resetSettings, setSettings, updateSetting } from "@/settings/model";
import {
  buildOpencodeConfig,
  copilotModelToOpencodeId,
  OPENCODE_PROVIDER_MAP,
  OpencodeBackend,
} from "./OpencodeBackend";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

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

  it("sets top-level model when selectedModelKey resolves to a routable Copilot model", async () => {
    updateSetting("anthropicApiKey", "anth-123");
    setSettings({
      activeModels: [
        {
          name: "claude-sonnet-4-6",
          provider: ChatModelProviders.ANTHROPIC,
          enabled: true,
        },
      ],
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "opencode",
        debugFullFrames: false,
        backends: {
          opencode: {
            binaryPath: "/x",
            selectedModelKey: "claude-sonnet-4-6|anthropic",
          },
        },
      },
    });
    const cfg = (await buildOpencodeConfig()) as { model?: string };
    expect(cfg.model).toBe("anthropic/claude-sonnet-4-6");
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

  it("translates a Copilot Plus model selection into copilot-plus/<name>", async () => {
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
        backends: {
          opencode: {
            binaryPath: "/x",
            selectedModelKey: "copilot-plus-flash|copilot-plus",
          },
        },
      },
    });
    const cfg = (await buildOpencodeConfig()) as { model?: string };
    expect(cfg.model).toBe("copilot-plus/copilot-plus-flash");
  });

  it("ignores stale selectedModelKey that doesn't resolve to an active model", async () => {
    updateSetting("anthropicApiKey", "anth-123");
    setSettings({
      activeModels: [],
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: "opencode",
        debugFullFrames: false,
        backends: {
          opencode: {
            binaryPath: "/x",
            selectedModelKey: "vanished-model|anthropic",
          },
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

describe("copilotModelToOpencodeId", () => {
  it("formats supported providers as <providerId>/<modelName>", () => {
    expect(
      copilotModelToOpencodeId({
        name: "claude-sonnet-4-6",
        provider: ChatModelProviders.ANTHROPIC,
        enabled: true,
      })
    ).toBe("anthropic/claude-sonnet-4-6");

    expect(
      copilotModelToOpencodeId({
        name: "mistral-large",
        provider: ChatModelProviders.MISTRAL,
        enabled: true,
      })
    ).toBe("mistral/mistral-large");
  });

  it("returns undefined for unsupported providers", () => {
    expect(
      copilotModelToOpencodeId({
        name: "claude-via-bedrock",
        provider: ChatModelProviders.AMAZON_BEDROCK,
        enabled: true,
      })
    ).toBeUndefined();
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
