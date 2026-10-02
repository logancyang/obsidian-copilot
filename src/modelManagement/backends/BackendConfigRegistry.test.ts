import {
  getSettings,
  resetSettings,
  updateBackendDefaultModel,
  updateSetting,
} from "@/settings/model";

import { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { ProviderAdapterRegistry } from "@/modelManagement/providers/adapters/ProviderAdapterRegistry";
import type { BackendType } from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

import { BackendConfigRegistry } from "./BackendConfigRegistry";

import type { App } from "obsidian";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const CHAT: BackendType = "chat";
const OPENCODE: BackendType = "opencode";
const STORED_DEFAULT = { configuredModelId: "m2", effort: "high" };

describe("BackendConfigRegistry", () => {
  let registry: BackendConfigRegistry;
  let models: ConfiguredModelRegistry;
  let providers: ProviderRegistry;

  beforeEach(() => {
    resetSettings();
    const fakeApp = { secretStorage: {}, vault: { adapter: {} } } as unknown as App;
    providers = new ProviderRegistry(fakeApp, new ProviderAdapterRegistry());
    models = new ConfiguredModelRegistry();
    registry = new BackendConfigRegistry(providers, models);
  });

  async function seedStoredDefault(): Promise<void> {
    await registry.setEnabledModels(CHAT, ["m1", "m2"]);
    updateBackendDefaultModel(CHAT, STORED_DEFAULT);
  }

  describe("get()", () => {
    it("returns the same empty default for a backend that was never configured", () => {
      const a = registry.get(CHAT);
      const b = registry.get(CHAT);
      expect(a).toBe(b);
      expect(a.enabledModels).toEqual([]);
    });
  });

  describe("enableModel()", () => {
    it("appends models in the order they are enabled", async () => {
      await registry.enableModel(CHAT, "m1");
      await registry.enableModel(CHAT, "m2");
      await registry.enableModel(CHAT, "m3");
      expect(registry.get(CHAT).enabledModels).toEqual(["m1", "m2", "m3"]);
    });

    it("keeps a single entry when the same model is enabled twice", async () => {
      await registry.enableModel(CHAT, "m1");
      await registry.enableModel(CHAT, "m1");
      expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
    });

    it("keeps the stored default while appending (https://github.com/Brevilabs/obsidian-copilot-private/issues/540)", async () => {
      await seedStoredDefault();

      await registry.enableModel(CHAT, "m3");

      expect(registry.get(CHAT)).toEqual({
        enabledModels: ["m1", "m2", "m3"],
        default: STORED_DEFAULT,
      });
    });
  });

  describe("disableModel()", () => {
    it("removes the model and leaves the list unchanged when disabled again", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      await registry.disableModel(CHAT, "m2");
      expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
      await registry.disableModel(CHAT, "m2");
      expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
    });

    it("keeps the stored default when another model is turned off (https://github.com/Brevilabs/obsidian-copilot-private/issues/540)", async () => {
      await seedStoredDefault();

      await registry.disableModel(CHAT, "m1");

      expect(registry.get(CHAT)).toEqual({ enabledModels: ["m2"], default: STORED_DEFAULT });
    });
  });

  describe("setEnabledModels()", () => {
    it("does not notify or replace the backends slice when the ordered ids are identical", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      const listener = jest.fn();
      registry.subscribe(listener);
      const before = getSettings().backends;

      await registry.setEnabledModels(CHAT, ["m1", "m2"]);

      expect(listener).not.toHaveBeenCalled();
      expect(getSettings().backends).toBe(before);
    });

    it("notifies and stores the new order when the same ids are reordered", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      const listener = jest.fn();
      registry.subscribe(listener);

      await registry.setEnabledModels(CHAT, ["m2", "m1"]);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(registry.get(CHAT).enabledModels).toEqual(["m2", "m1"]);
    });

    it("keeps the stored default while replacing the list (https://github.com/Brevilabs/obsidian-copilot-private/issues/540)", async () => {
      await seedStoredDefault();

      await registry.setEnabledModels(CHAT, ["m2", "m1", "m3"]);

      expect(registry.get(CHAT)).toEqual({
        enabledModels: ["m2", "m1", "m3"],
        default: STORED_DEFAULT,
      });
    });
  });

  describe("removeRefs()", () => {
    it("removes the given model ids from every backend", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2", "m3"]);
      await registry.setEnabledModels(OPENCODE, ["m2", "m4"]);

      await registry.removeRefs(["m2", "m3"]);

      expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
      expect(registry.get(OPENCODE).enabledModels).toEqual(["m4"]);
    });

    it("leaves settings untouched when given no ids", async () => {
      await registry.setEnabledModels(CHAT, ["m1"]);
      const before = getSettings().backends;
      await registry.removeRefs([]);
      expect(getSettings().backends).toBe(before);
    });

    it("keeps the stored default of a backend whose other refs were swept (https://github.com/Brevilabs/obsidian-copilot-private/issues/540)", async () => {
      await seedStoredDefault();

      await registry.removeRefs(["m1"]);

      expect(registry.get(CHAT)).toEqual({ enabledModels: ["m2"], default: STORED_DEFAULT });
    });
  });

  describe("subscribe()", () => {
    it("notifies only for changes that mutate state and stops after unsubscribe", async () => {
      const listener = jest.fn();
      const unsubscribe = registry.subscribe(listener);

      await registry.enableModel(CHAT, "m1");
      expect(listener).toHaveBeenCalledTimes(1);

      await registry.enableModel(CHAT, "m1");
      expect(listener).toHaveBeenCalledTimes(1);

      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      expect(listener).toHaveBeenCalledTimes(2);

      await registry.disableModel(CHAT, "m2");
      expect(listener).toHaveBeenCalledTimes(3);

      await registry.disableModel(CHAT, "m99");
      expect(listener).toHaveBeenCalledTimes(3);

      await registry.removeRefs(["m1"]);
      expect(listener).toHaveBeenCalledTimes(4);

      await registry.removeRefs([]);
      await registry.removeRefs(["missing-id"]);
      expect(listener).toHaveBeenCalledTimes(4);

      unsubscribe();
      await registry.enableModel(OPENCODE, "x");
      expect(listener).toHaveBeenCalledTimes(4);
    });
  });

  describe("resolveEnabled()", () => {
    it("marks entries whose configured model exists as ok and the rest as broken", async () => {
      const providerId = await providers.add({
        providerType: "anthropic",
        displayName: "Anthropic",
        origin: { kind: "byok" },
      });
      const okId = await models.add({
        providerId,
        info: { id: "claude-sonnet-4-5", displayName: "Claude" },
      });
      await registry.setEnabledModels(CHAT, [okId, "missing-id"]);

      const resolved = registry.resolveEnabled(CHAT);
      expect(resolved).toHaveLength(2);
      expect(resolved[0].state).toBe("ok");
      expect(resolved[1].state).toBe("broken");
    });

    it("returns the same frozen empty list when no models are enabled", async () => {
      await registry.setEnabledModels(CHAT, []);
      updateSetting("enableSelfHostMode", true);

      const a = registry.resolveEnabled(CHAT);
      const b = registry.resolveEnabled(CHAT);
      expect(a).toHaveLength(0);
      expect(a).toBe(b);
    });

    describe("Self-Host Mode marking", () => {
      async function seedMixedBackend(backend: BackendType): Promise<{
        cloudId: string;
        localId: string;
      }> {
        const cloudProviderId = await providers.add({
          providerType: "anthropic",
          displayName: "Anthropic Cloud",
          baseUrl: "https://api.anthropic.com",
          origin: { kind: "byok" },
        });
        const localProviderId = await providers.add({
          providerType: "openai-compatible",
          displayName: "Local Ollama",
          baseUrl: "http://localhost:11434/v1",
          origin: { kind: "byok" },
        });
        const cloudId = await models.add({
          providerId: cloudProviderId,
          info: { id: "claude-sonnet-4-5", displayName: "Claude" },
        });
        const localId = await models.add({
          providerId: localProviderId,
          info: { id: "llama3", displayName: "Llama 3" },
        });
        await registry.setEnabledModels(backend, [cloudId, localId, "missing-id"]);
        return { cloudId, localId };
      }

      function warnings(resolved: readonly EnabledBackendEntry[]): Record<string, boolean> {
        const out: Record<string, boolean> = {};
        for (const e of resolved) {
          if (e.state === "ok") out[e.configuredModelId] = Boolean(e.needsSelfHostWarning);
        }
        return out;
      }

      it("keeps everything unflagged when Self-Host Mode is off", async () => {
        const { cloudId, localId } = await seedMixedBackend(CHAT);
        const resolved = registry.resolveEnabled(CHAT);
        expect(resolved.map((e) => e.configuredModelId)).toEqual([cloudId, localId, "missing-id"]);
        expect(warnings(resolved)).toEqual({ [cloudId]: false, [localId]: false });
      });

      it("keeps every entry in order, flags cloud BYOK only when on", async () => {
        const { cloudId, localId } = await seedMixedBackend(CHAT);
        updateSetting("enableSelfHostMode", true);

        const resolved = registry.resolveEnabled(CHAT);
        expect(resolved.map((e) => e.configuredModelId)).toEqual([cloudId, localId, "missing-id"]);
        expect(warnings(resolved)).toEqual({ [cloudId]: true, [localId]: false });
      });

      it("clears the flags when Self-Host Mode is turned back off (no writeback)", async () => {
        const { cloudId, localId } = await seedMixedBackend(CHAT);

        updateSetting("enableSelfHostMode", true);
        expect(warnings(registry.resolveEnabled(CHAT))[cloudId]).toBe(true);

        expect(registry.get(CHAT).enabledModels).toEqual([cloudId, localId, "missing-id"]);

        updateSetting("enableSelfHostMode", false);
        const resolved = registry.resolveEnabled(CHAT);
        expect(resolved.map((e) => e.configuredModelId)).toEqual([cloudId, localId, "missing-id"]);
        expect(warnings(resolved)[cloudId]).toBe(false);
      });
    });
  });
});
