import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

import { resolveChatBackendModel } from "./resolveChatBackendModel";

function provider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: id,
    providerType: "anthropic",
    displayName: id,
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

function okEntry(configuredModelId: string, prov: Provider): EnabledBackendEntry {
  const configuredModel: ConfiguredModel = {
    configuredModelId,
    providerId: prov.providerId,
    info: { id: `${configuredModelId}-wire`, displayName: configuredModelId },
    configuredAt: 0,
  };
  return { configuredModelId, state: "ok", configuredModel, provider: prov };
}

/** Minimal api stub exposing only what the resolver reads. */
function makeApi(
  entries: readonly EnabledBackendEntry[],
  keyByProvider: Record<string, string | null> = {}
): Pick<ModelManagementApi, "backendConfigRegistry" | "providerRegistry"> {
  return {
    backendConfigRegistry: {
      resolveEnabled: (backend: string) => (backend === "chat" ? entries : []),
    } as unknown as ModelManagementApi["backendConfigRegistry"],
    providerRegistry: {
      getApiKey: async (providerId: string) => keyByProvider[providerId] ?? null,
    } as unknown as ModelManagementApi["providerRegistry"],
  };
}

describe("resolveChatBackendModel", () => {
  it("resolves the preferred model when it is enabled", async () => {
    const p = provider("p1");
    const api = makeApi([okEntry("a", p), okEntry("b", p)], { p1: "key" });

    const result = await resolveChatBackendModel(api, "b");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.configuredModelId).toBe("b");
      expect(result.customModel.apiKey).toBe("key");
    }
  });

  it("falls back to the first enabled model when the preferred id is gone", async () => {
    const p = provider("p1");
    const api = makeApi([okEntry("a", p), okEntry("b", p)], { p1: "key" });

    const result = await resolveChatBackendModel(api, "stale-uuid");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.configuredModelId).toBe("a");
  });

  it("resolves a legacy name|provider selection", async () => {
    const p = provider("p1");
    const api = makeApi([okEntry("a", p)], { p1: "key" });

    const result = await resolveChatBackendModel(api, "a-wire|anthropic");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.configuredModelId).toBe("a");
  });

  it("falls back to the first enabled model when no preference is given", async () => {
    const p = provider("p1");
    const api = makeApi([okEntry("a", p)], { p1: "key" });

    const result = await resolveChatBackendModel(api, undefined);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.configuredModelId).toBe("a");
  });

  it("returns empty when nothing is enabled", async () => {
    const api = makeApi([]);
    const result = await resolveChatBackendModel(api, "anything");
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  it("skips broken refs and resolves the first ok entry", async () => {
    const p = provider("p1");
    const broken: EnabledBackendEntry = { configuredModelId: "x", state: "broken" };
    const api = makeApi([broken, okEntry("a", p)], { p1: "key" });

    const result = await resolveChatBackendModel(api, "x");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.configuredModelId).toBe("a");
  });
});
