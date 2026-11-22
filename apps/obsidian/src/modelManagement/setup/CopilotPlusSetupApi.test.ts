import { CopilotPlusSetupApi } from "./CopilotPlusSetupApi";

import { createTestRegistries, type TestRegistries } from "@/modelManagement/testRegistries";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { BackendType } from "@/modelManagement/types/persisted";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const FLASH: ModelInfo = {
  id: "copilot-plus-flash",
  displayName: "Copilot Plus Flash",
  toolCall: true,
};
const EMBEDDING: ModelInfo = {
  id: "copilot-plus-small",
  displayName: "Copilot Plus Small",
  isEmbedding: true,
};
const EXTRA: ModelInfo = {
  id: "glm-5.2",
  displayName: "GLM-5.2",
  toolCall: true,
};

interface Harness extends TestRegistries {
  api: CopilotPlusSetupApi;
  enabledFor(backend: BackendType): string[];
  configuredModelId(providerId: string, wireId: string): string;
}

function makeHarness(): Harness {
  const registries = createTestRegistries();
  const api = new CopilotPlusSetupApi(
    registries.providers,
    registries.models,
    registries.backends,
    registries.coordinator
  );
  return {
    ...registries,
    api,
    enabledFor: (backend) => [...registries.backends.get(backend).enabledModels],
    configuredModelId: (providerId, wireId) =>
      registries.models.getByWireId(providerId, wireId)!.configuredModelId,
  };
}

function register(h: Harness, models: ModelInfo[], apiKey: string | undefined = "lic-key") {
  return h.api.registerPlusProvider({
    providerType: "openai-compatible",
    displayName: "Copilot Plus",
    baseUrl: "https://models.brevilabs.com/v1",
    apiKey,
    models,
  });
}

describe("CopilotPlusSetupApi", () => {
  describe("registerPlusProvider()", () => {
    it("creates one copilot-plus provider, stores the key, and enrolls the chat model into chat and opencode", async () => {
      const h = makeHarness();
      const result = await register(h, [FLASH]);

      expect(h.providers.list()).toHaveLength(1);
      const provider = h.providers.get(result.providerId)!;
      expect(provider.origin).toEqual({ kind: "copilot-plus" });
      expect(provider.providerType).toBe("openai-compatible");
      expect(provider.displayName).toBe("Copilot Plus");
      expect(await h.providers.getApiKey(result.providerId)).toBe("lic-key");

      expect(result.configuredModelIds).toHaveLength(1);
      const flashId = result.configuredModelIds[0];
      expect(h.enabledFor("chat")).toEqual([flashId]);
      expect(h.enabledFor("opencode")).toEqual([flashId]);
      expect(h.enabledFor("claude")).toEqual([]);
      expect(h.enabledFor("codex")).toEqual([]);
    });

    it("stores no key when none is supplied", async () => {
      const h = makeHarness();
      const result = await h.api.registerPlusProvider({
        providerType: "openai-compatible",
        displayName: "Copilot Plus",
        baseUrl: "https://models.brevilabs.com/v1",
        models: [FLASH],
      });
      expect(h.providers.get(result.providerId)!.apiKeyKeychainId).toBeNull();
    });

    it("creates an embedding model but never enrolls it into a completion backend", async () => {
      const h = makeHarness();
      const result = await register(h, [FLASH, EMBEDDING]);

      expect(result.configuredModelIds).toHaveLength(2);
      const flashId = h.configuredModelId(result.providerId, FLASH.id);

      expect(h.enabledFor("chat")).toEqual([flashId]);
      expect(h.enabledFor("opencode")).toEqual([flashId]);
    });

    it("enrolls every non-embedding model when autoEnrollModelIds is omitted", async () => {
      const h = makeHarness();
      const result = await register(h, [FLASH, EXTRA]);

      const flashId = h.configuredModelId(result.providerId, FLASH.id);
      const extraId = h.configuredModelId(result.providerId, EXTRA.id);
      expect(h.enabledFor("opencode")).toEqual([flashId, extraId]);
      expect(h.enabledFor("chat")).toEqual([flashId, extraId]);
    });

    it("enrolls only the models in autoEnrollModelIds while creating the rest disabled", async () => {
      const h = makeHarness();
      const result = await h.api.registerPlusProvider({
        providerType: "openai-compatible",
        displayName: "Copilot Plus",
        baseUrl: "https://models.brevilabs.com/v1",
        apiKey: "lic-key",
        models: [FLASH, EXTRA],
        autoEnrollModelIds: [FLASH.id],
      });

      expect(result.configuredModelIds).toHaveLength(2);
      const flashId = h.configuredModelId(result.providerId, FLASH.id);
      expect(h.enabledFor("chat")).toEqual([flashId]);
      expect(h.enabledFor("opencode")).toEqual([flashId]);
    });

    it("leaves a model added on a later sync disabled so the user's existing choices are kept", async () => {
      const h = makeHarness();
      const first = await h.api.registerPlusProvider({
        providerType: "openai-compatible",
        displayName: "Copilot Plus",
        baseUrl: "https://models.brevilabs.com/v1",
        apiKey: "lic-key",
        models: [FLASH],
        autoEnrollModelIds: [FLASH.id],
      });
      const flashId = first.configuredModelIds[0];

      await h.api.registerPlusProvider({
        providerType: "openai-compatible",
        displayName: "Copilot Plus",
        baseUrl: "https://models.brevilabs.com/v1",
        apiKey: "lic-key",
        models: [FLASH, EXTRA],
        autoEnrollModelIds: [FLASH.id],
      });

      expect(h.configuredModelId(first.providerId, EXTRA.id)).toBeDefined();
      expect(h.enabledFor("opencode")).toEqual([flashId]);
    });

    it("updates the existing provider in place and rotates its key when registered again", async () => {
      const h = makeHarness();
      const first = await register(h, [FLASH]);
      const modelsBefore = h.models.list();
      const enabledBefore = h.enabledFor("chat");

      const second = await h.api.registerPlusProvider({
        providerType: "openai-compatible",
        displayName: "Copilot Plus (renamed)",
        baseUrl: "https://models.brevilabs.com/v1",
        apiKey: "rotated-key",
        models: [FLASH],
      });

      expect(second.providerId).toBe(first.providerId);
      expect(h.providers.list()).toHaveLength(1);
      expect(h.providers.get(first.providerId)!.displayName).toBe("Copilot Plus (renamed)");
      expect(await h.providers.getApiKey(first.providerId)).toBe("rotated-key");
      expect(second.configuredModelIds).toEqual(first.configuredModelIds);
      expect(h.models.list()).toBe(modelsBefore);
      expect(h.enabledFor("chat")).toEqual(enabledBefore);
    });

    it("removes a model the service no longer offers and keeps the others enabled", async () => {
      const h = makeHarness();
      const first = await register(h, [FLASH, EMBEDDING]);

      await register(h, [FLASH]);

      expect(h.models.getByWireId(first.providerId, EMBEDDING.id)).toBeUndefined();
      expect(h.enabledFor("opencode")).toContain(h.configuredModelId(first.providerId, FLASH.id));
    });

    it("keeps the existing models instead of withdrawing them when registered again without a model list (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const h = makeHarness();
      const first = await register(h, [FLASH, EXTRA]);
      const modelsBefore = h.models.list();

      const second = await h.api.registerPlusProvider({
        providerType: "openai-compatible",
        displayName: "Copilot Plus",
        baseUrl: "https://models.brevilabs.com/v1",
        apiKey: "lic-key",
      });

      expect(second.configuredModelIds).toEqual(first.configuredModelIds);
      expect(h.models.list()).toBe(modelsBefore);
    });

    it("updates a model's display name in place on re-register while keeping its id", async () => {
      const h = makeHarness();
      const first = await register(h, [FLASH]);
      const idBefore = first.configuredModelIds[0];

      await register(h, [{ ...FLASH, displayName: "Copilot Plus Flash 2" }]);

      const row = h.models.getByWireId(first.providerId, FLASH.id)!;
      expect(row.configuredModelId).toBe(idBefore);
      expect(row.info.displayName).toBe("Copilot Plus Flash 2");
    });

    it("updates changed capability fields (reasoning, modalities, toolCall) in place", async () => {
      const h = makeHarness();
      const first = await register(h, [{ id: "glm-5.2", displayName: "GLM-5.2", toolCall: false }]);
      const idBefore = first.configuredModelIds[0];
      expect(h.models.getByWireId(first.providerId, "glm-5.2")!.info.reasoning).toBeUndefined();

      await register(h, [
        {
          id: "glm-5.2",
          displayName: "GLM-5.2",
          toolCall: true,
          reasoning: true,
          modalities: { input: ["text"], output: ["text"] },
        },
      ]);

      const row = h.models.getByWireId(first.providerId, "glm-5.2")!;
      expect(row.configuredModelId).toBe(idBefore);
      expect(row.info.reasoning).toBe(true);
      expect(row.info.toolCall).toBe(true);
      expect(row.info.modalities).toEqual({ input: ["text"], output: ["text"] });
    });
  });

  describe("unregisterPlusProvider()", () => {
    it("removes the provider, its models, and their backend enrollment", async () => {
      const h = makeHarness();
      const reg = await register(h, [FLASH]);
      const flashId = reg.configuredModelIds[0];

      await h.api.unregisterPlusProvider();

      expect(h.providers.list()).toHaveLength(0);
      expect(h.models.list()).toHaveLength(0);
      expect(h.enabledFor("chat")).not.toContain(flashId);
      expect(h.enabledFor("opencode")).not.toContain(flashId);
    });

    it("does nothing when no Plus provider exists", async () => {
      const h = makeHarness();
      const before = h.providers.list();
      await h.api.unregisterPlusProvider();
      expect(h.providers.list()).toBe(before);
    });
  });
});
