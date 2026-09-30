import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { createTestRegistries } from "@/modelManagement/testRegistries";
import type { CatalogProvider } from "@/modelManagement/types/catalog";

import { ByokSetupApi, BYOK_DEFAULT_AUTO_ENROLL } from "./ByokSetupApi";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

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

describe("ByokSetupApi", () => {
  let api: ByokSetupApi;
  let providers: ProviderRegistry;
  let models: ConfiguredModelRegistry;
  let backends: BackendConfigRegistry;

  beforeEach(() => {
    ({ providers, models, backends } = createTestRegistries());
    api = new ByokSetupApi(providers, models, backends);
  });

  describe("addModels()", () => {
    it("keeps the ids of models already added and enrolls only the newly added ones", async () => {
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
          { id: "llama3.2", displayName: "llama3.2" },
          { id: "mistral", displayName: "mistral" },
        ],
      });

      expect(ids[0]).toBe(existingId);
      expect(ids[1]).not.toBe(existingId);
      expect(models.listByProvider(providerId)).toHaveLength(2);

      for (const backend of BYOK_DEFAULT_AUTO_ENROLL) {
        const enabled = backends.get(backend).enabledModels;
        expect(enabled).toContain(existingId);
        expect(enabled).toContain(ids[1]);
      }
    });

    it("does not enroll an embedding model such as nomic-embed-text into any backend", async () => {
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

  describe("setupProvider()", () => {
    it("creates a catalog-linked BYOK provider with its key and models and enrolls the models into the default backends", async () => {
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

    it("creates a provider without a catalog id for a template or custom endpoint", async () => {
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

    it("persists the provider's Quick Chat CORS choice (https://github.com/logancyang/obsidian-copilot-preview/issues/313)", async () => {
      const result = await api.setupProvider({
        providerType: "openai-compatible",
        displayName: "Work endpoint",
        baseUrl: "https://work.example.com/v1",
        enableCors: true,
        models: [{ id: "work-model", displayName: "Work model" }],
      });

      expect(providers.get(result.providerId)?.enableCors).toBe(true);
    });

    it("does not enroll a model the caller flags as isEmbedding", async () => {
      const result = await api.setupProvider({
        providerType: "openai-compatible",
        displayName: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        models: [
          { id: "llama3.2", displayName: "llama3.2" },
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

    it("removes the new provider again when storing its API key fails", async () => {
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

    it("enrolls models only into the backends listed in autoEnrollIn", async () => {
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
});
