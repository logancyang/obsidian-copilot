/**
 * Tests for `AgentSetupApi` (M2 — agent-origin provider/model enrollment).
 *
 * The 5 injected deps are mocked as plain in-memory fakes / jest.fns —
 * no real settings store. Each fake holds just enough state to exercise
 * the create / idempotent-update / diff-reconcile / auto-enroll / cascade
 * paths and to assert the observable effects.
 */

import { AgentSetupApi } from "./AgentSetupApi";

import type { CatalogDownloadService } from "@/modelManagement/catalog/CatalogDownloadService";
import type { ModelManagementCoordinator } from "@/modelManagement/createModelManagement";
import type { CatalogProvider, ModelInfo } from "@/modelManagement/types/catalog";
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

/** Minimal ProviderRegistry fake — Map-backed, tracks setApiKey calls. */
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

  listByOrigin = jest.fn((kind: Provider["origin"]["kind"]) =>
    Array.from(this.rows.values()).filter((p) => p.origin.kind === kind)
  );

  get(providerId: string): Provider | undefined {
    return this.rows.get(providerId);
  }
}

/** Minimal ConfiguredModelRegistry fake — array-backed. */
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

  listByProvider = jest.fn((providerId: string) =>
    this.rows.filter((m) => m.providerId === providerId)
  );

  getByWireId = jest.fn((providerId: string, wireModelId: string) =>
    this.rows.find((m) => m.providerId === providerId && m.info.id === wireModelId)
  );

  get(configuredModelId: string): ConfiguredModel | undefined {
    return this.rows.find((m) => m.configuredModelId === configuredModelId);
  }
}

/** Minimal BackendConfigRegistry fake — per-backend enabled-id sets. */
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

/** Coordinator fake mirroring the real cascade: refs then row. */
class FakeCoordinator {
  constructor(
    private readonly backends: FakeBackendConfigRegistry,
    private readonly models: FakeConfiguredModelRegistry
  ) {}

  removeConfiguredModel = jest.fn(async (configuredModelId: string) => {
    await this.backends.removeRefs([configuredModelId]);
    await this.models.remove(configuredModelId);
  });
}

/** Catalog fake — returns a fixed provider list keyed by providerType. */
function makeCatalog(providers: CatalogProvider[]): {
  service: CatalogDownloadService;
  ensureLoaded: jest.Mock;
} {
  const ensureLoaded = jest.fn(async () => {});
  const service = {
    ensureLoaded,
    getAllProviders: () => providers,
  } as unknown as CatalogDownloadService;
  return { service, ensureLoaded };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLAUDE_CATALOG: CatalogProvider = {
  id: "anthropic",
  displayName: "Anthropic",
  providerType: "anthropic",
  models: {
    "claude-sonnet-4-5": {
      id: "claude-sonnet-4-5",
      displayName: "Claude Sonnet 4.5",
      reasoning: true,
    },
    "claude-opus-4-5": { id: "claude-opus-4-5", displayName: "Claude Opus 4.5" },
  },
};

const GOOGLE_CATALOG: CatalogProvider = {
  id: "google",
  displayName: "Google",
  providerType: "google",
  models: {
    "gemini-2-5-pro": { id: "gemini-2-5-pro", displayName: "Gemini 2.5 Pro" },
    "gemini-2-5-flash": { id: "gemini-2-5-flash", displayName: "Gemini 2.5 Flash" },
  },
};

interface Harness {
  api: AgentSetupApi;
  providers: FakeProviderRegistry;
  models: FakeConfiguredModelRegistry;
  backends: FakeBackendConfigRegistry;
  coordinator: FakeCoordinator;
  ensureLoaded: jest.Mock;
}

function makeHarness(catalogProviders: CatalogProvider[] = [CLAUDE_CATALOG]): Harness {
  const providers = new FakeProviderRegistry();
  const models = new FakeConfiguredModelRegistry();
  const backends = new FakeBackendConfigRegistry();
  const coordinator = new FakeCoordinator(backends, models);
  const { service, ensureLoaded } = makeCatalog(catalogProviders);
  const api = new AgentSetupApi(
    providers as unknown as ProviderRegistry,
    models as unknown as ConfiguredModelRegistry,
    backends as unknown as BackendConfigRegistry,
    service,
    coordinator as unknown as ModelManagementCoordinator
  );
  return { api, providers, models, backends, coordinator, ensureLoaded };
}

beforeEach(() => {
  idCounter = 0;
});

// ---------------------------------------------------------------------------
// registerAgentProvider
// ---------------------------------------------------------------------------

describe("AgentSetupApi.registerAgentProvider", () => {
  it("creates exactly one agent-origin provider, N models, all enrolled into the agent backend only", async () => {
    const h = makeHarness();
    const result = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
    });

    // One provider, correct origin.
    expect(h.providers.rows.size).toBe(1);
    const provider = h.providers.get(result.providerId)!;
    expect(provider.origin).toEqual({ kind: "agent", agentType: "claude" });
    expect(provider.providerType).toBe("anthropic");
    expect(provider.displayName).toBe("Claude Code");

    // Two ConfiguredModels.
    expect(result.configuredModelIds).toHaveLength(2);
    expect(
      h.models
        .listByProvider(result.providerId)
        .map((m) => m.info.id)
        .sort()
    ).toEqual(["claude-opus-4-5", "claude-sonnet-4-5"]);

    // Enrolled into backends["claude"] only — not chat or other agents.
    expect(h.backends.enabledFor("claude").sort()).toEqual([...result.configuredModelIds].sort());
    expect(h.backends.enabledFor("chat")).toEqual([]);
    expect(h.backends.enabledFor("opencode")).toEqual([]);
    expect(h.backends.enabledFor("codex")).toEqual([]);
  });

  it("lets the agent-reported name + description win over catalog metadata", async () => {
    const h = makeHarness();
    // Catalog knows "claude-sonnet-4-5" as "Claude Sonnet 4.5"; the agent's
    // own name/description must override so settings match the chat picker.
    const result = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5"],
      fallbackDisplayNames: { "claude-sonnet-4-5": "Sonnet" },
      fallbackDescriptions: { "claude-sonnet-4-5": "Sonnet 4.6 · Best for everyday tasks" },
    });
    const info = h.models.listByProvider(result.providerId)[0].info;
    expect(info.displayName).toBe("Sonnet");
    expect(info.description).toBe("Sonnet 4.6 · Best for everyday tasks");
  });

  it("uses the fallback name + description for wire ids the catalog doesn't know", async () => {
    const h = makeHarness();
    const result = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["default"],
      fallbackDisplayNames: { default: "Default (recommended)" },
      fallbackDescriptions: { default: "Opus 4.7 with 1M context · Most capable for complex work" },
    });
    const info = h.models.listByProvider(result.providerId)[0].info;
    expect(info.id).toBe("default");
    expect(info.displayName).toBe("Default (recommended)");
    expect(info.description).toBe("Opus 4.7 with 1M context · Most capable for complex work");
  });

  it("refreshes an existing model's display strings on re-register, preserving its id", async () => {
    const h = makeHarness();
    const first = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["default"],
      fallbackDisplayNames: { default: "default" }, // stale, pre-feature label
    });
    const idBefore = h.models.listByProvider(first.providerId)[0].configuredModelId;

    await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["default"],
      fallbackDisplayNames: { default: "Default (recommended)" },
      fallbackDescriptions: { default: "Opus 4.7 with 1M context · Most capable for complex work" },
    });

    const row = h.models.listByProvider(first.providerId)[0];
    // Same row (enabled-set refs don't churn), refreshed strings.
    expect(row.configuredModelId).toBe(idBefore);
    expect(row.info.displayName).toBe("Default (recommended)");
    expect(row.info.description).toBe("Opus 4.7 with 1M context · Most capable for complex work");
  });

  it("is idempotent on (agentType, providerType): re-running updates in place, no duplicate provider", async () => {
    const h = makeHarness();
    const first = await h.api.registerAgentProvider({
      agentType: "codex",
      providerType: "openai-compatible",
      displayName: "Codex",
      apiKey: null,
      wireModelIds: ["gpt-5"],
      fallbackDisplayNames: { "gpt-5": "GPT-5" },
    });

    // Clear the model-mutation spies so the second run's call counts
    // reflect only what the identical re-register triggers.
    h.models.add.mockClear();
    h.backends.enableModel.mockClear();
    h.coordinator.removeConfiguredModel.mockClear();

    const second = await h.api.registerAgentProvider({
      agentType: "codex",
      providerType: "openai-compatible",
      displayName: "Codex CLI", // changed label
      apiKey: null,
      wireModelIds: ["gpt-5"],
      fallbackDisplayNames: { "gpt-5": "GPT-5" },
    });

    expect(second.providerId).toBe(first.providerId);
    expect(h.providers.rows.size).toBe(1);
    expect(h.providers.add).toHaveBeenCalledTimes(1);
    expect(h.providers.update).toHaveBeenCalledTimes(1);
    expect(h.providers.get(first.providerId)!.displayName).toBe("Codex CLI");
    // Same single model, same id preserved.
    expect(second.configuredModelIds).toEqual(first.configuredModelIds);
    // Idempotent model reconcile: an unchanged wire-id list is a pure
    // no-op — no add, no re-enroll, no cascade-remove ("only real
    // add/remove deltas write settings", per the risk table).
    expect(h.models.add).not.toHaveBeenCalled();
    expect(h.backends.enableModel).not.toHaveBeenCalled();
    expect(h.coordinator.removeConfiguredModel).not.toHaveBeenCalled();
  });

  it("adds a newly-reported wire id (new model enrolled) and preserves existing rows' ids + enable state", async () => {
    const h = makeHarness();
    const first = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5"],
    });
    const sonnetId = first.configuredModelIds[0];

    // Simulate user disabling/curating: leave enable state as-is and re-run
    // with an extra reported model.
    const second = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
    });

    // Existing row kept its id.
    expect(second.configuredModelIds).toContain(sonnetId);
    expect(h.models.getByWireId(first.providerId, "claude-sonnet-4-5")!.configuredModelId).toBe(
      sonnetId
    );
    // New row added + enrolled.
    const opusId = h.models.getByWireId(first.providerId, "claude-opus-4-5")!.configuredModelId;
    expect(opusId).toBeDefined();
    expect(h.backends.enabledFor("claude")).toContain(opusId);
    // Only the genuinely-new id triggered an add.
    expect(h.models.add).toHaveBeenCalledTimes(2);
  });

  it("cascade-removes a vanished wire id (model removed + backend refs dropped via coordinator)", async () => {
    const h = makeHarness();
    const first = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
    });
    const opusId = h.models.getByWireId(first.providerId, "claude-opus-4-5")!.configuredModelId;

    await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5"], // opus vanished
    });

    expect(h.coordinator.removeConfiguredModel).toHaveBeenCalledWith(opusId);
    expect(h.models.getByWireId(first.providerId, "claude-opus-4-5")).toBeUndefined();
    expect(h.backends.enabledFor("claude")).not.toContain(opusId);
    // Surviving model still enrolled.
    const sonnetId = h.models.getByWireId(first.providerId, "claude-sonnet-4-5")!.configuredModelId;
    expect(h.backends.enabledFor("claude")).toContain(sonnetId);
  });

  it("does not call setApiKey for CLI-managed agents (apiKey: null) — keychain id stays null", async () => {
    const h = makeHarness();
    const result = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5"],
    });
    expect(h.providers.setApiKey).not.toHaveBeenCalled();
    expect(h.providers.get(result.providerId)!.apiKeyKeychainId).toBeNull();
  });

  it("calls setApiKey when a key is supplied (subscription-style agent)", async () => {
    const h = makeHarness();
    const result = await h.api.registerAgentProvider({
      agentType: "opencode",
      providerType: "anthropic",
      displayName: "OpenCode",
      apiKey: "sk-agent",
      wireModelIds: ["claude-sonnet-4-5"],
    });
    expect(h.providers.setApiKey).toHaveBeenCalledWith(result.providerId, "sk-agent");
    expect(h.providers.get(result.providerId)!.apiKeyKeychainId).toBeTruthy();
  });

  it("enriches info from the catalog on a hit and falls back on a miss", async () => {
    const h = makeHarness();
    const result = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5", "unknown-model"],
      fallbackDisplayNames: { "unknown-model": "Unknown Model" },
    });

    const hit = h.models.getByWireId(result.providerId, "claude-sonnet-4-5")!;
    // Full catalog metadata copied onto the snapshot.
    expect(hit.info.displayName).toBe("Claude Sonnet 4.5");
    expect(hit.info.reasoning).toBe(true);

    const miss = h.models.getByWireId(result.providerId, "unknown-model")!;
    expect(miss.info).toEqual({ id: "unknown-model", displayName: "Unknown Model" });
  });

  it("falls back to the bare wire id when there is no catalog hit and no fallback name", async () => {
    const h = makeHarness();
    const result = await h.api.registerAgentProvider({
      agentType: "codex",
      providerType: "openai-compatible",
      displayName: "Codex",
      apiKey: null,
      wireModelIds: ["o4-mini"],
    });
    const row = h.models.getByWireId(result.providerId, "o4-mini")!;
    expect(row.info).toEqual({ id: "o4-mini", displayName: "o4-mini" });
  });

  it("still snapshots every wire id when the catalog is unreachable", async () => {
    // Unreachable catalog: ensureLoaded throws AND memory is empty (no
    // providers ever loaded), so enrichment must fall back per wire id.
    const h = makeHarness([]);
    h.ensureLoaded.mockRejectedValueOnce(new Error("offline"));
    const result = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5"],
      fallbackDisplayNames: { "claude-sonnet-4-5": "Sonnet (fallback)" },
    });
    // Catalog enrichment failed → fallback used, but the model still exists.
    const row = h.models.getByWireId(result.providerId, "claude-sonnet-4-5")!;
    expect(row.info).toEqual({ id: "claude-sonnet-4-5", displayName: "Sonnet (fallback)" });
    expect(h.backends.enabledFor("claude")).toContain(row.configuredModelId);
  });
});

// ---------------------------------------------------------------------------
// syncAgentModels
// ---------------------------------------------------------------------------

describe("AgentSetupApi.syncAgentModels", () => {
  it("no-ops when no agent provider exists for the agentType", async () => {
    const h = makeHarness();
    const result = await h.api.syncAgentModels({
      agentType: "claude",
      wireModelIds: ["claude-sonnet-4-5"],
    });
    expect(result).toEqual({ added: [], removed: [] });
    expect(h.models.add).not.toHaveBeenCalled();
    expect(h.providers.add).not.toHaveBeenCalled();
  });

  it("reconciles models without touching the provider row", async () => {
    const h = makeHarness();
    const reg = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5"],
    });
    const sonnetId = reg.configuredModelIds[0];

    h.providers.add.mockClear();
    h.providers.update.mockClear();

    const result = await h.api.syncAgentModels({
      agentType: "claude",
      wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
    });

    // Provider row untouched.
    expect(h.providers.add).not.toHaveBeenCalled();
    expect(h.providers.update).not.toHaveBeenCalled();

    // New model added but left DISABLED; existing one preserved + still enabled.
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    const opusId = h.models.getByWireId(reg.providerId, "claude-opus-4-5")!.configuredModelId;
    expect(result.added).toEqual([opusId]);
    expect(h.backends.enabledFor("claude")).toEqual([sonnetId]);
    expect(h.backends.enabledFor("claude")).not.toContain(opusId);
  });

  it("leaves every model a later probe introduces disabled (only the seeded one stays on)", async () => {
    // Mirrors opencode's first→follow-up flow: enrollment seeds one model, then
    // a later probe floods in many more — none of which should turn themselves on.
    const h = makeHarness();
    const reg = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5"],
    });
    const sonnetId = reg.configuredModelIds[0];

    await h.api.syncAgentModels({
      agentType: "claude",
      wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
    });

    // The enabled set is unchanged: still just the seeded model.
    expect(h.backends.enabledFor("claude")).toEqual([sonnetId]);
    // ...even though both new models now exist as configured (toggleable) rows.
    expect(h.models.getByWireId(reg.providerId, "claude-opus-4-5")).toBeDefined();
    expect(h.models.getByWireId(reg.providerId, "claude-haiku-4-5")).toBeDefined();
  });

  it("cascade-removes a vanished model on sync", async () => {
    const h = makeHarness();
    const reg = await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
    });
    const opusId = h.models.getByWireId(reg.providerId, "claude-opus-4-5")!.configuredModelId;

    const result = await h.api.syncAgentModels({
      agentType: "claude",
      wireModelIds: ["claude-sonnet-4-5"],
    });

    expect(result.removed).toEqual([opusId]);
    expect(h.coordinator.removeConfiguredModel).toHaveBeenCalledWith(opusId);
    expect(h.models.getByWireId(reg.providerId, "claude-opus-4-5")).toBeUndefined();
  });

  it("is a pure no-op when the reported list is unchanged", async () => {
    const h = makeHarness();
    await h.api.registerAgentProvider({
      agentType: "claude",
      providerType: "anthropic",
      displayName: "Claude Code",
      apiKey: null,
      wireModelIds: ["claude-sonnet-4-5"],
    });
    h.models.add.mockClear();
    h.coordinator.removeConfiguredModel.mockClear();

    const result = await h.api.syncAgentModels({
      agentType: "claude",
      wireModelIds: ["claude-sonnet-4-5"],
    });

    expect(result).toEqual({ added: [], removed: [] });
    expect(h.models.add).not.toHaveBeenCalled();
    expect(h.coordinator.removeConfiguredModel).not.toHaveBeenCalled();
  });

  it("multi-provider: partitions wire ids per owning provider without corrupting another provider's list", async () => {
    // opencode with two agent providers (anthropic + google). A later
    // sync drops one model from each provider's owned set and reports an
    // unowned wire id; the unowned id must NOT be added (no providerType
    // to resolve it), and neither provider's surviving model is touched.
    const h = makeHarness([CLAUDE_CATALOG, GOOGLE_CATALOG]);
    const anthropic = await h.api.registerAgentProvider({
      agentType: "opencode",
      providerType: "anthropic",
      displayName: "OpenCode (Anthropic)",
      apiKey: "sk-a",
      wireModelIds: ["claude-sonnet-4-5", "claude-opus-4-5"],
    });
    const google = await h.api.registerAgentProvider({
      agentType: "opencode",
      providerType: "google",
      displayName: "OpenCode (Google)",
      apiKey: "sk-g",
      wireModelIds: ["gemini-2-5-pro", "gemini-2-5-flash"],
    });

    const opusId = h.models.getByWireId(anthropic.providerId, "claude-opus-4-5")!.configuredModelId;
    const flashId = h.models.getByWireId(google.providerId, "gemini-2-5-flash")!.configuredModelId;
    const sonnetId = h.models.getByWireId(
      anthropic.providerId,
      "claude-sonnet-4-5"
    )!.configuredModelId;
    const proId = h.models.getByWireId(google.providerId, "gemini-2-5-pro")!.configuredModelId;

    h.models.add.mockClear();

    // Report: each provider keeps one model; opus + flash vanish; an
    // unowned wire id ("mystery-model") is reported but belongs to no
    // existing provider.
    const result = await h.api.syncAgentModels({
      agentType: "opencode",
      wireModelIds: ["claude-sonnet-4-5", "gemini-2-5-pro", "mystery-model"],
    });

    // Both vanished models cascade-removed, scoped to their own provider.
    expect(result.removed.sort()).toEqual([opusId, flashId].sort());
    expect(h.coordinator.removeConfiguredModel).toHaveBeenCalledWith(opusId);
    expect(h.coordinator.removeConfiguredModel).toHaveBeenCalledWith(flashId);
    // Unowned wire id is NOT enrolled (no providerType to place it).
    expect(result.added).toEqual([]);
    expect(h.models.add).not.toHaveBeenCalled();
    // Each surviving model is preserved on its own provider; no cross-
    // provider corruption.
    expect(h.models.getByWireId(anthropic.providerId, "claude-sonnet-4-5")!.configuredModelId).toBe(
      sonnetId
    );
    expect(h.models.getByWireId(google.providerId, "gemini-2-5-pro")!.configuredModelId).toBe(
      proId
    );
    expect(h.backends.enabledFor("opencode").sort()).toEqual([sonnetId, proId].sort());
  });
});
