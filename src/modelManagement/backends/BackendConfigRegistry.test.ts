/**
 * Tests for `BackendConfigRegistry`.
 *
 * Real settings store via `resetSettings`. The provider and configured-
 * model registries are constructed against the same store; no Obsidian
 * APIs are touched.
 */

import { getSettings, resetSettings, updateSetting } from "@/settings/model";

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

  it("get() returns a stable empty default for untouched backends", () => {
    const a = registry.get(CHAT);
    const b = registry.get(CHAT);
    expect(a).toBe(b);
    expect(a.enabledModels).toEqual([]);
  });

  it("enableModel() is idempotent", async () => {
    await registry.enableModel(CHAT, "m1");
    await registry.enableModel(CHAT, "m1");
    expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
  });

  it("enableModel() appends in order", async () => {
    await registry.enableModel(CHAT, "m1");
    await registry.enableModel(CHAT, "m2");
    await registry.enableModel(CHAT, "m3");
    expect(registry.get(CHAT).enabledModels).toEqual(["m1", "m2", "m3"]);
  });

  it("disableModel() is idempotent", async () => {
    await registry.setEnabledModels(CHAT, ["m1", "m2"]);
    await registry.disableModel(CHAT, "m2");
    expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
    // Idempotent.
    await registry.disableModel(CHAT, "m2");
    expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
  });

  it("removeRefs() sweeps every backend", async () => {
    await registry.setEnabledModels(CHAT, ["m1", "m2", "m3"]);
    await registry.setEnabledModels(OPENCODE, ["m2", "m4"]);

    await registry.removeRefs(["m2", "m3"]);

    expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
    expect(registry.get(OPENCODE).enabledModels).toEqual(["m4"]);
  });

  it("removeRefs() with empty input is a no-op", async () => {
    await registry.setEnabledModels(CHAT, ["m1"]);
    const before = getSettings().backends;
    await registry.removeRefs([]);
    expect(getSettings().backends).toBe(before);
  });

  describe("subscribe()", () => {
    it("fires on enable/disable/setEnabledModels/removeRefs that actually mutate", async () => {
      const listener = jest.fn();
      const unsubscribe = registry.subscribe(listener);

      await registry.enableModel(CHAT, "m1");
      expect(listener).toHaveBeenCalledTimes(1);

      // Idempotent enable: no settings change, no emit.
      await registry.enableModel(CHAT, "m1");
      expect(listener).toHaveBeenCalledTimes(1);

      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      expect(listener).toHaveBeenCalledTimes(2);

      await registry.disableModel(CHAT, "m2");
      expect(listener).toHaveBeenCalledTimes(3);

      // Idempotent disable on an absent id: no change, no emit.
      await registry.disableModel(CHAT, "m99");
      expect(listener).toHaveBeenCalledTimes(3);

      await registry.removeRefs(["m1"]);
      expect(listener).toHaveBeenCalledTimes(4);

      // Empty / no-match removeRefs: no change, no emit.
      await registry.removeRefs([]);
      await registry.removeRefs(["missing-id"]);
      expect(listener).toHaveBeenCalledTimes(4);

      unsubscribe();
      await registry.enableModel(OPENCODE, "x");
      expect(listener).toHaveBeenCalledTimes(4);
    });

    it("setEnabledModels() with the same ordered ids is a no-op (no emit, no slice rotation)", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      const listener = jest.fn();
      registry.subscribe(listener);
      const before = getSettings().backends;

      await registry.setEnabledModels(CHAT, ["m1", "m2"]);

      expect(listener).not.toHaveBeenCalled();
      expect(getSettings().backends).toBe(before);
    });

    it("setEnabledModels() with reordered ids is NOT a no-op (positional list)", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      const listener = jest.fn();
      registry.subscribe(listener);

      await registry.setEnabledModels(CHAT, ["m2", "m1"]);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(registry.get(CHAT).enabledModels).toEqual(["m2", "m1"]);
    });
  });

  it("resolveEnabled() returns ok entries when refs exist, broken otherwise", async () => {
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

  describe("resolveEnabled() Self-Host Mode marking", () => {
    /**
     * Enroll a cloud BYOK, a self-hosted BYOK, and a broken ref on `backend`.
     * Returns the two configured-model ids so callers can assert on order.
     */
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

    /** Map each ok entry's id → its `needsSelfHostWarning` flag. */
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

    it("keeps every entry in order, flags cloud BYOK only, when on", async () => {
      const { cloudId, localId } = await seedMixedBackend(CHAT);
      updateSetting("enableSelfHostMode", true);

      const resolved = registry.resolveEnabled(CHAT);
      // Order preserved (nothing dropped); cloud flagged, self-hosted + broken not.
      expect(resolved.map((e) => e.configuredModelId)).toEqual([cloudId, localId, "missing-id"]);
      expect(warnings(resolved)).toEqual({ [cloudId]: true, [localId]: false });
    });

    // #4 no-bypass INVERTED: Self-Host Mode is a presentation label, not a
    // technical egress block. The opencode runtime injection reads
    // resolveEnabled("opencode"), and a cloud provider now DOES reach the
    // spawned config (still in order) — only flagged for the UI, not filtered.
    it("keeps cloud providers reachable for the opencode runtime injection", async () => {
      const { cloudId, localId } = await seedMixedBackend(OPENCODE);
      updateSetting("enableSelfHostMode", true);

      const resolved = registry.resolveEnabled(OPENCODE);
      expect(resolved.map((e) => e.configuredModelId)).toEqual([cloudId, localId, "missing-id"]);
      expect(warnings(resolved)).toEqual({ [cloudId]: true, [localId]: false });
    });

    it("clears the flags when Self-Host Mode is turned back off (no writeback)", async () => {
      const { cloudId, localId } = await seedMixedBackend(CHAT);

      updateSetting("enableSelfHostMode", true);
      expect(warnings(registry.resolveEnabled(CHAT))[cloudId]).toBe(true);

      // View-layer only: the persisted enabledModels was never rewritten.
      expect(registry.get(CHAT).enabledModels).toEqual([cloudId, localId, "missing-id"]);

      updateSetting("enableSelfHostMode", false);
      const resolved = registry.resolveEnabled(CHAT);
      expect(resolved.map((e) => e.configuredModelId)).toEqual([cloudId, localId, "missing-id"]);
      expect(warnings(resolved)[cloudId]).toBe(false);
    });

    it("returns the frozen empty constant when no models are enabled", async () => {
      await registry.setEnabledModels(CHAT, []);
      updateSetting("enableSelfHostMode", true);

      const a = registry.resolveEnabled(CHAT);
      const b = registry.resolveEnabled(CHAT);
      expect(a).toHaveLength(0);
      expect(a).toBe(b); // Same frozen reference (referential stability).
    });
  });
});
