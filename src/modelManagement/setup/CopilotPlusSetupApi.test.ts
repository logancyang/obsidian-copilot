/**
 * Tests for `CopilotPlusSetupApi` — the singleton Copilot Plus
 * provider/model enrollment + sign-out cascade.
 *
 * The injected deps are mocked as plain in-memory fakes (no real settings
 * store), mirroring `AgentSetupApi.test.ts`. They hold just enough state to
 * exercise create / idempotent-update / diff-reconcile / auto-enroll /
 * embedding-skip / sign-out-cascade.
 */

import { CopilotPlusSetupApi } from "./CopilotPlusSetupApi";

import type { ModelManagementCoordinator } from "@/modelManagement/createModelManagement";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { BackendType, ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

class FakeProviderRegistry {
  rows = new Map<string, Provider>();
  setApiKey = jest.fn(async (providerId: string, apiKey: string) => {
    const row = this.rows.get(providerId);
    if (row) {
      row.apiKeyKeychainId = `keychain-${providerId}`;
      void apiKey;
    }
  });

  add = jest.fn(async (input: Omit<Provider, "providerId" | "addedAt" | "apiKeyKeychainId">) => {
    const providerId = nextId("provider");
    this.rows.set(providerId, {
      ...input,
      providerId,
      addedAt: Date.now(),
      apiKeyKeychainId: null,
    });
    return providerId;
  });

  update = jest.fn(async (providerId: string, patch: Partial<Provider>) => {
    const existing = this.rows.get(providerId);
    if (!existing) throw new Error(`unknown providerId ${providerId}`);
    // Mirror the real registry: providerType/origin/keychain id immutable.
    const safe = { ...patch };
    delete (safe as Record<string, unknown>).providerType;
    delete (safe as Record<string, unknown>).origin;
    delete (safe as Record<string, unknown>).apiKeyKeychainId;
    this.rows.set(providerId, { ...existing, ...safe });
  });

  remove = jest.fn(async (providerId: string) => {
    this.rows.delete(providerId);
  });

  listByOrigin = jest.fn((kind: Provider["origin"]["kind"]) =>
    Array.from(this.rows.values()).filter((p) => p.origin.kind === kind)
  );

  get(providerId: string): Provider | undefined {
    return this.rows.get(providerId);
  }
}

class FakeConfiguredModelRegistry {
  rows: ConfiguredModel[] = [];

  add = jest.fn(async (input: { providerId: string; info: ModelInfo }) => {
    if (this.rows.some((m) => m.providerId === input.providerId && m.info.id === input.info.id)) {
      throw new Error(`duplicate (${input.providerId}, ${input.info.id})`);
    }
    const configuredModelId = nextId("model");
    this.rows.push({ ...input, configuredModelId, configuredAt: Date.now() });
    return configuredModelId;
  });

  update = jest.fn(async (configuredModelId: string, patch: { info?: Partial<ModelInfo> }) => {
    const row = this.rows.find((m) => m.configuredModelId === configuredModelId);
    if (!row) throw new Error(`unknown ${configuredModelId}`);
    if (patch.info) row.info = { ...row.info, ...patch.info };
  });

  remove = jest.fn(async (configuredModelId: string) => {
    this.rows = this.rows.filter((m) => m.configuredModelId !== configuredModelId);
  });

  removeByProvider = jest.fn(async (providerId: string) => {
    this.rows = this.rows.filter((m) => m.providerId !== providerId);
  });

  listByProvider = jest.fn((providerId: string) =>
    this.rows.filter((m) => m.providerId === providerId)
  );

  getByWireId = jest.fn((providerId: string, wireModelId: string) =>
    this.rows.find((m) => m.providerId === providerId && m.info.id === wireModelId)
  );
}

class FakeBackendConfigRegistry {
  enabled = new Map<BackendType, string[]>();

  enableModel = jest.fn(async (backend: BackendType, configuredModelId: string) => {
    const ids = this.enabled.get(backend) ?? [];
    if (!ids.includes(configuredModelId)) ids.push(configuredModelId);
    this.enabled.set(backend, ids);
  });

  removeRefs = jest.fn(async (configuredModelIds: readonly string[]) => {
    const drop = new Set(configuredModelIds);
    for (const [backend, ids] of this.enabled) {
      this.enabled.set(
        backend,
        ids.filter((id) => !drop.has(id))
      );
    }
  });

  enabledFor(backend: BackendType): string[] {
    return this.enabled.get(backend) ?? [];
  }
}

/** Coordinator fake mirroring the real cascades (refs → rows). */
class FakeCoordinator {
  constructor(
    private readonly providers: FakeProviderRegistry,
    private readonly backends: FakeBackendConfigRegistry,
    private readonly models: FakeConfiguredModelRegistry
  ) {}

  removeConfiguredModel = jest.fn(async (configuredModelId: string) => {
    await this.backends.removeRefs([configuredModelId]);
    await this.models.remove(configuredModelId);
  });

  removeProvider = jest.fn(async (providerId: string) => {
    const ids = this.models.listByProvider(providerId).map((m) => m.configuredModelId);
    await this.backends.removeRefs(ids);
    await this.models.removeByProvider(providerId);
    await this.providers.remove(providerId);
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

interface Harness {
  api: CopilotPlusSetupApi;
  providers: FakeProviderRegistry;
  models: FakeConfiguredModelRegistry;
  backends: FakeBackendConfigRegistry;
  coordinator: FakeCoordinator;
}

function makeHarness(): Harness {
  const providers = new FakeProviderRegistry();
  const models = new FakeConfiguredModelRegistry();
  const backends = new FakeBackendConfigRegistry();
  const coordinator = new FakeCoordinator(providers, backends, models);
  const api = new CopilotPlusSetupApi(
    providers as unknown as ProviderRegistry,
    models as unknown as ConfiguredModelRegistry,
    backends as unknown as BackendConfigRegistry,
    coordinator as unknown as ModelManagementCoordinator
  );
  return { api, providers, models, backends, coordinator };
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

beforeEach(() => {
  idCounter = 0;
});

// ---------------------------------------------------------------------------
// registerPlusProvider
// ---------------------------------------------------------------------------

describe("CopilotPlusSetupApi.registerPlusProvider", () => {
  it("creates one copilot-plus provider, stores the key, and auto-enrolls the chat model into chat + opencode", async () => {
    const h = makeHarness();
    const result = await register(h, [FLASH]);

    expect(h.providers.rows.size).toBe(1);
    const provider = h.providers.get(result.providerId)!;
    expect(provider.origin).toEqual({ kind: "copilot-plus" });
    expect(provider.providerType).toBe("openai-compatible");
    expect(provider.displayName).toBe("Copilot Plus");

    expect(h.providers.setApiKey).toHaveBeenCalledWith(result.providerId, "lic-key");

    expect(result.configuredModelIds).toHaveLength(1);
    const flashId = result.configuredModelIds[0];
    expect(h.backends.enabledFor("chat")).toEqual([flashId]);
    expect(h.backends.enabledFor("opencode")).toEqual([flashId]);
    expect(h.backends.enabledFor("claude")).toEqual([]);
    expect(h.backends.enabledFor("codex")).toEqual([]);
  });

  it("creates an embedding model but never enrolls it into a completion backend", async () => {
    const h = makeHarness();
    const result = await register(h, [FLASH, EMBEDDING]);

    expect(result.configuredModelIds).toHaveLength(2);
    const flashId = h.models.getByWireId(
      result.providerId,
      "copilot-plus-flash"
    )!.configuredModelId;
    const embeddingId = h.models.getByWireId(
      result.providerId,
      "copilot-plus-small"
    )!.configuredModelId;

    expect(h.backends.enabledFor("chat")).toEqual([flashId]);
    expect(h.backends.enabledFor("opencode")).toEqual([flashId]);
    expect(h.backends.enabledFor("chat")).not.toContain(embeddingId);
  });

  it("with autoEnrollModelIds, enrolls only the listed models; the rest are created but off", async () => {
    const h = makeHarness();
    const result = await h.api.registerPlusProvider({
      providerType: "openai-compatible",
      displayName: "Copilot Plus",
      baseUrl: "https://models.brevilabs.com/v1",
      apiKey: "lic-key",
      models: [FLASH, EXTRA],
      autoEnrollModelIds: [FLASH.id],
    });

    // Both models exist as ConfiguredModels...
    expect(result.configuredModelIds).toHaveLength(2);
    const flashId = h.models.getByWireId(result.providerId, FLASH.id)!.configuredModelId;
    const extraId = h.models.getByWireId(result.providerId, EXTRA.id)!.configuredModelId;
    expect(extraId).toBeDefined();

    // ...but only the listed flash model is enrolled into the pickers.
    expect(h.backends.enabledFor("chat")).toEqual([flashId]);
    expect(h.backends.enabledFor("opencode")).toEqual([flashId]);
    expect(h.backends.enabledFor("chat")).not.toContain(extraId);
    expect(h.backends.enabledFor("opencode")).not.toContain(extraId);
  });

  it("with autoEnrollModelIds, a newly-added model on re-sync stays off (existing curation preserved)", async () => {
    const h = makeHarness();
    // First sync: only flash exists and is enrolled.
    const first = await h.api.registerPlusProvider({
      providerType: "openai-compatible",
      displayName: "Copilot Plus",
      baseUrl: "https://models.brevilabs.com/v1",
      apiKey: "lic-key",
      models: [FLASH],
      autoEnrollModelIds: [FLASH.id],
    });
    const flashId = first.configuredModelIds[0];

    // Second sync introduces EXTRA, still not in the default-enabled set.
    await h.api.registerPlusProvider({
      providerType: "openai-compatible",
      displayName: "Copilot Plus",
      baseUrl: "https://models.brevilabs.com/v1",
      apiKey: "lic-key",
      models: [FLASH, EXTRA],
      autoEnrollModelIds: [FLASH.id],
    });

    const extraId = h.models.getByWireId(first.providerId, EXTRA.id)!.configuredModelId;
    expect(h.backends.enabledFor("opencode")).toEqual([flashId]);
    expect(h.backends.enabledFor("opencode")).not.toContain(extraId);
  });

  it("without autoEnrollModelIds, every non-embedding model auto-enrolls (prior behavior)", async () => {
    const h = makeHarness();
    const result = await register(h, [FLASH, EXTRA]);

    const flashId = h.models.getByWireId(result.providerId, FLASH.id)!.configuredModelId;
    const extraId = h.models.getByWireId(result.providerId, EXTRA.id)!.configuredModelId;
    expect(h.backends.enabledFor("opencode")).toEqual([flashId, extraId]);
    expect(h.backends.enabledFor("chat")).toEqual([flashId, extraId]);
  });

  it("does not call setApiKey when no key is supplied", async () => {
    const h = makeHarness();
    const result = await h.api.registerPlusProvider({
      providerType: "openai-compatible",
      displayName: "Copilot Plus",
      baseUrl: "https://models.brevilabs.com/v1",
      models: [FLASH],
    });
    expect(h.providers.setApiKey).not.toHaveBeenCalled();
    expect(h.providers.get(result.providerId)!.apiKeyKeychainId).toBeNull();
  });

  it("is idempotent: re-running updates in place, rotates the key, no duplicate provider/model", async () => {
    const h = makeHarness();
    const first = await register(h, [FLASH]);

    h.models.add.mockClear();
    h.backends.enableModel.mockClear();
    h.coordinator.removeConfiguredModel.mockClear();

    const second = await h.api.registerPlusProvider({
      providerType: "openai-compatible",
      displayName: "Copilot Plus (renamed)",
      baseUrl: "https://models.brevilabs.com/v1",
      apiKey: "rotated-key",
      models: [FLASH],
    });

    expect(second.providerId).toBe(first.providerId);
    expect(h.providers.rows.size).toBe(1);
    expect(h.providers.add).toHaveBeenCalledTimes(1);
    expect(h.providers.update).toHaveBeenCalledTimes(1);
    expect(h.providers.get(first.providerId)!.displayName).toBe("Copilot Plus (renamed)");
    expect(h.providers.setApiKey).toHaveBeenLastCalledWith(first.providerId, "rotated-key");

    expect(second.configuredModelIds).toEqual(first.configuredModelIds);
    // Unchanged model list → pure no-op reconcile.
    expect(h.models.add).not.toHaveBeenCalled();
    expect(h.backends.enableModel).not.toHaveBeenCalled();
    expect(h.coordinator.removeConfiguredModel).not.toHaveBeenCalled();
  });

  it("cascade-removes a model Plus no longer offers", async () => {
    const h = makeHarness();
    const first = await register(h, [FLASH, EMBEDDING]);
    const embeddingId = h.models.getByWireId(
      first.providerId,
      "copilot-plus-small"
    )!.configuredModelId;

    await register(h, [FLASH]); // embedding vanished

    expect(h.coordinator.removeConfiguredModel).toHaveBeenCalledWith(embeddingId);
    expect(h.models.getByWireId(first.providerId, "copilot-plus-small")).toBeUndefined();
    // Surviving chat model still enrolled.
    const flashId = h.models.getByWireId(first.providerId, "copilot-plus-flash")!.configuredModelId;
    expect(h.backends.enabledFor("opencode")).toContain(flashId);
  });

  it("refreshes a model's display string in place on re-register, preserving its id", async () => {
    const h = makeHarness();
    const first = await register(h, [FLASH]);
    const idBefore = first.configuredModelIds[0];

    await register(h, [{ ...FLASH, displayName: "Copilot Plus Flash 2" }]);

    const row = h.models.getByWireId(first.providerId, "copilot-plus-flash")!;
    expect(row.configuredModelId).toBe(idBefore);
    expect(row.info.displayName).toBe("Copilot Plus Flash 2");
  });

  it("refreshes drifted capability fields (reasoning/modalities/toolCall) in place", async () => {
    const h = makeHarness();
    // Existing model registered WITHOUT reasoning/modalities (an older snapshot).
    const first = await register(h, [{ id: "glm-5.2", displayName: "GLM-5.2", toolCall: false }]);
    const idBefore = first.configuredModelIds[0];
    expect(h.models.getByWireId(first.providerId, "glm-5.2")!.info.reasoning).toBeUndefined();

    // Re-register the same id with new capabilities — e.g. reasoning effort support.
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
    expect(row.configuredModelId).toBe(idBefore); // no churn
    expect(row.info.reasoning).toBe(true);
    expect(row.info.toolCall).toBe(true);
    expect(row.info.modalities).toEqual({ input: ["text"], output: ["text"] });
  });
});

// ---------------------------------------------------------------------------
// unregisterPlusProvider
// ---------------------------------------------------------------------------

describe("CopilotPlusSetupApi.unregisterPlusProvider", () => {
  it("cascade-removes the provider, its models, and backend refs", async () => {
    const h = makeHarness();
    const reg = await register(h, [FLASH]);
    const flashId = reg.configuredModelIds[0];

    await h.api.unregisterPlusProvider();

    expect(h.coordinator.removeProvider).toHaveBeenCalledWith(reg.providerId);
    expect(h.providers.rows.size).toBe(0);
    expect(h.models.rows).toHaveLength(0);
    expect(h.backends.enabledFor("chat")).not.toContain(flashId);
    expect(h.backends.enabledFor("opencode")).not.toContain(flashId);
  });

  it("is a no-op when no Plus provider exists", async () => {
    const h = makeHarness();
    await h.api.unregisterPlusProvider();
    expect(h.coordinator.removeProvider).not.toHaveBeenCalled();
  });
});
