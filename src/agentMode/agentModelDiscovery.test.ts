/**
 * Tests for the M3 probe-settle discovery orchestrator.
 *
 * The Agent Mode barrel (`@/agentMode`) and the settings module are mocked so
 * the test exercises `wireAgentModelDiscovery` / `enrollBackend` against
 * controllable fakes without dragging in the React/Obsidian dependency tree.
 * The barrel helpers (`partitionOpencodeOnlyWireIds`, `computeDefaultEnabledIds`,
 * `mapProviderToOpencodeId`) are re-implemented thinly in the mock to keep the
 * orchestration assertions independent of their unit tests;
 * `buildManagedOpencodeProviderIds` now lives in this module and is tested for
 * real below.
 */

import type { ModelManagementApi, Provider, ProviderOrigin } from "@/modelManagement";
import type CopilotPlugin from "@/main";
import type { AgentSessionManager, BackendDescriptor, BackendState } from "@/agentMode";

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
  computeDefaultEnabledIds: (
    enrolled: Array<{ configuredModelId: string; wireModelId: string }>,
    currentWireId: string | undefined
  ) => {
    if (enrolled.length === 0) return [];
    const current = enrolled.find((e) => e.wireModelId === currentWireId);
    return [(current ?? enrolled[0]).configuredModelId];
  },
}));

// Import AFTER mocks so the module under test binds to them.
import { buildManagedOpencodeProviderIds, wireAgentModelDiscovery } from "./agentModelDiscovery";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

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

/**
 * State with a settled model list of the given wire baseModelIds. The agent's
 * current selection defaults to the first model unless `currentBaseId` is given.
 */
function stateWithModels(baseIds: string[], currentBaseId?: string): BackendState {
  return {
    model: {
      current: { baseModelId: currentBaseId ?? baseIds[0] ?? "", effort: null },
      apply: { kind: "setModel" },
      availableModels: baseIds.map((baseModelId) => ({
        baseModelId,
        name: baseModelId,
        provider: null,
        effortOptions: [],
      })),
    },
    mode: null,
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
  setState: (backendId: string, state: BackendState | null) => void;
  emit: () => void;
}

function makeManagerFake(): ManagerFake {
  const states = new Map<string, BackendState | null>();
  let listener: (() => void) | null = null;
  const manager = {
    getCachedBackendState: (id: string) => states.get(id) ?? null,
    subscribeModelCache: (cb: () => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  } as unknown as AgentSessionManager;
  return {
    manager,
    setState: (id, state) => states.set(id, state),
    emit: () => listener?.(),
  };
}

function makePlugin(api: ModelManagementApi): CopilotPlugin {
  return { modelManagement: api } as unknown as CopilotPlugin;
}

/** Let queued microtask chains (per-backend serialized runs) settle. */
async function flush(): Promise<void> {
  // The orchestrator chains: prior → enrollBackend (which awaits the async
  // register/sync) → lastEnrolled.set → finally. Several layers of awaited
  // promises, so drain generously.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  mockDescriptors = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wireAgentModelDiscovery", () => {
  it("first enrollment registers a provider and enrolls reported models", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setState("codex", stateWithModels(["gpt-5", "gpt-5.5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();

    expect(a.registerAgentProvider).toHaveBeenCalledTimes(1);
    expect(a.registerAgentProvider.mock.calls[0][0]).toMatchObject({
      agentType: "codex",
      providerType: "openai-compatible",
      wireModelIds: ["gpt-5", "gpt-5.5"],
    });
    expect(a.syncAgentModels).not.toHaveBeenCalled();
    unsub();
  });

  it("omits a reported empty name from fallbackDisplayNames (never overwrites with '')", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setState("codex", {
      model: {
        current: { baseModelId: "gpt-5", effort: null },
        apply: { kind: "setModel" },
        availableModels: [
          { baseModelId: "gpt-5", name: "GPT-5", provider: null, effortOptions: [] },
          { baseModelId: "blank", name: "", provider: null, effortOptions: [] },
        ],
      },
      mode: null,
    });

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();

    // "blank" is still enrolled (it's a real wire id) but contributes no
    // display-name fallback, so resolution falls back to catalog/id instead.
    expect(a.registerAgentProvider.mock.calls[0][0].fallbackDisplayNames).toEqual({
      "gpt-5": "GPT-5",
    });
    unsub();
  });

  it("seeds enabledModels to the agent's current model on first enrollment", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    // Agent reports gpt-5.5 as current (not the first reported model).
    m.setState("codex", stateWithModels(["gpt-5", "gpt-5.5"], "gpt-5.5"));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();

    // registerAgentProvider auto-enrolled both; seeding narrows to the current
    // model only (gpt-5.5 → cm-codex-1).
    expect(a.setEnabledModels).toHaveBeenCalledTimes(1);
    expect(a.setEnabledModels.mock.calls[0]).toEqual(["codex", ["cm-codex-1"]]);
    unsub();
  });

  it("falls back to the first model when the current one isn't enrolled", async () => {
    // opencode suppresses the agent's current model (a BYOK-managed anthropic
    // model); seeding falls back to the first opencode-only model.
    mockDescriptors = [makeDescriptor({ id: "opencode" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    a.byok.push({ origin: { kind: "byok", catalogProviderId: "anthropic" } });
    m.setState(
      "opencode",
      stateWithModels(
        ["anthropic/claude-sonnet-4-5", "opencode/big-pickle", "opencode/small-gherkin"],
        "anthropic/claude-sonnet-4-5"
      )
    );

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();

    // anthropic/* suppressed; current not enrolled → first enrolled (big-pickle).
    expect(a.setEnabledModels).toHaveBeenCalledTimes(1);
    expect(a.setEnabledModels.mock.calls[0]).toEqual(["opencode", ["cm-opencode-0"]]);
    unsub();
  });

  it("does NOT call setEnabledModels when a single model is reported (no churn)", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    // One reported model is already the entire enabled set → no narrowing.
    m.setState("codex", stateWithModels(["gpt-5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();

    expect(a.setEnabledModels).not.toHaveBeenCalled();
    unsub();
  });

  it("recurring probe (provider already exists) takes the sync branch, no register, no re-seed", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setState("codex", stateWithModels(["gpt-5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush(); // first enrollment → register

    // A new probe reports a changed list; provider now exists → sync only.
    m.setState("codex", stateWithModels(["gpt-5", "gpt-5.5"]));
    m.emit();
    await flush();

    expect(a.registerAgentProvider).toHaveBeenCalledTimes(1);
    expect(a.syncAgentModels).toHaveBeenCalledTimes(1);
    expect(a.syncAgentModels.mock.calls[0][0]).toEqual({
      agentType: "codex",
      wireModelIds: ["gpt-5", "gpt-5.5"],
      fallbackDisplayNames: { "gpt-5": "gpt-5", "gpt-5.5": "gpt-5.5" },
      fallbackDescriptions: {},
    });
    // Seeding never re-runs on the sync branch.
    expect(a.setEnabledModels).not.toHaveBeenCalled();
    unsub();
  });

  it("re-probe with an unchanged list is a no-op (no register, no sync)", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setState("codex", stateWithModels(["gpt-5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();
    a.syncAgentModels.mockClear();

    // Same list re-reported.
    m.emit();
    await flush();

    expect(a.syncAgentModels).not.toHaveBeenCalled();
    unsub();
  });

  it("opencode suppresses BYOK-managed models and enrolls only opencode-only ids", async () => {
    mockDescriptors = [makeDescriptor({ id: "opencode" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    a.byok.push({ origin: { kind: "byok", catalogProviderId: "anthropic" } });
    m.setState("opencode", stateWithModels(["anthropic/claude-sonnet-4-5", "opencode/big-pickle"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();

    // anthropic/* is suppressed (BYOK-managed); only opencode/* enrolls.
    expect(a.registerAgentProvider.mock.calls[0][0].wireModelIds).toEqual(["opencode/big-pickle"]);
    unsub();
  });

  it("does NOT register/sync on a settled-but-empty probe (transient/degraded)", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    // A settled state that reports zero models (distinct from null/no-state).
    m.setState("codex", stateWithModels([]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();

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
    m.setState("opencode", stateWithModels(["anthropic/claude-sonnet-4-5"]));

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();

    // All reported ids are suppressed → empty list → no destructive sync.
    expect(a.syncAgentModels).not.toHaveBeenCalled();
    expect(a.registerAgentProvider).not.toHaveBeenCalled();
    unsub();
  });

  it("ignores a backend that has not reported a model state yet", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();
    m.setState("codex", null);

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();

    expect(a.registerAgentProvider).not.toHaveBeenCalled();
    expect(a.syncAgentModels).not.toHaveBeenCalled();
    unsub();
  });

  it("after unsubscribe, further cache emits do nothing", async () => {
    mockDescriptors = [makeDescriptor({ id: "codex" })];
    const m = makeManagerFake();
    const a = makeApiFake();

    const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
    await flush();
    unsub();

    m.setState("codex", stateWithModels(["gpt-5"]));
    m.emit();
    await flush();
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
