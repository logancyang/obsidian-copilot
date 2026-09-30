import { getSettings } from "@/settings/model";

import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { createTestRegistries } from "@/modelManagement/testRegistries";

import { createModelManagement, type ModelManagementCoordinator } from "./createModelManagement";

import type { App } from "obsidian";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("createModelManagement", () => {
  let app: App;
  let providers: ProviderRegistry;
  let models: ConfiguredModelRegistry;
  let backends: BackendConfigRegistry;
  let coordinator: ModelManagementCoordinator;

  beforeEach(() => {
    ({ app, providers, models, backends, coordinator } = createTestRegistries());
  });

  describe("createModelManagement()", () => {
    it("wires a coordinator that removes a provider from the shared registries", async () => {
      const api = createModelManagement({ app });
      const providerId = await api.providerRegistry.add({
        providerType: "anthropic",
        displayName: "Anthropic",
        origin: { kind: "byok" },
      });
      const modelId = await api.configuredModelRegistry.add({
        providerId,
        info: { id: "claude-sonnet-4-5", displayName: "Sonnet" },
      });
      await api.backendConfigRegistry.setEnabledModels("chat", [modelId]);

      await api.coordinator.removeProvider(providerId);

      expect(api.providerRegistry.get(providerId)).toBeUndefined();
      expect(api.configuredModelRegistry.get(modelId)).toBeUndefined();
      expect(api.backendConfigRegistry.get("chat").enabledModels).toEqual([]);
    });
  });

  describe("ModelManagementCoordinator", () => {
    describe("removeProvider()", () => {
      it("removes the provider, its models, their backend refs, and its stored API key", async () => {
        const providerId = await providers.add({
          providerType: "anthropic",
          displayName: "Anthropic",
          origin: { kind: "byok" },
        });
        await providers.setApiKey(providerId, "sk-ant-test");
        const id1 = await models.add({
          providerId,
          info: { id: "claude-sonnet-4-5", displayName: "Sonnet" },
        });
        const id2 = await models.add({
          providerId,
          info: { id: "claude-opus-4-5", displayName: "Opus" },
        });
        await backends.setEnabledModels("chat", [id1, id2]);
        await backends.setEnabledModels("opencode", [id2]);

        await coordinator.removeProvider(providerId);

        expect(providers.get(providerId)).toBeUndefined();
        expect(models.listByProvider(providerId)).toHaveLength(0);
        expect(backends.get("chat").enabledModels).toEqual([]);
        expect(backends.get("opencode").enabledModels).toEqual([]);
        expect(await providers.getApiKey(providerId)).toBeNull();
      });

      it("keeps other providers, their models, and their backend refs", async () => {
        const idA = await providers.add({
          providerType: "anthropic",
          displayName: "A",
          origin: { kind: "byok" },
        });
        const idB = await providers.add({
          providerType: "anthropic",
          displayName: "B",
          origin: { kind: "byok" },
        });
        const aModel = await models.add({
          providerId: idA,
          info: { id: "model-a", displayName: "A1" },
        });
        const bModel = await models.add({
          providerId: idB,
          info: { id: "model-b", displayName: "B1" },
        });
        await backends.setEnabledModels("chat", [aModel, bModel]);

        await coordinator.removeProvider(idA);

        expect(providers.get(idB)).toBeDefined();
        expect(models.listByProvider(idB)).toHaveLength(1);
        expect(backends.get("chat").enabledModels).toEqual([bModel]);
      });

      it("removes a provider that has no configured models without touching backends", async () => {
        const providerId = await providers.add({
          providerType: "google",
          displayName: "Empty",
          origin: { kind: "byok" },
        });
        await coordinator.removeProvider(providerId);
        expect(providers.get(providerId)).toBeUndefined();
        expect(getSettings().backends).toEqual({});
      });
    });

    describe("removeConfiguredModel()", () => {
      it("removes the model and its refs from every backend while keeping the provider and sibling models", async () => {
        const providerId = await providers.add({
          providerType: "anthropic",
          displayName: "Anthropic",
          origin: { kind: "byok" },
        });
        const id1 = await models.add({
          providerId,
          info: { id: "claude-sonnet-4-5", displayName: "Sonnet" },
        });
        const id2 = await models.add({
          providerId,
          info: { id: "claude-opus-4-5", displayName: "Opus" },
        });
        await backends.setEnabledModels("chat", [id1, id2]);
        await backends.setEnabledModels("opencode", [id1]);

        await coordinator.removeConfiguredModel(id1);

        expect(models.get(id1)).toBeUndefined();
        expect(models.get(id2)).toBeDefined();
        expect(backends.get("chat").enabledModels).toEqual([id2]);
        expect(backends.get("opencode").enabledModels).toEqual([]);
        expect(providers.get(providerId)).toBeDefined();
      });

      it("changes nothing when the model id does not exist", async () => {
        const providerId = await providers.add({
          providerType: "google",
          displayName: "G",
          origin: { kind: "byok" },
        });
        const id = await models.add({
          providerId,
          info: { id: "gemini", displayName: "Gemini" },
        });
        await backends.setEnabledModels("chat", [id]);

        await coordinator.removeConfiguredModel("does-not-exist");

        expect(models.get(id)).toBeDefined();
        expect(backends.get("chat").enabledModels).toEqual([id]);
      });
    });
  });
});
