import { ChatModelProviders, DEFAULT_MAX_OUTPUT_TOKENS, ModelCapability } from "@/constants";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

import {
  configuredModelToCustomModel,
  mapProviderTypeToChatModelProvider,
} from "./configuredModelToCustomModel";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "P",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

function configuredModel(overrides: Partial<ConfiguredModel> = {}): ConfiguredModel {
  return {
    configuredModelId: "cm1",
    providerId: "p1",
    info: { id: "gpt-5", displayName: "GPT-5" },
    configuredAt: 0,
    ...overrides,
  };
}

describe("mapProviderTypeToChatModelProvider", () => {
  it("maps the dedicated providerTypes directly", () => {
    expect(mapProviderTypeToChatModelProvider(provider({ providerType: "anthropic" }))).toBe(
      ChatModelProviders.ANTHROPIC
    );
    expect(mapProviderTypeToChatModelProvider(provider({ providerType: "google" }))).toBe(
      ChatModelProviders.GOOGLE
    );
    expect(mapProviderTypeToChatModelProvider(provider({ providerType: "azure" }))).toBe(
      ChatModelProviders.AZURE_OPENAI
    );
  });

  it("refines openai-compatible via the BYOK catalog provider id", () => {
    const cases: Array<[string, ChatModelProviders]> = [
      ["openai", ChatModelProviders.OPENAI],
      ["groq", ChatModelProviders.GROQ],
      ["mistral", ChatModelProviders.MISTRAL],
      ["openrouter", ChatModelProviders.OPENROUTERAI],
      ["deepseek", ChatModelProviders.DEEPSEEK],
      ["xai", ChatModelProviders.XAI],
      ["cohere", ChatModelProviders.COHEREAI],
      ["siliconflow", ChatModelProviders.SILICONFLOW],
    ];
    for (const [catalogProviderId, expected] of cases) {
      expect(
        mapProviderTypeToChatModelProvider(
          provider({ origin: { kind: "byok", catalogProviderId } })
        )
      ).toBe(expected);
    }
  });

  it("falls back to OPENAI_FORMAT for unknown / catalog-less openai-compatible providers", () => {
    // Together / Fireworks / arbitrary proxies, and the Ollama / LM Studio
    // built-in templates (no catalogProviderId, /v1 base URL) all route here.
    expect(
      mapProviderTypeToChatModelProvider(
        provider({ origin: { kind: "byok", catalogProviderId: "together" } })
      )
    ).toBe(ChatModelProviders.OPENAI_FORMAT);
    expect(
      mapProviderTypeToChatModelProvider(
        provider({ baseUrl: "http://localhost:11434/v1", origin: { kind: "byok" } })
      )
    ).toBe(ChatModelProviders.OPENAI_FORMAT);
  });

  it("maps Copilot Plus providers to the dedicated Plus constructor", () => {
    expect(
      mapProviderTypeToChatModelProvider(
        provider({ origin: { kind: "copilot-plus" }, requiresApiKey: false })
      )
    ).toBe(ChatModelProviders.COPILOT_PLUS);
  });

  it("routes custom xAI endpoints through the OpenAI-format constructor", () => {
    expect(
      mapProviderTypeToChatModelProvider(
        provider({
          baseUrl: "https://proxy.example.com/v1",
          origin: { kind: "byok", catalogProviderId: "xai" },
        })
      )
    ).toBe(ChatModelProviders.OPENAI_FORMAT);
  });
});

describe("configuredModelToCustomModel", () => {
  it("uses the wire id as the model name and the snapshot display name", () => {
    const custom = configuredModelToCustomModel({
      provider: provider({ providerType: "anthropic" }),
      configuredModel: configuredModel({
        info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
      }),
      apiKey: "sk-ant",
    });
    expect(custom.name).toBe("claude-sonnet-4-5");
    expect(custom.displayName).toBe("Claude Sonnet 4.5");
    expect(custom.provider).toBe(ChatModelProviders.ANTHROPIC);
    expect(custom.apiKey).toBe("sk-ant");
    expect(custom.enabled).toBe(true);
    expect(custom.configuredModelId).toBe("cm1");
  });

  it("caps an Anthropic model's published ceiling rather than passing it through (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", () => {
    const custom = configuredModelToCustomModel({
      provider: provider({ providerType: "anthropic" }),
      configuredModel: configuredModel({
        info: {
          id: "claude-sonnet-4-5",
          displayName: "Claude Sonnet 4.5",
          limits: { context: 200000, output: 64000 },
        },
      }),
      apiKey: "sk-ant",
    });

    expect(custom.maxTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it("sends no output limit to a provider that accepts a request without one (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", () => {
    const openAiCompatible = configuredModelToCustomModel({
      provider: provider({ origin: { kind: "byok", catalogProviderId: "openai" } }),
      configuredModel: configuredModel({
        info: { id: "gpt-5", displayName: "GPT-5", limits: { context: 400000, output: 128000 } },
      }),
      apiKey: "sk",
    });
    const anthropicWithoutLimits = configuredModelToCustomModel({
      provider: provider({ providerType: "anthropic" }),
      configuredModel: configuredModel({ info: { id: "claude-next", displayName: "Claude Next" } }),
      apiKey: "sk-ant",
    });

    expect(openAiCompatible.maxTokens).toBeUndefined();
    // Nothing published a ceiling, so the Anthropic client picks its own.
    expect(anthropicWithoutLimits.maxTokens).toBeUndefined();
  });

  it("passes the resolved key through and carries the provider base URL", () => {
    const custom = configuredModelToCustomModel({
      provider: provider({ baseUrl: "https://api.example.com/v1" }),
      configuredModel: configuredModel(),
      apiKey: "key-123",
    });
    expect(custom.apiKey).toBe("key-123");
    expect(custom.baseUrl).toBe("https://api.example.com/v1");
  });

  it("preserves the provider's explicit Quick Chat CORS choice (https://github.com/logancyang/obsidian-copilot-preview/issues/313)", () => {
    const corsEnabled = configuredModelToCustomModel({
      provider: provider({ baseUrl: "https://work.example.com/v1", enableCors: true }),
      configuredModel: configuredModel(),
      apiKey: "key-123",
    });
    const streaming = configuredModelToCustomModel({
      provider: provider({
        baseUrl: "https://openrouter.ai/api/v1",
        enableCors: false,
        origin: { kind: "byok", catalogProviderId: "openrouter" },
      }),
      configuredModel: configuredModel(),
      apiKey: "key-123",
    });
    expect(corsEnabled.enableCors).toBe(true);
    expect(streaming.enableCors).toBe(false);
  });

  it("carries the runtime auth contract without synthesizing a key (https://github.com/logancyang/obsidian-copilot/issues/2895)", () => {
    const keyless = configuredModelToCustomModel({
      provider: provider({ requiresApiKey: false, baseUrl: "http://localhost:11434/v1" }),
      configuredModel: configuredModel(),
      apiKey: null,
    });
    expect(keyless.apiKey).toBeUndefined();
    expect(keyless.requiresApiKey).toBe(false);

    const requiresKey = configuredModelToCustomModel({
      provider: provider({ requiresApiKey: true }),
      configuredModel: configuredModel(),
      apiKey: null,
    });
    expect(requiresKey.apiKey).toBeUndefined();
    expect(requiresKey.requiresApiKey).toBe(true);

    const missingStoredKey = configuredModelToCustomModel({
      provider: provider({ requiresApiKey: false, apiKeyKeychainId: "keychain-p1" }),
      configuredModel: configuredModel(),
      apiKey: null,
    });
    expect(missingStoredKey.requiresApiKey).toBe(true);
  });

  it("does not substitute a placeholder key for Copilot Plus", () => {
    const custom = configuredModelToCustomModel({
      provider: provider({ origin: { kind: "copilot-plus" }, requiresApiKey: false }),
      configuredModel: configuredModel(),
      apiKey: null,
    });
    expect(custom.apiKey).toBeUndefined();
    expect(custom.requiresApiKey).toBe(true);
  });

  it("derives capabilities from the model snapshot", () => {
    const custom = configuredModelToCustomModel({
      provider: provider({ providerType: "anthropic" }),
      configuredModel: configuredModel({
        info: {
          id: "claude-sonnet-4-5",
          displayName: "Claude Sonnet 4.5",
          reasoning: true,
          modalities: { input: ["text", "image"] },
        },
      }),
      apiKey: "k",
    });
    expect(custom.capabilities).toEqual([ModelCapability.REASONING, ModelCapability.VISION]);
  });

  it("maps provider extras onto the matching CustomModel fields", () => {
    const azure = configuredModelToCustomModel({
      provider: provider({
        providerType: "azure",
        extras: {
          azureInstanceName: "my-instance",
          azureDeploymentName: "my-deploy",
          azureApiVersion: "2024-05-01-preview",
        },
      }),
      configuredModel: configuredModel(),
      apiKey: "azure-key",
    });
    expect(azure.azureOpenAIApiInstanceName).toBe("my-instance");
    expect(azure.azureOpenAIApiDeploymentName).toBe("my-deploy");
    expect(azure.azureOpenAIApiVersion).toBe("2024-05-01-preview");

    const openai = configuredModelToCustomModel({
      provider: provider({
        origin: { kind: "byok", catalogProviderId: "openai" },
        extras: { openAIOrgId: "org-1" },
      }),
      configuredModel: configuredModel(),
      apiKey: "sk",
    });
    expect(openai.openAIOrgId).toBe("org-1");
  });
});
