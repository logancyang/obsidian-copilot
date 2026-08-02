/**
 * Unit tests for the BYOK migration. `planByokMigration` is pure, so the bulk
 * of the coverage builds a legacy settings object and asserts the resulting
 * `SetupProviderInput[]`. `executeByokMigration` is exercised against a fake
 * `ModelManagementApi` (the real enrollment behavior of `setupProvider` is
 * covered by `ByokSetupApi.test.ts`; here we only assert which descriptors flow
 * through and that dedup / per-provider-failure handling hold).
 *
 * All `@/modelManagement` imports are type-only so the model-management barrel
 * (and its UI deps) never loads in this unit test.
 */

import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_SETTINGS } from "@/constants";
import type {
  ModelInfo,
  ModelManagementApi,
  Provider,
  SetupProviderInput,
} from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";

import { executeByokMigration, planByokMigration } from "./byokMigration";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function model(overrides: Partial<CustomModel>): CustomModel {
  return {
    name: "test-model",
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: false,
    ...overrides,
  };
}

function settingsWith(
  models: CustomModel[],
  overrides: Partial<CopilotSettings> = {}
): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides, activeModels: models };
}

const normalizeUrl = (url: string | undefined) =>
  (url ?? "").trim().replace(/\/+$/, "").toLowerCase();

const byCatalog = (plan: SetupProviderInput[], catalogProviderId: string) =>
  plan.find((p) => p.catalogProviderId === catalogProviderId);

const byBaseUrl = (plan: SetupProviderInput[], baseUrl: string) =>
  plan.find((p) => !p.catalogProviderId && normalizeUrl(p.baseUrl) === normalizeUrl(baseUrl));

describe("planByokMigration — provider mapping", () => {
  it("maps catalog-backed providers to the right providerType + catalogProviderId", () => {
    const plan = planByokMigration(
      settingsWith(
        [
          model({ name: "claude-sonnet-4-5", provider: ChatModelProviders.ANTHROPIC }),
          model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI }),
          model({ name: "gemini-2.5-pro", provider: ChatModelProviders.GOOGLE }),
          model({ name: "x-ai/grok-4.3", provider: ChatModelProviders.OPENROUTERAI }),
          model({ name: "grok-4", provider: ChatModelProviders.XAI }),
          model({ name: "llama-3.3-70b", provider: ChatModelProviders.GROQ }),
          model({ name: "mistral-large", provider: ChatModelProviders.MISTRAL }),
          model({ name: "deepseek-chat", provider: ChatModelProviders.DEEPSEEK }),
        ],
        {
          anthropicApiKey: "k",
          openAIApiKey: "k",
          googleApiKey: "k",
          openRouterAiApiKey: "k",
          xaiApiKey: "k",
          groqApiKey: "k",
          mistralApiKey: "k",
          deepseekApiKey: "k",
        }
      )
    );

    expect(byCatalog(plan, "anthropic")).toMatchObject({ providerType: "anthropic" });
    expect(byCatalog(plan, "openai")).toMatchObject({ providerType: "openai-compatible" });
    expect(byCatalog(plan, "google")).toMatchObject({ providerType: "google" });
    expect(byCatalog(plan, "openrouter")).toMatchObject({ providerType: "openai-compatible" });
    expect(byCatalog(plan, "xai")).toMatchObject({ providerType: "openai-compatible" });
    expect(byCatalog(plan, "groq")).toMatchObject({ providerType: "openai-compatible" });
    expect(byCatalog(plan, "mistral")).toMatchObject({ providerType: "openai-compatible" });
    expect(byCatalog(plan, "deepseek")).toMatchObject({ providerType: "openai-compatible" });
  });

  it("maps catalog-less SiliconFlow to openai-compatible with its default base URL", () => {
    const plan = planByokMigration(
      settingsWith(
        [model({ name: "deepseek-ai/DeepSeek-V3", provider: ChatModelProviders.SILICONFLOW })],
        {
          siliconflowApiKey: "k",
        }
      )
    );
    const sf = byBaseUrl(plan, "https://api.siliconflow.com/v1");
    expect(sf).toMatchObject({ providerType: "openai-compatible" });
    expect(sf?.catalogProviderId).toBeUndefined();
  });

  it("enrolls routable providers into chat + opencode", () => {
    const plan = planByokMigration(
      settingsWith([model({ name: "x", provider: ChatModelProviders.OPENROUTERAI })], {
        openRouterAiApiKey: "k",
      })
    );
    expect(byCatalog(plan, "openrouter")?.autoEnrollIn).toEqual(["chat", "opencode"]);
  });
});

describe("planByokMigration — grouping, keys, base URLs", () => {
  it("groups multiple models of one provider under a single descriptor", () => {
    const plan = planByokMigration(
      settingsWith(
        [
          model({ name: "x-ai/grok-4.3", provider: ChatModelProviders.OPENROUTERAI }),
          model({ name: "deepseek/deepseek-chat", provider: ChatModelProviders.OPENROUTERAI }),
          model({ name: "qwen/qwen-2.5", provider: ChatModelProviders.OPENROUTERAI }),
        ],
        { openRouterAiApiKey: "k" }
      )
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].models.map((m) => m.id).sort()).toEqual([
      "deepseek/deepseek-chat",
      "qwen/qwen-2.5",
      "x-ai/grok-4.3",
    ]);
  });

  it("prefers a per-model apiKey over the top-level provider key", () => {
    const plan = planByokMigration(
      settingsWith(
        [model({ name: "x", provider: ChatModelProviders.OPENROUTERAI, apiKey: "sk-per-model" })],
        { openRouterAiApiKey: "sk-top-level" }
      )
    );
    expect(byCatalog(plan, "openrouter")?.apiKey).toBe("sk-per-model");
  });

  it("falls back to the top-level provider key", () => {
    const plan = planByokMigration(
      settingsWith([model({ name: "x", provider: ChatModelProviders.OPENROUTERAI })], {
        openRouterAiApiKey: "sk-top-level",
      })
    );
    expect(byCatalog(plan, "openrouter")?.apiKey).toBe("sk-top-level");
  });

  it("uses the model's baseUrl when set, else the provider default", () => {
    const custom = planByokMigration(
      settingsWith(
        [
          model({
            name: "x",
            provider: ChatModelProviders.OPENROUTERAI,
            baseUrl: "https://proxy.local/v1",
          }),
        ],
        { openRouterAiApiKey: "k" }
      )
    );
    expect(byCatalog(custom, "openrouter")?.baseUrl).toBe("https://proxy.local/v1");

    const fallback = planByokMigration(
      settingsWith([model({ name: "claude", provider: ChatModelProviders.ANTHROPIC })], {
        anthropicApiKey: "k",
      })
    );
    expect(byCatalog(fallback, "anthropic")?.baseUrl).toBe("https://api.anthropic.com");
  });

  it("captures openAIOrgId in extras for OpenAI", () => {
    const plan = planByokMigration(
      settingsWith([model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI })], {
        openAIApiKey: "k",
        openAIOrgId: "org-123",
      })
    );
    expect(byCatalog(plan, "openai")?.extras).toEqual({ openAIOrgId: "org-123" });
  });
});

describe("planByokMigration — scope filters", () => {
  it("skips embedding models (flag or id heuristic) but keeps chat models", () => {
    const plan = planByokMigration(
      settingsWith(
        [
          model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI }),
          model({
            name: "text-embedding-3-large",
            provider: ChatModelProviders.OPENAI,
            isEmbeddingModel: true,
          }),
          model({ name: "nomic-embed-text", provider: ChatModelProviders.OPENAI }),
        ],
        { openAIApiKey: "k" }
      )
    );
    expect(byCatalog(plan, "openai")?.models.map((m) => m.id)).toEqual(["gpt-4o"]);
  });

  it("skips disabled models", () => {
    const plan = planByokMigration(
      settingsWith(
        [model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI, enabled: false })],
        {
          openAIApiKey: "k",
        }
      )
    );
    expect(plan).toEqual([]);
  });

  it("skips copilot-plus and github-copilot", () => {
    const plan = planByokMigration(
      settingsWith(
        [
          model({
            name: "copilot-plus-flash",
            provider: ChatModelProviders.COPILOT_PLUS,
            isBuiltIn: true,
          }),
          model({ name: "gpt-5", provider: ChatModelProviders.GITHUB_COPILOT }),
        ],
        { plusLicenseKey: "lic", githubCopilotToken: "tok" }
      )
    );
    expect(plan).toEqual([]);
  });

  it("skips providers without a usable key", () => {
    const plan = planByokMigration(
      settingsWith([model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI })], {
        openAIApiKey: "",
      })
    );
    expect(plan).toEqual([]);
  });

  it("preserves a keyless descriptor when a discarded disk credential requires re-entry", () => {
    const plan = planByokMigration(
      settingsWith([model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI })], {
        openAIApiKey: "",
      }),
      { providerIds: [ChatModelProviders.OPENAI], modelIds: [] }
    );

    expect(byCatalog(plan, "openai")).toMatchObject({
      providerType: "openai-compatible",
      requiresApiKey: true,
      models: [{ id: "gpt-4o", displayName: "gpt-4o" }],
    });
    expect(byCatalog(plan, "openai")?.apiKey).toBeUndefined();
  });

  it("limits a discarded per-model credential to that exact model descriptor", () => {
    const plan = planByokMigration(
      settingsWith(
        [
          model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI }),
          model({ name: "custom-gpt", provider: ChatModelProviders.OPENAI }),
        ],
        { openAIApiKey: "" }
      ),
      { providerIds: [], modelIds: [`custom-gpt|${ChatModelProviders.OPENAI}`] }
    );

    expect(byCatalog(plan, "openai")?.models).toEqual([
      { id: "custom-gpt", displayName: "custom-gpt" },
    ]);
  });

  it("keeps a discarded model override separate from its provider credential", () => {
    const provider = ChatModelProviders.OPENAI;
    const plan = planByokMigration(
      settingsWith([model({ name: "gpt-4o", provider }), model({ name: "custom-gpt", provider })], {
        openAIApiKey: "keychain-provider-key",
      }),
      { providerIds: [provider], modelIds: [`custom-gpt|${provider}`] }
    );

    expect(plan).toHaveLength(2);
    expect(plan.map(({ apiKey, models }) => ({ apiKey, models }))).toEqual([
      {
        apiKey: "keychain-provider-key",
        models: [{ id: "gpt-4o", displayName: "gpt-4o" }],
      },
      {
        apiKey: undefined,
        models: [{ id: "custom-gpt", displayName: "custom-gpt" }],
      },
    ]);
  });

  it("includes enabled built-in models when the provider has a key", () => {
    const plan = planByokMigration(
      settingsWith(
        [
          model({
            name: "gpt-5.5",
            provider: ChatModelProviders.OPENAI,
            isBuiltIn: true,
            core: true,
          }),
        ],
        { openAIApiKey: "k" }
      )
    );
    expect(byCatalog(plan, "openai")?.models.map((m) => m.id)).toEqual(["gpt-5.5"]);
  });

  it("returns [] for empty activeModels", () => {
    expect(planByokMigration(settingsWith([]))).toEqual([]);
  });
});

describe("planByokMigration — Azure / Bedrock (chat only)", () => {
  it("maps Azure to chat-only with azure extras", () => {
    const plan = planByokMigration(
      settingsWith([model({ name: "gpt-4o", provider: ChatModelProviders.AZURE_OPENAI })], {
        azureOpenAIApiKey: "k",
        azureOpenAIApiInstanceName: "my-instance",
        azureOpenAIApiDeploymentName: "my-deploy",
        azureOpenAIApiVersion: "2024-06-01",
      })
    );
    const azure = plan.find((p) => p.providerType === "azure");
    expect(azure).toBeDefined();
    expect(azure?.catalogProviderId).toBeUndefined();
    expect(azure?.autoEnrollIn).toEqual(["chat"]);
    expect(azure?.extras).toEqual({
      azureInstanceName: "my-instance",
      azureDeploymentName: "my-deploy",
      azureApiVersion: "2024-06-01",
    });
  });

  it("maps Bedrock to chat-only with the region in extras", () => {
    const plan = planByokMigration(
      settingsWith([model({ name: "claude-3-5", provider: ChatModelProviders.AMAZON_BEDROCK })], {
        amazonBedrockApiKey: "k",
        amazonBedrockRegion: "us-east-1",
      })
    );
    const bedrock = plan.find((p) => p.providerType === "bedrock");
    expect(bedrock?.autoEnrollIn).toEqual(["chat"]);
    expect(bedrock?.extras).toEqual({ bedrockRegion: "us-east-1" });
  });
});

describe("planByokMigration — local providers (custom URL required)", () => {
  it("migrates Ollama / LM Studio only when an explicit baseUrl is set", () => {
    const withUrl = planByokMigration(
      settingsWith([
        model({
          name: "llama3.2",
          provider: ChatModelProviders.OLLAMA,
          baseUrl: "http://192.168.1.5:11434/v1",
        }),
      ])
    );
    expect(withUrl).toHaveLength(1);
    expect(withUrl[0]).toMatchObject({
      providerType: "openai-compatible",
      baseUrl: "http://192.168.1.5:11434/v1",
      autoEnrollIn: ["chat", "opencode"],
      // Local runner → keyless.
      requiresApiKey: false,
    });

    const withoutUrl = planByokMigration(
      settingsWith([model({ name: "llama3.2", provider: ChatModelProviders.LM_STUDIO })])
    );
    expect(withoutUrl).toEqual([]);
  });

  it("sets requiresApiKey:true for key-based providers, false for local runners", () => {
    const plan = planByokMigration(
      settingsWith([
        model({ name: "claude-x", provider: ChatModelProviders.ANTHROPIC, apiKey: "sk-ant" }),
        model({
          name: "llama3.2",
          provider: ChatModelProviders.OLLAMA,
          baseUrl: "http://localhost:11434/v1",
        }),
      ])
    );
    expect(byCatalog(plan, "anthropic")?.requiresApiKey).toBe(true);
    const ollama = plan.find((p) => p.baseUrl?.includes("11434"));
    expect(ollama?.requiresApiKey).toBe(false);
  });
});

describe("executeByokMigration", () => {
  let idSeq = 0;
  function makeApi(existing: Provider[] = []) {
    const setupProvider = jest.fn(async (input: SetupProviderInput) => ({
      providerId: `prov-${++idSeq}`,
      configuredModelIds: input.models.map((_, i) => `cm-${idSeq}-${i}`),
    }));
    const getApiKey = jest.fn().mockResolvedValue(null);
    const setApiKey = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(undefined);
    const addModels = jest.fn(async (input: { models: readonly ModelInfo[] }) =>
      input.models.map((_, index) => `existing-cm-${index}`)
    );
    const enableModel = jest.fn().mockResolvedValue(undefined);
    const listByOrigin = jest.fn((kind: string) => existing.filter((p) => p.origin.kind === kind));
    const api = {
      providerRegistry: { listByOrigin, getApiKey, setApiKey, update },
      backendConfigRegistry: { enableModel },
      setup: { byok: { setupProvider, addModels } },
    } as unknown as ModelManagementApi;
    return { api, setupProvider, getApiKey, setApiKey, update, addModels, enableModel };
  }

  function byokProvider(overrides: Partial<Provider>): Provider {
    return {
      providerId: "existing",
      providerType: "anthropic",
      displayName: "Existing",
      origin: { kind: "byok", catalogProviderId: "anthropic" },
      addedAt: 0,
      apiKeyKeychainId: null,
      ...overrides,
    };
  }

  it("creates one provider per planned descriptor", async () => {
    const { api, setupProvider } = makeApi();
    await executeByokMigration(
      api,
      settingsWith(
        [
          model({ name: "claude", provider: ChatModelProviders.ANTHROPIC }),
          model({ name: "or-x", provider: ChatModelProviders.OPENROUTERAI }),
        ],
        { anthropicApiKey: "k", openRouterAiApiKey: "k" }
      )
    );
    expect(setupProvider).toHaveBeenCalledTimes(2);
  });

  it("reuses a matching BYOK provider while creating unrelated descriptors", async () => {
    const existing = byokProvider({
      providerType: "anthropic",
      baseUrl: "https://api.anthropic.com",
      origin: { kind: "byok", catalogProviderId: "anthropic" },
    });
    const { api, setupProvider } = makeApi([existing]);
    await executeByokMigration(
      api,
      settingsWith(
        [
          model({ name: "claude", provider: ChatModelProviders.ANTHROPIC }),
          model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI }),
        ],
        { anthropicApiKey: "k", openAIApiKey: "k" }
      )
    );
    // Anthropic deduped; only OpenAI created.
    expect(setupProvider).toHaveBeenCalledTimes(1);
    expect(setupProvider.mock.calls[0][0]).toMatchObject({ catalogProviderId: "openai" });
  });

  it("reconciles credentials, models, and backend enrollment on an existing provider", async () => {
    const existing = byokProvider({
      providerType: "anthropic",
      baseUrl: "https://api.anthropic.com",
      origin: { kind: "byok", catalogProviderId: "anthropic" },
    });
    const { api, setupProvider, getApiKey, setApiKey, addModels, enableModel } = makeApi([
      existing,
    ]);

    await executeByokMigration(
      api,
      settingsWith([model({ name: "claude", provider: ChatModelProviders.ANTHROPIC })], {
        anthropicApiKey: "keychain-key",
      })
    );

    expect(setupProvider).not.toHaveBeenCalled();
    expect(getApiKey).toHaveBeenCalledWith(existing.providerId);
    expect(setApiKey).toHaveBeenCalledWith(existing.providerId, "keychain-key");
    expect(addModels).toHaveBeenCalledWith({
      providerId: existing.providerId,
      models: [{ id: "claude", displayName: "claude" }],
      autoEnrollIn: ["chat", "opencode"],
    });
    expect(enableModel.mock.calls).toEqual([
      ["chat", "existing-cm-0"],
      ["opencode", "existing-cm-0"],
    ]);
  });

  it("preserves the current credential when an existing provider already has one", async () => {
    const existing = byokProvider({
      baseUrl: "https://api.anthropic.com",
      apiKeyKeychainId: "current-keychain-id",
    });
    const { api, getApiKey, setApiKey } = makeApi([existing]);
    getApiKey.mockResolvedValue("current-key");

    await executeByokMigration(
      api,
      settingsWith([model({ name: "claude", provider: ChatModelProviders.ANTHROPIC })], {
        anthropicApiKey: "legacy-key",
      })
    );

    expect(getApiKey).toHaveBeenCalledWith(existing.providerId);
    expect(setApiKey).not.toHaveBeenCalled();
  });

  it("backfills missing provider extras without replacing current values", async () => {
    const existing = byokProvider({
      providerType: "azure",
      origin: { kind: "byok" },
      extras: { azureInstanceName: "current-instance" },
    });
    const { api, update } = makeApi([existing]);

    await executeByokMigration(
      api,
      settingsWith([model({ name: "gpt-4o", provider: ChatModelProviders.AZURE_OPENAI })], {
        azureOpenAIApiKey: "keychain-key",
        azureOpenAIApiInstanceName: "legacy-instance",
        azureOpenAIApiDeploymentName: "legacy-deployment",
        azureOpenAIApiVersion: "2024-06-01",
      })
    );

    expect(update).toHaveBeenCalledWith(existing.providerId, {
      extras: {
        azureInstanceName: "current-instance",
        azureDeploymentName: "legacy-deployment",
        azureApiVersion: "2024-06-01",
      },
    });
  });

  it("uses one existing provider for only one planned credential group", async () => {
    const provider = ChatModelProviders.OPENAI;
    const existing = byokProvider({
      providerType: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      origin: { kind: "byok", catalogProviderId: "openai" },
    });
    const { api, setupProvider } = makeApi([existing]);

    await executeByokMigration(
      api,
      settingsWith([model({ name: "custom-gpt", provider }), model({ name: "gpt-4o", provider })]),
      { providerIds: [provider], modelIds: [`custom-gpt|${provider}`] }
    );

    expect(setupProvider).toHaveBeenCalledTimes(1);
    expect(setupProvider.mock.calls[0][0]).toMatchObject({
      catalogProviderId: "openai",
      models: [{ id: "custom-gpt", displayName: "custom-gpt" }],
    });
  });

  it("continues after a per-provider failure", async () => {
    const { api, setupProvider } = makeApi();
    setupProvider.mockRejectedValueOnce(new Error("keychain unavailable"));
    await expect(
      executeByokMigration(
        api,
        settingsWith(
          [
            model({ name: "claude", provider: ChatModelProviders.ANTHROPIC }),
            model({ name: "or-x", provider: ChatModelProviders.OPENROUTERAI }),
          ],
          { anthropicApiKey: "k", openRouterAiApiKey: "k" }
        )
      )
    ).resolves.toBeUndefined();
    expect(setupProvider).toHaveBeenCalledTimes(2);
  });
});
