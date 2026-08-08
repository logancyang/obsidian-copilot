/**
 * Tests for `ByokSetupApi.setupProvider` + `addModels`.
 *
 * Real settings store + real registries. Keychain is mocked with the
 * same fake `app.secretStorage` shim used in `ProviderRegistry.test.ts`.
 */

import { resetSettings } from "@/settings/model";
import { KeychainService } from "@/services/keychainService";

import { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { ProviderAdapterRegistry } from "@/modelManagement/providers/adapters/ProviderAdapterRegistry";
import type { CatalogProvider } from "@/modelManagement/types/catalog";

import { ByokSetupApi, BYOK_DEFAULT_AUTO_ENROLL } from "./ByokSetupApi";

import type { App } from "obsidian";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makeFakeApp(): App {
  const secrets = new Map<string, string>();
  return {
    secretStorage: {
      setSecret: (id: string, value: string) => {
        secrets.set(id, value);
      },
      getSecret: (id: string) => (secrets.has(id) ? secrets.get(id)! : null),
      listSecrets: () => Array.from(secrets.keys()),
      deleteSecret: (id: string) => {
        secrets.delete(id);
      },
    },
    vault: { adapter: {} },
  } as unknown as App;
}

const ANTHROPIC_CATALOG: CatalogProvider = {
  id: "anthropic",
  displayName: "Anthropic",
  defaultBaseUrl: "https://api.anthropic.com/v1",
  providerType: "anthropic",
  models: {
    "claude-sonnet-4-5": { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
    "claude-opus-4-5": { id: "claude-opus-4-5", displayName: "Claude Opus 4.5" },
    "claude-haiku-4-5": { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5" },
  },
};

describe("ByokSetupApi.addModels", () => {
  let api: ByokSetupApi;
  let providers: ProviderRegistry;
  let models: ConfiguredModelRegistry;
  let backends: BackendConfigRegistry;

  beforeEach(() => {
    resetSettings();
    KeychainService.resetInstance();
    const app = makeFakeApp();
    KeychainService.getInstance(app);
    providers = new ProviderRegistry(app, new ProviderAdapterRegistry());
    models = new ConfiguredModelRegistry();
    backends = new BackendConfigRegistry(providers, models);
    api = new ByokSetupApi(providers, models, backends);
  });

  it("adds only new models, reuses existing ids, and enrolls just the new ones", async () => {
    const { providerId, configuredModelIds } = await api.setupProvider({
      providerType: "openai-compatible",
      displayName: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      models: [{ id: "llama3.2", displayName: "llama3.2" }],
    });
    const existingId = configuredModelIds[0];

    const ids = await api.addModels({
      providerId,
      models: [
        { id: "llama3.2", displayName: "llama3.2" }, // already configured
        { id: "mistral", displayName: "mistral" }, // new
      ],
    });

    // Existing model resolves to its original id; new model gets a fresh one.
    expect(ids[0]).toBe(existingId);
    expect(ids[1]).not.toBe(existingId);
    expect(models.listByProvider(providerId)).toHaveLength(2);

    for (const backend of BYOK_DEFAULT_AUTO_ENROLL) {
      const enabled = backends.get(backend).enabledModels;
      expect(enabled).toContain(existingId);
      expect(enabled).toContain(ids[1]);
    }
  });

  // `addModels` receives bare `ModelInfo` (id + displayName) from the
  // hand-typed flow; without the id heuristic it would enroll embedding
  // models into chat backends where they fail at inference.
  it("does not enroll embedding-named ids into chat-shaped backends", async () => {
    const { providerId } = await api.setupProvider({
      providerType: "openai-compatible",
      displayName: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      models: [{ id: "llama3.2", displayName: "llama3.2" }],
    });

    const ids = await api.addModels({
      providerId,
      models: [{ id: "nomic-embed-text", displayName: "nomic-embed-text" }],
    });
    const embedId = ids[0];

    for (const backend of BYOK_DEFAULT_AUTO_ENROLL) {
      expect(backends.get(backend).enabledModels).not.toContain(embedId);
    }
  });
});

describe("ByokSetupApi.setupProvider", () => {
  let api: ByokSetupApi;
  let providers: ProviderRegistry;
  let models: ConfiguredModelRegistry;
  let backends: BackendConfigRegistry;

  beforeEach(() => {
    resetSettings();
    KeychainService.resetInstance();
    const app = makeFakeApp();
    KeychainService.getInstance(app);
    providers = new ProviderRegistry(app, new ProviderAdapterRegistry());
    models = new ConfiguredModelRegistry();
    backends = new BackendConfigRegistry(providers, models);
    api = new ByokSetupApi(providers, models, backends);
  });

  it("creates a catalog-linked BYOK provider, snapshots the supplied ModelInfos, and auto-enrolls", async () => {
    const result = await api.setupProvider({
      catalogProviderId: "anthropic",
      providerType: "anthropic",
      displayName: "My Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant",
      models: [
        ANTHROPIC_CATALOG.models["claude-sonnet-4-5"],
        ANTHROPIC_CATALOG.models["claude-opus-4-5"],
      ],
    });

    const provider = providers.get(result.providerId)!;
    expect(provider.origin).toEqual({ kind: "byok", catalogProviderId: "anthropic" });
    expect(provider.providerType).toBe("anthropic");
    expect(provider.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(await providers.getApiKey(result.providerId)).toBe("sk-ant");

    expect(
      models
        .listByProvider(result.providerId)
        .map((m) => m.info.id)
        .sort()
    ).toEqual(["claude-opus-4-5", "claude-sonnet-4-5"]);

    for (const backend of BYOK_DEFAULT_AUTO_ENROLL) {
      expect(backends.get(backend).enabledModels.sort()).toEqual(
        [...result.configuredModelIds].sort()
      );
    }
  });

  it("omits catalogProviderId on origin when none is supplied (template / custom flow)", async () => {
    const result = await api.setupProvider({
      providerType: "openai-compatible",
      displayName: "My Ollama",
      baseUrl: "http://localhost:11434/v1",
      models: [
        { id: "llama3.2", displayName: "llama3.2" },
        { id: "qwen2.5-coder:7b", displayName: "qwen2.5-coder:7b" },
      ],
    });
    const provider = providers.get(result.providerId)!;
    expect(provider.origin).toEqual({ kind: "byok" });
    expect(provider.baseUrl).toBe("http://localhost:11434/v1");
    expect(provider.apiKeyKeychainId).toBeNull();
  });

  it("respects the caller's `isEmbedding` flag when deciding auto-enrollment", async () => {
    const result = await api.setupProvider({
      providerType: "openai-compatible",
      displayName: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      models: [
        { id: "llama3.2", displayName: "llama3.2" },
        // Explicitly tagged as embedding by the caller (catalog said so).
        { id: "nomic-embed-text", displayName: "nomic-embed-text", isEmbedding: true },
      ],
    });
    const [chatId, embedId] = result.configuredModelIds;
    for (const backend of BYOK_DEFAULT_AUTO_ENROLL) {
      const enabled = backends.get(backend).enabledModels;
      expect(enabled).toContain(chatId);
      expect(enabled).not.toContain(embedId);
    }
  });

  it("rolls back the provider row when setApiKey throws", async () => {
    const setApiKeySpy = jest
      .spyOn(providers, "setApiKey")
      .mockRejectedValueOnce(new Error("keychain unavailable"));

    await expect(
      api.setupProvider({
        catalogProviderId: "anthropic",
        providerType: "anthropic",
        displayName: "My Anthropic",
        apiKey: "sk-ant",
        models: [ANTHROPIC_CATALOG.models["claude-sonnet-4-5"]],
      })
    ).rejects.toThrow("keychain unavailable");

    expect(setApiKeySpy).toHaveBeenCalledTimes(1);
    expect(providers.list()).toHaveLength(0);
  });

  it("honors a custom autoEnrollIn override", async () => {
    const result = await api.setupProvider({
      providerType: "openai-compatible",
      displayName: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      models: [{ id: "llama3.2", displayName: "llama3.2" }],
      autoEnrollIn: ["chat"],
    });
    expect(backends.get("chat").enabledModels).toEqual([...result.configuredModelIds]);
    expect(backends.get("opencode").enabledModels).toEqual([]);
  });
});
