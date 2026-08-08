import { ChatModelProviders, ModelCapability } from "@/constants";
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
    expect(mapProviderTypeToChatModelProvider(provider({ providerType: "bedrock" }))).toBe(
      ChatModelProviders.AMAZON_BEDROCK
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

  it("passes the resolved key through and carries the provider base URL", () => {
    const custom = configuredModelToCustomModel({
      provider: provider({ baseUrl: "https://api.example.com/v1" }),
      configuredModel: configuredModel(),
      apiKey: "key-123",
    });
    expect(custom.apiKey).toBe("key-123");
    expect(custom.baseUrl).toBe("https://api.example.com/v1");
  });

  it("substitutes a placeholder key only for keyless providers", () => {
    const keyless = configuredModelToCustomModel({
      provider: provider({ requiresApiKey: false, baseUrl: "http://localhost:11434/v1" }),
      configuredModel: configuredModel(),
      apiKey: null,
    });
    expect(keyless.apiKey).toBe("default-key");

    const requiresKey = configuredModelToCustomModel({
      provider: provider({ requiresApiKey: true }),
      configuredModel: configuredModel(),
      apiKey: null,
    });
    expect(requiresKey.apiKey).toBeUndefined();
  });

  it("does not substitute a placeholder key for Copilot Plus", () => {
    const custom = configuredModelToCustomModel({
      provider: provider({ origin: { kind: "copilot-plus" }, requiresApiKey: false }),
      configuredModel: configuredModel(),
      apiKey: null,
    });
    expect(custom.apiKey).toBeUndefined();
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

    const bedrock = configuredModelToCustomModel({
      provider: provider({ providerType: "bedrock", extras: { bedrockRegion: "us-west-2" } }),
      configuredModel: configuredModel(),
      apiKey: "aws-key",
    });
    expect(bedrock.bedrockRegion).toBe("us-west-2");

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
