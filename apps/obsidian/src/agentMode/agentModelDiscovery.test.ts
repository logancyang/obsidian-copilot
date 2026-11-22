import type { ModelManagementApi, Provider, ProviderOrigin } from "@/modelManagement";
import type CopilotPlugin from "@/main";
import type { AgentSessionManager, BackendDescriptor } from "@/agentMode";
import { logInfo } from "@/logger";
import { waitFor } from "@testing-library/react";

let mockDescriptors: BackendDescriptor[] = [];

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/agentMode", () => ({
  listBackendDescriptors: () => mockDescriptors,
  partitionOpencodeOnlyWireIds: jest.requireActual(
    "@/agentMode/backends/opencode/opencodeProbePartition"
  ).partitionOpencodeOnlyWireIds,
  mapProviderToOpencodeId: jest.requireActual("@/agentMode/backends/opencode/opencodeModelResolve")
    .mapProviderToOpencodeId,
}));

import { buildManagedOpencodeProviderIds, wireAgentModelDiscovery } from "./agentModelDiscovery";

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
}

function makeApiFake(): ApiFake {
  const agentProviders: ApiFake["agentProviders"] = [];
  const byok: ApiFake["byok"] = [];
  const plus: ApiFake["plus"] = [];

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
  } as unknown as ModelManagementApi;

  return {
    api,
    agentProviders,
    byok,
    plus,
    registerAgentProvider,
    syncAgentModels,
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

describe("agentModelDiscovery", () => {
  describe("wireAgentModelDiscovery()", () => {
    it("registers an agent provider with every reported model on the first probe", async () => {
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
      unsub();
    });

    it("leaves a model with an empty reported name out of the fallback display names", async () => {
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

      expect(a.registerAgentProvider.mock.calls[0][0].fallbackDisplayNames).toEqual({
        "gpt-5": "GPT-5",
      });
      unsub();
    });

    it("leaves auto-enroll ids unset for codex so its whole catalog starts enabled", async () => {
      mockDescriptors = [makeDescriptor({ id: "codex" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("codex", catalogWithModels(["gpt-5", "gpt-5.5"]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("first enrollment for codex");

      expect(a.registerAgentProvider.mock.calls[0][0].autoEnrollModelIds).toBeUndefined();
      unsub();
    });

    it("registers only the OpenCode models whose provider is not already managed by BYOK", async () => {
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
      unsub();
    });

    it("auto-enrolls only the first three OpenCode models while registering all of them", async () => {
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
      expect(input.wireModelIds).toHaveLength(5);
      expect(input.autoEnrollModelIds).toEqual([
        "opencode/big-pickle",
        "opencode/claude-fable-5",
        "opencode/claude-haiku-4-5",
      ]);
      unsub();
    });

    it("auto-enrolls every OpenCode model when fewer than three are reported", async () => {
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

    it("syncs the changed model list instead of registering again when the agent provider already exists", async () => {
      mockDescriptors = [makeDescriptor({ id: "codex" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("codex", catalogWithModels(["gpt-5"]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("first enrollment for codex");

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
      unsub();
    });

    it("does nothing when a later probe reports the same model list", async () => {
      mockDescriptors = [makeDescriptor({ id: "codex" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("codex", catalogWithModels(["gpt-5"]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("first enrollment for codex");
      a.syncAgentModels.mockClear();

      m.emit();

      expect(a.syncAgentModels).not.toHaveBeenCalled();
      unsub();
    });

    it("neither registers nor syncs when the probe reports no models", async () => {
      mockDescriptors = [makeDescriptor({ id: "codex" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("codex", catalogWithModels([]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("empty model list for codex");

      expect(a.registerAgentProvider).not.toHaveBeenCalled();
      expect(a.syncAgentModels).not.toHaveBeenCalled();
      unsub();
    });

    it("neither registers nor syncs when every OpenCode model is already managed by BYOK", async () => {
      mockDescriptors = [makeDescriptor({ id: "opencode" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      a.agentProviders.push({
        providerId: "prov-opencode",
        origin: { kind: "agent", agentType: "opencode" },
      });
      a.byok.push({ origin: { kind: "byok", catalogProviderId: "anthropic" } });
      m.setCatalog("opencode", catalogWithModels(["anthropic/claude-sonnet-4-5"]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("empty model list for opencode");

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

    it("stops reacting to model cache updates after the returned unsubscribe runs", () => {
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

  describe("buildManagedOpencodeProviderIds()", () => {
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
      const managed = buildManagedOpencodeProviderIds([
        makeProvider("p1", { kind: "copilot-plus" }),
      ]);
      expect(managed).toEqual(new Set(["copilot-plus"]));
    });

    it("skips a BYOK provider that has no catalog provider id", () => {
      const managed = buildManagedOpencodeProviderIds([
        makeProvider("p1", { kind: "byok" }),
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
});
