/**
 * Tests for the M3 probe-settle discovery orchestrator.
 *
 * The Agent Mode barrel (`@/agentMode`) and the settings module are mocked so
 * the test exercises `wireAgentModelDiscovery` / `enrollBackend` against
 * controllable fakes without dragging in the React/Obsidian dependency tree.
 * The barrel helpers (`partitionOpencodeOnlyWireIds`,
 * `mapProviderToOpencodeId`) are re-implemented thinly in the mock to keep the
 * orchestration assertions independent of their unit tests;
 * `buildManagedOpencodeProviderIds` now lives in this module and is tested for
 * real below.
 */

import type { ModelManagementApi, Provider, ProviderOrigin } from "@/modelManagement";
import type CopilotPlugin from "@/main";
import type { AgentSessionManager, BackendDescriptor } from "@/agentMode";
import { logInfo } from "@/logger";
import { waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockDescriptors: BackendDescriptor[] = [];

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/agentMode", () => ({
  listBackendDescriptors: () => mockDescriptors,
  // Real-equivalent pure helpers.
  partitionOpencodeOnlyWireIds: (reported: string[], managed: Set<string>) =>
    reported.filter((w) => !managed.has(w.split("/")[0])),
  mapProviderToOpencodeId: (provider: {
    providerId: string;
    origin: { kind: string; catalogProviderId?: string };
  }) => {
    switch (provider.origin.kind) {
      case "byok":
        return provider.origin.catalogProviderId
          ? { id: provider.origin.catalogProviderId, native: false }
          : null;
      case "copilot-plus":
        return { id: "copilot-plus", native: false };
      case "agent":
        return { id: provider.providerId, native: true };
      default:
        return null;
    }
  },
}));

// Import AFTER mocks so the module under test binds to them.
import { buildManagedOpencodeProviderIds, wireAgentModelDiscovery } from "./agentModelDiscovery";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const mockedLogInfo = jest.mocked(logInfo);
type ModelCatalog = NonNullable<ReturnType<AgentSessionManager["getCachedModelCatalog"]>>;
const identityWire = {
  encode: (s: { baseModelId: string }) => s.baseModelId,
  decode: (wireId: string) => ({
    selection: { baseModelId: wireId, effort: null as string | null },
    provider: null as string | null,
  }),
};

function makeDescriptor(partial: Partial<BackendDescriptor>): BackendDescriptor {
  return {
    id: "codex",
    displayName: "Codex",
    wire: identityWire,
    ...partial,
  } as unknown as BackendDescriptor;
}

/** Probe-owned catalog with a settled model list of the given wire baseModelIds. */
function catalogWithModels(baseIds: string[]): ModelCatalog {
  return {
    availableModels: baseIds.map((baseModelId) => ({
      baseModelId,
      name: baseModelId,
      provider: null,
      effortOptions: [],
    })),
  };
}

interface ApiFake {
  api: ModelManagementApi;
  agentProviders: Array<{ providerId: string; origin: { kind: string; agentType: string } }>;
  byok: Array<{ origin: { kind: string; catalogProviderId?: string } }>;
  plus: Array<{ origin: { kind: string } }>;
  registerAgentProvider: jest.Mock;
  syncAgentModels: jest.Mock;
  setEnabledModels: jest.Mock;
}

function makeApiFake(): ApiFake {
  const agentProviders: ApiFake["agentProviders"] = [];
  const byok: ApiFake["byok"] = [];
  const plus: ApiFake["plus"] = [];

  // registerAgentProvider returns configuredModelIds in wireModelIds order and
  // records an agent provider so the next probe takes the sync branch.
  const registerAgentProvider = jest.fn(
    async (input: { agentType: string; wireModelIds: string[] }) => {
      const providerId = `prov-${input.agentType}`;
      agentProviders.push({ providerId, origin: { kind: "agent", agentType: input.agentType } });
      return {
        providerId,
        configuredModelIds: input.wireModelIds.map((_w, i) => `cm-${input.agentType}-${i}`),
      };
    }
  );
  const syncAgentModels = jest.fn(async () => ({ added: [], removed: [] }));
  const setEnabledModels = jest.fn(async () => {});

  const api = {
    providerRegistry: {
      listByOrigin: (kind: string) => {
        if (kind === "agent") return agentProviders;
        if (kind === "byok") return byok;
        if (kind === "copilot-plus") return plus;
        return [];
      },
    },
    setup: { agent: { registerAgentProvider, syncAgentModels } },
    backendConfigRegistry: { setEnabledModels },
  } as unknown as ModelManagementApi;

  return {
    api,
    agentProviders,
    byok,
    plus,
    registerAgentProvider,
    syncAgentModels,
    setEnabledModels,
  };
}

interface ManagerFake {
  manager: AgentSessionManager;
  setCatalog: (backendId: string, catalog: ModelCatalog | null) => void;
  emit: () => void;
}

function makeManagerFake(): ManagerFake {
  const catalogs = new Map<string, ModelCatalog | null>();
  let listener: (() => void) | null = null;
  const manager = {
    getCachedModelCatalog: (id: string) => catalogs.get(id) ?? null,
    subscribeModelCache: (cb: () => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  } as unknown as AgentSessionManager;
  return {
    manager,
    setCatalog: (id, catalog) => catalogs.set(id, catalog),
    emit: () => listener?.(),
  };
}

function makePlugin(api: ModelManagementApi): CopilotPlugin {
  return { modelManagement: api } as unknown as CopilotPlugin;
}

async function waitForDiscoveryLog(message: string): Promise<void> {
  await waitFor(() => expect(mockedLogInfo).toHaveBeenCalledWith(expect.stringContaining(message)));
}

beforeEach(() => {
  mockDescriptors = [];
  mockedLogInfo.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wireAgentModelDiscovery", () => {
  it("first enrollment registers a provider and enrolls reported models", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setCatalog("codex", catalogWithModels(["gpt-5", "gpt-5.5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("first enrollment for codex");

    expect(a.registerAgentProvider).toHaveBeenCalledTimes(1);
    expect(a.registerAgentProvider.mock.calls[0][0]).toMatchObject({
      agentType: "codex",
      providerType: "openai-compatible",
      wireModelIds: ["gpt-5", "gpt-5.5"],
    });
    expect(a.syncAgentModels).not.toHaveBeenCalled();
    expect(a.setEnabledModels).not.toHaveBeenCalled();
    unsub();
  });

  it("omits a reported empty name from fallbackDisplayNames (never overwrites with '')", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setCatalog("codex", {
      availableModels: [
        { baseModelId: "gpt-5", name: "GPT-5", provider: null, effortOptions: [] },
        { baseModelId: "blank", name: "", provider: null, effortOptions: [] },
      ],
    });

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("first enrollment for codex");

    // "blank" is still enrolled (it's a real wire id) but contributes no
    // display-name fallback, so resolution falls back to catalog/id instead.
    expect(a.registerAgentProvider.mock.calls[0][0].fallbackDisplayNames).toEqual({
      "gpt-5": "GPT-5",
    });
    unsub();
  });

  it("leaves autoEnrollModelIds unset for codex so its whole catalog starts enabled", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const a = makeApiFake();
    const catalog = catalogWithModels(["gpt-5", "gpt-5.5"]);
    const manager = {
      getCachedModelCatalog: jest.fn(() => catalog),
      subscribeModelCache: jest.fn(() => () => {}),
    } as unknown as AgentSessionManager;

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), manager);
    await waitForDiscoveryLog("first enrollment for codex");
    expect(a.registerAgentProvider.mock.calls[0][0].wireModelIds).toEqual(["gpt-5", "gpt-5.5"]);
    expect(a.registerAgentProvider.mock.calls[0][0].autoEnrollModelIds).toBeUndefined();
    expect(a.setEnabledModels).not.toHaveBeenCalled();
    unsub();
  });

  it("enrolls every remaining OpenCode model after managed-provider suppression", async () => {
    mockDescriptors = [makeDescriptor({ id: "opencode" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    a.byok.push({ origin: { kind: "byok", catalogProviderId: "anthropic" } });
    m.setCatalog(
      "opencode",
      catalogWithModels([
        "anthropic/claude-sonnet-4-5",
        "opencode/big-pickle",
        "opencode/small-gherkin",
      ])
    );

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("first enrollment for opencode");

    expect(a.registerAgentProvider.mock.calls[0][0].wireModelIds).toEqual([
      "opencode/big-pickle",
      "opencode/small-gherkin",
    ]);
    expect(a.setEnabledModels).not.toHaveBeenCalled();
    unsub();
  });

  it("enables only the first three OpenCode models while enrolling the rest", async () => {
    mockDescriptors = [makeDescriptor({ id: "opencode" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setCatalog(
      "opencode",
      catalogWithModels([
        "opencode/big-pickle",
        "opencode/claude-fable-5",
        "opencode/claude-haiku-4-5",
        "opencode/claude-opus-4-1",
        "opencode/small-gherkin",
      ])
    );

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("first enrollment for opencode");

    const input = a.registerAgentProvider.mock.calls[0][0];
    // Every model is still enrolled, so the curation UI can list all five.
    expect(input.wireModelIds).toHaveLength(5);
    expect(input.autoEnrollModelIds).toEqual([
      "opencode/big-pickle",
      "opencode/claude-fable-5",
      "opencode/claude-haiku-4-5",
    ]);
    unsub();
  });

  it("enables every OpenCode model when fewer than three survive suppression", async () => {
    mockDescriptors = [makeDescriptor({ id: "opencode" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setCatalog("opencode", catalogWithModels(["opencode/big-pickle"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("first enrollment for opencode");

    expect(a.registerAgentProvider.mock.calls[0][0].autoEnrollModelIds).toEqual([
      "opencode/big-pickle",
    ]);
    unsub();
  });

  it("does NOT call setEnabledModels when a single model is reported (no churn)", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    // One reported model is already the entire enabled set → no narrowing.
    m.setCatalog("codex", catalogWithModels(["gpt-5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("first enrollment for codex");

    expect(a.setEnabledModels).not.toHaveBeenCalled();
    unsub();
  });

  it("recurring probe (provider already exists) takes the sync branch, no register, no re-seed", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setCatalog("codex", catalogWithModels(["gpt-5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("first enrollment for codex");

    // A new probe reports a changed list; provider now exists → sync only.
    m.setCatalog("codex", catalogWithModels(["gpt-5", "gpt-5.5"]));
    m.emit();
    await waitFor(() => expect(a.syncAgentModels).toHaveBeenCalledTimes(1));

    expect(a.registerAgentProvider).toHaveBeenCalledTimes(1);
    expect(a.syncAgentModels).toHaveBeenCalledTimes(1);
    expect(a.syncAgentModels.mock.calls[0][0]).toEqual({
      agentType: "codex",
      wireModelIds: ["gpt-5", "gpt-5.5"],
      fallbackDisplayNames: { "gpt-5": "gpt-5", "gpt-5.5": "gpt-5.5" },
      fallbackDescriptions: {},
    });
    // Discovery never narrows the enabled set on either branch.
    expect(a.setEnabledModels).not.toHaveBeenCalled();
    unsub();
  });

  it("re-probe with an unchanged list is a no-op (no register, no sync)", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setCatalog("codex", catalogWithModels(["gpt-5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("first enrollment for codex");
    a.syncAgentModels.mockClear();

    // Same list re-reported.
    m.emit();

    expect(a.syncAgentModels).not.toHaveBeenCalled();
    unsub();
  });

  it("opencode suppresses BYOK-managed models and enrolls only opencode-only ids", async () => {
    mockDescriptors = [makeDescriptor({ id: "opencode" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    a.byok.push({ origin: { kind: "byok", catalogProviderId: "anthropic" } });
    m.setCatalog(
      "opencode",
      catalogWithModels(["anthropic/claude-sonnet-4-5", "opencode/big-pickle"])
    );

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("first enrollment for opencode");

    // anthropic/* is suppressed (BYOK-managed); only opencode/* enrolls.
    expect(a.registerAgentProvider.mock.calls[0][0].wireModelIds).toEqual(["opencode/big-pickle"]);
    unsub();
  });

  it("does NOT register/sync on a settled-but-empty probe (transient/degraded)", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    // A settled state that reports zero models (distinct from null/no-state).
    m.setCatalog("codex", catalogWithModels([]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("empty model list for codex");

    expect(a.registerAgentProvider).not.toHaveBeenCalled();
    expect(a.syncAgentModels).not.toHaveBeenCalled();
    unsub();
  });

  it("does NOT cascade-remove when opencode's reported list fully suppresses to empty", async () => {
    // Regression: a BYOK-only user whose opencode probe reports only
    // BYOK-managed (anthropic/*) ids. After suppression the list is empty;
    // running syncAgentModels({ wireModelIds: [] }) on the existing provider
    // would cascade-REMOVE every prior opencode agent model. Guard against it.
    mockDescriptors = [makeDescriptor({ id: "opencode" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    // An opencode agent provider already exists (prior enrollment).
    a.agentProviders.push({
      providerId: "prov-opencode",
      origin: { kind: "agent", agentType: "opencode" },
    });
    a.byok.push({ origin: { kind: "byok", catalogProviderId: "anthropic" } });
    m.setCatalog("opencode", catalogWithModels(["anthropic/claude-sonnet-4-5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await waitForDiscoveryLog("empty model list for opencode");

    // All reported ids are suppressed → empty list → no destructive sync.
    expect(a.syncAgentModels).not.toHaveBeenCalled();
    expect(a.registerAgentProvider).not.toHaveBeenCalled();
    unsub();
  });

  it("ignores a backend that has not reported a model catalog yet", () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setCatalog("codex", null);

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);

    expect(a.registerAgentProvider).not.toHaveBeenCalled();
    expect(a.syncAgentModels).not.toHaveBeenCalled();
    unsub();
  });

  it("after unsubscribe, further cache emits do nothing", () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    unsub();

    m.setCatalog("codex", catalogWithModels(["gpt-5"]));
    m.emit();
    expect(a.registerAgentProvider).not.toHaveBeenCalled();
  });
});

describe("buildManagedOpencodeProviderIds", () => {
  /** Build a minimal `Provider` row for a given origin. */
  function makeProvider(providerId: string, origin: ProviderOrigin): Provider {
    return {
      providerId,
      providerType: "anthropic",
      displayName: providerId,
      origin,
      addedAt: 0,
    };
  }

  it("maps BYOK providers through their catalog provider id", () => {
    const managed = buildManagedOpencodeProviderIds([
      makeProvider("p1", { kind: "byok", catalogProviderId: "anthropic" }),
      makeProvider("p2", { kind: "byok", catalogProviderId: "openai" }),
    ]);
    expect(managed).toEqual(new Set(["anthropic", "openai"]));
  });

  it("maps copilot-plus to the reserved opencode provider id", () => {
    const managed = buildManagedOpencodeProviderIds([makeProvider("p1", { kind: "copilot-plus" })]);
    expect(managed).toEqual(new Set(["copilot-plus"]));
  });

  it("excludes unroutable BYOK providers (no catalog id → null mapping)", () => {
    const managed = buildManagedOpencodeProviderIds([
      makeProvider("p1", { kind: "byok" }), // custom endpoint, no catalogProviderId
      makeProvider("p2", { kind: "byok", catalogProviderId: "google" }),
    ]);
    expect(managed).toEqual(new Set(["google"]));
  });

  it("excludes agent-origin providers so they never suppress themselves", () => {
    const managed = buildManagedOpencodeProviderIds([
      makeProvider("opencode-agent", { kind: "agent", agentType: "opencode" }),
      makeProvider("p1", { kind: "byok", catalogProviderId: "anthropic" }),
    ]);
    expect(managed).toEqual(new Set(["anthropic"]));
  });

  it("returns an empty set for no providers", () => {
    expect(buildManagedOpencodeProviderIds([])).toEqual(new Set());
  });
});
