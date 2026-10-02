import {
  appendBackendSection,
  backendReadinessReason,
  buildEffortOptionsByModelKey,
  buildEffortSibling,
  buildModelOnChange,
  buildPickerEntries,
  collectModelActiveContext,
  synthesizeAgentEntry,
} from "./agentModelPickerHelpers";
import { ModelCapability } from "@/constants";
import { getModelKeyFromModel } from "@/settings/model";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type {
  BackendDescriptor,
  BackendState,
  EffortOption,
  EnabledModelEntry,
  InstallState,
  ModelEntry,
  ModelState,
} from "@/agentMode/session/types";
import type { ModelActiveContext } from "./agentModelPickerHelpers";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { CopilotSettings } from "@/settings/model";

type ModelCatalog = NonNullable<ReturnType<AgentSessionManager["getCachedModelCatalog"]>>;

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  Modal: class {},
  App: class {},
}));

const mockSelfHostWarnIds = new Set<string>();
jest.mock("@/agentMode/backends/registry", () => {
  const stub = (id: string) => ({
    id,
    displayName: id,
    wire: {
      encode: () => "",
      decode: () => ({ selection: { baseModelId: "", effort: null }, provider: null }),
    },
  });
  return {
    backendRegistry: {
      codex: stub("codex"),
      claude: stub("claude"),
      opencode: stub("opencode"),
    },
    listBackendDescriptors: () => [stub("codex"), stub("claude"), stub("opencode")],
    getActiveBackendDescriptor: () => stub("opencode"),
    backendNeedsSelfHostWarning: (descriptor: { id: string }) =>
      mockSelfHostWarnIds.has(descriptor.id),
  };
});

afterEach(() => mockSelfHostWarnIds.clear());

function makeState(modelId: string): BackendState {
  const entry = {
    baseModelId: modelId,
    name: modelId,
    provider: "anthropic",
    effortOptions: [],
  };
  return {
    model: {
      current: { baseModelId: modelId, effort: null },
      availableModels: [entry],
      apply: { kind: "setModel" },
    },
    mode: null,
  };
}

function makeDescriptor(
  id: "codex" | "claude" | "opencode",
  installState: InstallState = { kind: "ready", source: "custom" }
): BackendDescriptor {
  return {
    id,
    displayName: id,
    getInstallState: () => installState,
    wire: {
      encode: () => "",
      decode: () => ({ selection: { baseModelId: "", effort: null }, provider: null }),
    },
  } as unknown as BackendDescriptor;
}

function makeModelEntry(baseModelId: string, name?: string): ModelEntry {
  return {
    baseModelId,
    name: name ?? baseModelId,
    provider: null,
    effortOptions: [],
  };
}

function makeModelState(currentBaseId: string, available: ModelEntry[]): ModelState {
  return {
    current: { baseModelId: currentBaseId, effort: null },
    availableModels: available,
    apply: { kind: "setModel" },
  };
}

function makeCatalog(availableModels: ModelEntry[] | null): ModelCatalog {
  return { availableModels };
}

function makeUIState(opts: {
  canSwitchModel?: boolean | null;
  canSwitchEffort?: boolean | null;
  canSwitchMode?: boolean | null;
}): AgentChatUIState {
  return {
    canSwitchModel: () => opts.canSwitchModel ?? null,
    canSwitchEffort: () => opts.canSwitchEffort ?? null,
    canSwitchMode: () => opts.canSwitchMode ?? null,
  } as unknown as AgentChatUIState;
}

function makeManager(opts: {
  catalogById?: Record<string, ModelCatalog | null>;
  preloadStatusById?: Record<string, "pending" | "ready" | "error" | "absent">;
  effortCatalogById?: Record<string, Record<string, EffortOption[]>>;
  defaultSelectionById?: Record<string, { baseModelId: string; effort: string | null } | null>;
  setDefaultBackend?: jest.Mock;
  applySelection?: jest.Mock;
  persistDefaultSelection?: jest.Mock;
  createSession?: jest.Mock;
  replaceSessionInPlace?: jest.Mock;
  closeSession?: jest.Mock;
}): AgentSessionManager {
  return {
    getCachedModelCatalog: (id: string) => opts.catalogById?.[id] ?? null,
    getPreloadStatus: (id: string) => opts.preloadStatusById?.[id] ?? "absent",
    getEffortCatalog: (id: string) => opts.effortCatalogById?.[id] ?? null,
    getDefaultSelection: (id: string) => opts.defaultSelectionById?.[id] ?? null,
    setDefaultBackend: opts.setDefaultBackend ?? jest.fn(),
    applySelection: opts.applySelection ?? jest.fn().mockResolvedValue(undefined),
    persistDefaultSelection: opts.persistDefaultSelection ?? jest.fn().mockResolvedValue(undefined),
    createSession: opts.createSession ?? jest.fn().mockResolvedValue(undefined),
    replaceSessionInPlace: opts.replaceSessionInPlace ?? jest.fn().mockResolvedValue(undefined),
    closeSession: opts.closeSession ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as AgentSessionManager;
}

const emptySettings = {
  providers: {},
  copilotPlusCatalog: {
    models: [
      { id: "copilot-plus-flash", displayName: "Copilot Plus Flash" },
      { id: "glm-5.2", displayName: "GLM-5.2" },
    ],
    defaultEnabledIds: ["copilot-plus-flash", "glm-5.2"],
  },
} as unknown as CopilotSettings;

const copilotPlusSettings = {
  ...emptySettings,
  providers: { plus: { origin: { kind: "copilot-plus" } } },
} as unknown as CopilotSettings;

function claudeWithInstallState(installState: InstallState): BackendDescriptor {
  return {
    ...makeDescriptor("claude", installState),
    getEnabledModelEntries: () => [
      { baseModelId: "sonnet", name: "Sonnet", credentialState: "ok" as const },
    ],
  };
}

function noSessionContext(): ModelActiveContext {
  return {
    activeSession: null,
    activeChatUIState: null,
    activeBackendId: null,
    activeDescriptor: undefined,
    activeSessionHasHistory: false,
    activeModelState: null,
    activeCurrentEntry: undefined,
  };
}

function managerWithSonnet(): AgentSessionManager {
  return makeManager({ catalogById: { claude: makeCatalog([makeModelEntry("sonnet")]) } });
}

describe("agentModelPickerHelpers", () => {
  describe("collectModelActiveContext()", () => {
    it("uses the active session's current model", () => {
      const activeState = makeState("active-model");
      const manager = {
        getActiveSession: () => ({
          backendId: "codex",
          getState: () => activeState,
          hasUserVisibleMessages: () => false,
        }),
        getActiveChatUIState: () => null,
      } as unknown as AgentSessionManager;

      expect(collectModelActiveContext(manager).activeModelState).toBe(activeState.model);
    });

    it("returns no current model while the active session is starting", () => {
      const manager = {
        getActiveSession: () => ({
          backendId: "codex",
          getState: () => null,
          hasUserVisibleMessages: () => false,
        }),
        getActiveChatUIState: () => null,
      } as unknown as AgentSessionManager;

      expect(collectModelActiveContext(manager).activeModelState).toBeNull();
    });
  });

  describe("buildPickerEntries()", () => {
    it("previews the locked Copilot lineup above a routing agent's own models when unlicensed", () => {
      const entry = makeModelEntry("catalog-model");
      const descriptor = {
        ...makeDescriptor("opencode"),
        routesCopilotModels: true,
        getEnabledModelEntries: () => [
          { baseModelId: entry.baseModelId, name: entry.name, credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = {
        getCachedModelCatalog: () => ({ availableModels: [entry] }),
        getPreloadStatus: () => "ready",
        getDefaultSelection: () => null,
      } as unknown as AgentSessionManager;

      const { entries } = buildPickerEntries(manager, [descriptor], {} as ModelActiveContext, {
        ...emptySettings,
      });

      const locked = entries.filter((model) => model._needsLicense);
      expect(locked.length).toBeGreaterThan(0);
      expect(entries.slice(0, locked.length).every((model) => model._needsLicense)).toBe(true);
      expect(entries[entries.length - 1].name).toBe("catalog-model");
      expect(locked.every((model) => model._group === descriptor.displayName)).toBe(true);
    });

    it("previews nothing for an agent that cannot route Copilot models", () => {
      const claude = {
        ...makeDescriptor("claude"),
        routesCopilotModels: false,
        getEnabledModelEntries: () => [
          { baseModelId: "sonnet", name: "Sonnet", credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: { claude: null },
        preloadStatusById: { claude: "ready" },
      });

      const { entries } = buildPickerEntries(manager, [claude], {} as ModelActiveContext, {
        ...emptySettings,
      });

      expect(entries.some((entry) => entry._needsLicense)).toBe(false);
    });

    it("previews nothing once the Copilot provider is registered, since the real models are there", () => {
      const entry = makeModelEntry("catalog-model");
      const descriptor = {
        ...makeDescriptor("opencode"),
        routesCopilotModels: true,
        getEnabledModelEntries: () => [
          { baseModelId: entry.baseModelId, name: entry.name, credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = {
        getCachedModelCatalog: () => ({ availableModels: [entry] }),
        getPreloadStatus: () => "ready",
        getDefaultSelection: () => null,
      } as unknown as AgentSessionManager;

      const { entries } = buildPickerEntries(manager, [descriptor], {} as ModelActiveContext, {
        ...emptySettings,
        providers: {
          "plus-1": {
            providerId: "plus-1",
            providerType: "openai-compatible",
            displayName: "Copilot",
            origin: { kind: "copilot-plus" },
            addedAt: 0,
          },
        },
      });

      expect(entries.map((model) => model.name)).toEqual(["catalog-model"]);
    });

    it("still shows a loading placeholder for a routing agent whose preload has not settled", () => {
      const descriptor = {
        ...makeDescriptor("opencode"),
        routesCopilotModels: true,
        getEnabledModelEntries: () => [],
      } as unknown as BackendDescriptor;
      const manager = {
        getCachedModelCatalog: () => null,
        getPreloadStatus: () => "pending",
        getDefaultSelection: () => null,
      } as unknown as AgentSessionManager;

      const { entries } = buildPickerEntries(manager, [descriptor], {} as ModelActiveContext, {
        ...emptySettings,
      });

      expect(entries.some((entry) => entry._disabledReason === "Loading…")).toBe(true);
    });

    it("builds shared choices from the model catalog", () => {
      const entry = makeModelEntry("catalog-model");
      const descriptor = {
        ...makeDescriptor("opencode"),
        getEnabledModelEntries: () => [
          { baseModelId: entry.baseModelId, name: entry.name, credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = {
        getCachedModelCatalog: () => ({ availableModels: [entry] }),
        getPreloadStatus: () => "ready",
        getDefaultSelection: () => null,
      } as unknown as AgentSessionManager;
      const { entries } = buildPickerEntries(
        manager,
        [descriptor],
        {} as ModelActiveContext,
        emptySettings
      );
      expect(entries.map((model) => model.name)).toEqual(["catalog-model"]);
    });

    it("keeps enabled models selectable when a settled preload has no discovered catalog", () => {
      const claude = {
        ...makeDescriptor("claude"),
        getEnabledModelEntries: () => [
          { baseModelId: "default", name: "Default", credentialState: "ok" as const },
          { baseModelId: "sonnet", name: "Sonnet", credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: { claude: null },
        preloadStatusById: { claude: "ready" },
      });
      const ctx = noSessionContext();

      const { entries } = buildPickerEntries(manager, [claude], ctx, emptySettings);

      expect(entries.map((entry) => entry.name)).toEqual(["default", "sonnet"]);
      expect(entries.every((entry) => entry._disabledReason === undefined)).toBe(true);
    });

    it("does not invent model rows when discovery settles without a model catalog", () => {
      const descriptor = {
        ...makeDescriptor("claude"),
        getEnabledModelEntries: () => [
          { baseModelId: "stale", name: "Stale", credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: { claude: makeCatalog(null) },
        preloadStatusById: { claude: "ready" },
      });
      const ctx = noSessionContext();

      const { entries } = buildPickerEntries(manager, [descriptor], ctx, emptySettings);

      expect(entries).toHaveLength(0);
    });

    it("hides non-active backend sections once the active session has history", () => {
      const codex = makeDescriptor("codex");
      const claude = makeDescriptor("claude");
      const codexEntry = makeModelEntry("gpt-5");
      const claudeEntry = makeModelEntry("opus");
      const manager = makeManager({
        catalogById: {
          codex: makeCatalog([codexEntry]),
          claude: makeCatalog([claudeEntry]),
        },
      });
      const ctx: ModelActiveContext = {
        activeSession: { backendId: "codex" } as unknown as AgentSession,
        activeChatUIState: null,
        activeBackendId: "codex",
        activeDescriptor: codex,
        activeSessionHasHistory: true,
        activeModelState: makeModelState("gpt-5", [codexEntry]),
        activeCurrentEntry: codexEntry,
      };
      const { entries } = buildPickerEntries(manager, [codex, claude], ctx, emptySettings);
      const ids = entries.map((e) => e._backendId);
      expect(ids).toEqual(["codex"]);
    });

    it("synthesizes a stranded active model in front when curation removed it", () => {
      const codex = makeDescriptor("codex");
      const stranded = makeModelEntry("ghost-model", "Ghost");
      const visible = makeModelEntry("real-model");
      const manager = makeManager({
        catalogById: {
          codex: makeCatalog([visible]),
        },
      });
      const ctx: ModelActiveContext = {
        activeSession: { backendId: "codex" } as unknown as AgentSession,
        activeChatUIState: null,
        activeBackendId: "codex",
        activeDescriptor: codex,
        activeSessionHasHistory: false,
        activeModelState: makeModelState("ghost-model", [stranded]),
        activeCurrentEntry: stranded,
      };
      const { entries, valueKey } = buildPickerEntries(manager, [codex], ctx, emptySettings);
      expect(entries[0].name).toBe("ghost-model");
      expect(entries[0]._backendId).toBe("codex");
      expect(valueKey).toBe("codex:ghost-model|agent");
    });

    it("does not add a synth entry when the active model is already in the catalog", () => {
      const codex = makeDescriptor("codex");
      const entry = makeModelEntry("gpt-5");
      const manager = makeManager({
        catalogById: {
          codex: makeCatalog([entry]),
        },
      });
      const ctx: ModelActiveContext = {
        activeSession: { backendId: "codex" } as unknown as AgentSession,
        activeChatUIState: null,
        activeBackendId: "codex",
        activeDescriptor: codex,
        activeSessionHasHistory: false,
        activeModelState: makeModelState("gpt-5", [entry]),
        activeCurrentEntry: entry,
      };
      const { entries } = buildPickerEntries(manager, [codex], ctx, emptySettings);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("gpt-5");
    });

    it("filters to the enabled set via getEnabledModelEntries", () => {
      const enabled = makeModelEntry("anthropic/claude-sonnet-4-6");
      const disabled = makeModelEntry("anthropic/claude-haiku");
      const opencode = {
        ...makeDescriptor("opencode"),
        getEnabledModelEntries: () => [
          {
            baseModelId: "anthropic/claude-sonnet-4-6",
            name: "Sonnet",
            credentialState: "ok" as const,
          },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: {
          opencode: makeCatalog([enabled, disabled]),
        },
      });
      const ctx = noSessionContext();
      const { entries } = buildPickerEntries(manager, [opencode], ctx, emptySettings);
      expect(entries.map((e) => e.name)).toEqual(["anthropic/claude-sonnet-4-6"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 never lists or selects an active model the user has not enabled on a backend that may only run enabled models", () => {
      const pushed = makeModelEntry("openrouter/unbiased/pareto-26.10-preview");
      const enabled = makeModelEntry("copilot-plus/copilot-plus-flash");
      const opencode = {
        ...makeDescriptor("opencode"),
        routesCopilotModels: true,
        getEnabledModelEntries: () => [
          { baseModelId: enabled.baseModelId, name: "Flash", credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: { opencode: makeCatalog([pushed, enabled]) },
      });
      const ctx: ModelActiveContext = {
        activeSession: {
          backendId: "opencode",
          getStatus: () => "idle",
        } as unknown as AgentSession,
        activeChatUIState: null,
        activeBackendId: "opencode",
        activeDescriptor: opencode,
        activeSessionHasHistory: false,
        activeModelState: makeModelState(pushed.baseModelId, [pushed, enabled]),
        activeCurrentEntry: pushed,
      };

      const { entries, valueKey } = buildPickerEntries(
        manager,
        [opencode],
        ctx,
        copilotPlusSettings
      );

      expect(entries.map((e) => e.name)).toEqual([enabled.baseModelId]);
      expect(valueKey).toBe("");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 shows Loading models… as the selection, never the agent's own model, while the chat is starting on a backend that may only run enabled models", () => {
      const agentDefault = makeModelEntry("opencode/fledge-alpha-free");
      const opencode = {
        ...makeDescriptor("opencode"),
        routesCopilotModels: true,
        getEnabledModelEntries: () => [
          { baseModelId: agentDefault.baseModelId, name: "Fledge", credentialState: "ok" as const },
          {
            baseModelId: "copilot-plus/copilot-plus-flash",
            name: "Flash",
            credentialState: "ok" as const,
          },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({ catalogById: { opencode: makeCatalog([agentDefault]) } });
      const ctx: ModelActiveContext = {
        activeSession: {
          backendId: "opencode",
          getStatus: () => "starting",
        } as unknown as AgentSession,
        activeChatUIState: null,
        activeBackendId: "opencode",
        activeDescriptor: opencode,
        activeSessionHasHistory: false,
        activeModelState: makeModelState(agentDefault.baseModelId, [agentDefault]),
        activeCurrentEntry: agentDefault,
      };

      const { entries, valueKey } = buildPickerEntries(
        manager,
        [opencode],
        ctx,
        copilotPlusSettings
      );

      const selected = entries.find((e) => getModelKeyFromModel(e) === valueKey);
      expect(selected?.displayName).toBe("Loading models…");
      expect(entries.map((e) => e.name)).toEqual([
        "__preload_pending__",
        agentDefault.baseModelId,
        "copilot-plus/copilot-plus-flash",
      ]);
    });

    it("carries the model description onto the picker entry as _subtitle", () => {
      const entry: ModelEntry = {
        baseModelId: "gpt-5",
        name: "GPT-5",
        description: "Frontier model for complex coding",
        provider: null,
        effortOptions: [],
      };
      const codex = {
        ...makeDescriptor("codex"),
        getEnabledModelEntries: () => [
          { baseModelId: "gpt-5", name: "GPT-5", credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: {
          codex: makeCatalog([entry]),
        },
      });
      const ctx: ModelActiveContext = {
        activeSession: { backendId: "codex" } as unknown as AgentSession,
        activeChatUIState: null,
        activeBackendId: "codex",
        activeDescriptor: codex,
        activeSessionHasHistory: false,
        activeModelState: makeModelState("gpt-5", [entry]),
        activeCurrentEntry: entry,
      };
      const { entries } = buildPickerEntries(manager, [codex], ctx, emptySettings);
      expect(entries[0]._subtitle).toBe("Frontier model for complex coding");
    });

    it("carries the description onto a synthesized stranded entry", () => {
      const stranded: ModelEntry = {
        baseModelId: "ghost",
        name: "Ghost",
        description: "Opus 4.7 with 1M context",
        provider: null,
        effortOptions: [],
      };
      const visible = makeModelEntry("real-model");
      const codex = makeDescriptor("codex");
      const manager = makeManager({
        catalogById: {
          codex: makeCatalog([visible]),
        },
      });
      const ctx: ModelActiveContext = {
        activeSession: { backendId: "codex" } as unknown as AgentSession,
        activeChatUIState: null,
        activeBackendId: "codex",
        activeDescriptor: codex,
        activeSessionHasHistory: false,
        activeModelState: makeModelState("ghost", [stranded]),
        activeCurrentEntry: stranded,
      };
      const { entries } = buildPickerEntries(manager, [codex], ctx, emptySettings);
      expect(entries[0]._subtitle).toBe("Opus 4.7 with 1M context");
    });

    it("flags every catalog row of a cloud backend the section marks under Self-Host Mode", () => {
      mockSelfHostWarnIds.add("claude");
      const claude = {
        ...makeDescriptor("claude"),
        getEnabledModelEntries: () => [
          { baseModelId: "opus", name: "Opus", credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: {
          claude: makeCatalog([makeModelEntry("opus")]),
        },
      });
      const ctx = noSessionContext();
      const { entries } = buildPickerEntries(manager, [claude], ctx, emptySettings);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => e._needsSelfHostWarning === true)).toBe(true);
    });

    it("flags a warned cloud backend's preload placeholder row", () => {
      mockSelfHostWarnIds.add("claude");
      const claude = {
        ...makeDescriptor("claude"),
        getEnabledModelEntries: () => [
          { baseModelId: "opus", name: "Opus", credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: { claude: null },
        preloadStatusById: { claude: "pending" },
      });
      const ctx = noSessionContext();
      const { entries } = buildPickerEntries(manager, [claude], ctx, emptySettings);
      expect(entries).toHaveLength(1);
      expect(entries[0]._needsSelfHostWarning).toBe(true);
    });

    it("flags the stranded active row when its cloud backend is warned", () => {
      mockSelfHostWarnIds.add("codex");
      const codex = makeDescriptor("codex");
      const stranded = makeModelEntry("ghost-model", "Ghost");
      const visible = makeModelEntry("real-model");
      const manager = makeManager({
        catalogById: {
          codex: makeCatalog([visible]),
        },
      });
      const ctx: ModelActiveContext = {
        activeSession: { backendId: "codex" } as unknown as AgentSession,
        activeChatUIState: null,
        activeBackendId: "codex",
        activeDescriptor: codex,
        activeSessionHasHistory: false,
        activeModelState: makeModelState("ghost-model", [stranded]),
        activeCurrentEntry: stranded,
      };
      const { entries } = buildPickerEntries(manager, [codex], ctx, emptySettings);
      expect(entries[0].name).toBe("ghost-model");
      expect(entries[0]._needsSelfHostWarning).toBe(true);
    });

    it("marks rows of a backend that isn't set up so the pick can't be made", () => {
      const { entries } = buildPickerEntries(
        managerWithSonnet(),
        [claudeWithInstallState({ kind: "absent" })],
        noSessionContext(),
        emptySettings
      );
      expect(entries.map((entry) => entry._disabledReason)).toEqual(["Not set up"]);
    });

    it("reports the unset-up backend rather than a per-model credential problem", () => {
      const claude = {
        ...makeDescriptor("claude", { kind: "absent" }),
        getEnabledModelEntries: () => [
          { baseModelId: "sonnet", name: "Sonnet", credentialState: "missing_key" as const },
        ],
      } as unknown as BackendDescriptor;

      const { entries } = buildPickerEntries(
        managerWithSonnet(),
        [claude],
        noSessionContext(),
        emptySettings
      );

      expect(entries[0]._disabledReason).toBe("Not set up");
    });

    it("regression: never disables the running backend's own rows when its binary goes missing", () => {
      const claude = claudeWithInstallState({ kind: "absent" });
      const ctx: ModelActiveContext = {
        ...noSessionContext(),
        activeSession: { backendId: "claude" } as unknown as AgentSession,
        activeBackendId: "claude",
        activeDescriptor: claude,
      };

      const { entries } = buildPickerEntries(managerWithSonnet(), [claude], ctx, emptySettings);

      expect(entries.map((entry) => entry._disabledReason)).toEqual([undefined]);
    });

    function reported(baseModelId: string, provider: string | null): ModelEntry {
      return { baseModelId, name: baseModelId, provider, effortOptions: [] };
    }

    function ctxFor(backendId: "codex" | "claude" | "opencode"): ModelActiveContext {
      return {
        activeSession: { backendId } as unknown as AgentSession,
        activeChatUIState: null,
        activeBackendId: backendId,
        activeDescriptor: makeDescriptor(backendId),
        activeSessionHasHistory: false,
        activeModelState: null,
        activeCurrentEntry: undefined,
      };
    }

    it("surfaces an enabled model's persisted capabilities on its picker entry", () => {
      const claude = {
        ...makeDescriptor("claude"),
        getEnabledModelEntries: () => [
          {
            baseModelId: "claude-sonnet-4-5",
            name: "Sonnet",
            credentialState: "ok" as const,
            capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
          },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: {
          claude: makeCatalog([reported("claude-sonnet-4-5", "anthropic")]),
        },
      });
      const { entries } = buildPickerEntries(manager, [claude], ctxFor("claude"), emptySettings);
      const entry = entries.find((e) => e.name === "claude-sonnet-4-5");
      expect(entry?.capabilities).toEqual([ModelCapability.VISION, ModelCapability.REASONING]);
    });

    it("leaves capabilities undefined when the enabled entry carries none", () => {
      const claude = {
        ...makeDescriptor("claude"),
        getEnabledModelEntries: () => [
          { baseModelId: "claude-sonnet-4-5", name: "Sonnet", credentialState: "ok" as const },
        ],
      } as unknown as BackendDescriptor;
      const manager = makeManager({
        catalogById: {
          claude: makeCatalog([reported("claude-sonnet-4-5", "anthropic")]),
        },
      });
      const { entries } = buildPickerEntries(manager, [claude], ctxFor("claude"), emptySettings);
      const entry = entries.find((e) => e.name === "claude-sonnet-4-5");
      expect(entry?.capabilities).toBeUndefined();
    });
  });

  describe("appendBackendSection()", () => {
    function opencodeWithEntries(enabled: EnabledModelEntry[]): BackendDescriptor {
      return {
        ...makeDescriptor("opencode"),
        getEnabledModelEntries: () => enabled,
      };
    }

    it("flags each enabled model by credential state and 'not offered by agent'", () => {
      const enabled: EnabledModelEntry[] = [
        { baseModelId: "openrouter/a", name: "A", credentialState: "missing_key" },
        { baseModelId: "openrouter/c", name: "C", credentialState: "ok" },
        { baseModelId: "openrouter/d", name: "D", credentialState: "ok" },
      ];
      const entries: ModelSelectorEntry[] = [];
      appendBackendSection(entries, opencodeWithEntries(enabled), {
        backendModels: [makeModelEntry("openrouter/c", "Reported C")],
        settings: emptySettings,
      });
      const byId = Object.fromEntries(entries.map((e) => [e.name, e]));
      expect(byId["openrouter/a"]._disabledReason).toBe("Add API key");
      expect(byId["openrouter/c"]._disabledReason).toBeUndefined();
      expect(byId["openrouter/d"]._disabledReason).toBe("Not offered by agent");
      expect(byId["openrouter/c"].displayName).toBe("Reported C");
    });

    it("shows an enabled model's host label over the agent-reported name, and the reported name when unlabeled (https://github.com/logancyang/obsidian-copilot/issues/3496)", () => {
      const enabled: EnabledModelEntry[] = [
        {
          baseModelId: "d5df8680/auto",
          name: "custom-model",
          label: "custom-provider/custom-model",
          credentialState: "ok",
        },
        { baseModelId: "copilot-plus/flash", name: "Flash", credentialState: "ok" },
      ];
      const entries: ModelSelectorEntry[] = [];
      appendBackendSection(entries, opencodeWithEntries(enabled), {
        backendModels: [
          makeModelEntry("d5df8680/auto", "d5df8680/auto"),
          makeModelEntry("copilot-plus/flash", "copilot-plus/flash"),
        ],
        settings: emptySettings,
      });
      const byId = Object.fromEntries(entries.map((e) => [e.name, e]));
      expect(byId["d5df8680/auto"].displayName).toBe("custom-provider/custom-model");
      expect(byId["copilot-plus/flash"].displayName).toBe("copilot-plus/flash");
    });

    it("shows an enabled model's host label when the agent has no model catalog yet, and its name when unlabeled (https://github.com/logancyang/obsidian-copilot/issues/3496)", () => {
      const enabled: EnabledModelEntry[] = [
        {
          baseModelId: "d5df8680/auto",
          name: "custom-model",
          label: "custom-provider/custom-model",
          credentialState: "ok",
        },
        { baseModelId: "copilot-plus/flash", name: "Flash", credentialState: "ok" },
      ];
      const entries: ModelSelectorEntry[] = [];
      appendBackendSection(entries, opencodeWithEntries(enabled), {
        backendModels: null,
        settings: emptySettings,
        useEnabledFallback: true,
      });
      const byId = Object.fromEntries(entries.map((e) => [e.name, e]));
      expect(byId["d5df8680/auto"].displayName).toBe("custom-provider/custom-model");
      expect(byId["copilot-plus/flash"].displayName).toBe("Flash");
    });

    it("carries the backend's free flag onto the picker entry", () => {
      const enabled: EnabledModelEntry[] = [
        {
          baseModelId: "opencode/big-pickle",
          name: "Big Pickle",
          credentialState: "ok",
          isFree: true,
        },
        {
          baseModelId: "lmstudio/gpt-oss-20b",
          name: "GPT OSS 20B",
          credentialState: "ok",
          isFree: false,
        },
      ];
      const entries: ModelSelectorEntry[] = [];
      appendBackendSection(entries, opencodeWithEntries(enabled), {
        backendModels: [
          makeModelEntry("opencode/big-pickle", "Big Pickle"),
          makeModelEntry("lmstudio/gpt-oss-20b", "GPT OSS 20B"),
        ],
        settings: emptySettings,
      });
      const byId = Object.fromEntries(entries.map((e) => [e.name, e]));
      expect(byId["opencode/big-pickle"]._isFree).toBe(true);
      expect(byId["lmstudio/gpt-oss-20b"]._isFree).toBe(false);
    });

    it("defers to the loading placeholder during preload (no reported catalog yet)", () => {
      const entries: ModelSelectorEntry[] = [];
      appendBackendSection(
        entries,
        opencodeWithEntries([{ baseModelId: "openrouter/a", name: "A", credentialState: "ok" }]),
        { backendModels: null, settings: emptySettings }
      );
      expect(entries).toHaveLength(0);
    });
  });

  describe("buildEffortSibling()", () => {
    function ctxWith(opts: {
      effortOptions: { value: string | null; label: string }[];
      canSwitchEffort?: boolean | null;
    }): ModelActiveContext {
      const entry: ModelEntry = {
        baseModelId: "m",
        name: "m",
        provider: null,
        effortOptions: opts.effortOptions,
      };
      return {
        activeSession: { backendId: "codex" } as unknown as AgentSession,
        activeChatUIState: makeUIState({ canSwitchEffort: opts.canSwitchEffort }),
        activeBackendId: "codex",
        activeDescriptor: makeDescriptor("codex"),
        activeSessionHasHistory: false,
        activeModelState: makeModelState("m", [entry]),
        activeCurrentEntry: entry,
      };
    }

    it("returns undefined when the current entry has no effort options", () => {
      const got = buildEffortSibling(makeManager({}), ctxWith({ effortOptions: [] }));
      expect(got).toBeUndefined();
    });

    it("disabled mirrors canSwitchEffort() === false", () => {
      const got = buildEffortSibling(
        makeManager({}),
        ctxWith({
          effortOptions: [{ value: "low", label: "Low" }],
          canSwitchEffort: false,
        })
      );
      expect(got?.disabled).toBe(true);
    });

    it("disabled is false when canSwitchEffort returns true or null", () => {
      expect(
        buildEffortSibling(
          makeManager({}),
          ctxWith({ effortOptions: [{ value: "low", label: "Low" }], canSwitchEffort: true })
        )?.disabled
      ).toBe(false);
      expect(
        buildEffortSibling(
          makeManager({}),
          ctxWith({ effortOptions: [{ value: "low", label: "Low" }], canSwitchEffort: null })
        )?.disabled
      ).toBe(false);
    });
  });

  describe("buildModelOnChange()", () => {
    function pickerEntry(backendId: string, baseModelId: string) {
      return {
        name: baseModelId,
        provider: "agent",
        enabled: true,
        isBuiltIn: false,
        displayName: baseModelId,
        _group: backendId,
        _backendId: backendId,
      };
    }

    function ctxFor(activeBackendId: string | null): ModelActiveContext {
      const session = activeBackendId
        ? ({ backendId: activeBackendId, internalId: "tab-1" } as unknown as AgentSession)
        : null;
      return {
        activeSession: session,
        activeChatUIState: makeUIState({ canSwitchModel: true }),
        activeBackendId,
        activeDescriptor: activeBackendId ? makeDescriptor("codex") : undefined,
        activeSessionHasHistory: false,
        activeModelState: null,
        activeCurrentEntry: undefined,
      };
    }

    it("same-backend pick calls setDefaultBackend then applySelection with the chosen base", () => {
      const setDefaultBackend = jest.fn();
      const applySelection = jest.fn().mockResolvedValue(undefined);
      const manager = makeManager({ setDefaultBackend, applySelection });
      const entries = [pickerEntry("codex", "gpt-5")];
      const onChange = buildModelOnChange(manager, ctxFor("codex"), entries);
      onChange("codex:gpt-5|agent");
      expect(setDefaultBackend).toHaveBeenCalledWith("codex");
      expect(applySelection).toHaveBeenCalledWith({ baseModelId: "gpt-5" });
    });

    it("same-backend pick with canSwitchModel === false does not call applySelection", () => {
      const applySelection = jest.fn().mockResolvedValue(undefined);
      const ctx = ctxFor("codex");
      ctx.activeChatUIState = makeUIState({ canSwitchModel: false });
      const manager = makeManager({ applySelection });
      const entries = [pickerEntry("codex", "gpt-5")];
      const onChange = buildModelOnChange(manager, ctx, entries);
      onChange("codex:gpt-5|agent");
      expect(applySelection).not.toHaveBeenCalled();
    });

    it("cross-backend pick seeds the new session transiently without persisting the default", async () => {
      const persistDefaultSelection = jest.fn().mockResolvedValue(undefined);
      const replaceSessionInPlace = jest.fn().mockResolvedValue(undefined);
      const setDefaultBackend = jest.fn();
      const closeSession = jest.fn().mockResolvedValue(undefined);
      const manager = makeManager({
        persistDefaultSelection,
        replaceSessionInPlace,
        setDefaultBackend,
        closeSession,
        defaultSelectionById: { claude: { baseModelId: "old", effort: "low" } },
      });
      const entries = [pickerEntry("claude", "opus")];
      const onChange = buildModelOnChange(manager, ctxFor("codex"), entries);
      onChange("claude:opus|agent");
      await new Promise((r) => window.setTimeout(r, 0));
      expect(persistDefaultSelection).not.toHaveBeenCalled();
      expect(replaceSessionInPlace).toHaveBeenCalledWith("tab-1", "claude", {
        preserveChatInput: true,
        seedSelection: { baseModelId: "opus", effort: "low" },
      });
      expect(setDefaultBackend).toHaveBeenCalledWith("claude");
      expect(closeSession).not.toHaveBeenCalled();
    });

    it("ignores entries with no _backendId or unresolvable baseModelId", () => {
      const setDefaultBackend = jest.fn();
      const applySelection = jest.fn();
      const manager = makeManager({ setDefaultBackend, applySelection });
      const entries = [
        {
          name: "no-backend",
          provider: "agent",
          enabled: true,
          isBuiltIn: false,
          displayName: "x",
        },
      ];
      const onChange = buildModelOnChange(manager, ctxFor("codex"), entries);
      onChange("no-backend|agent");
      expect(setDefaultBackend).not.toHaveBeenCalled();
      expect(applySelection).not.toHaveBeenCalled();
    });
  });

  describe("buildEffortOptionsByModelKey()", () => {
    const ACTIVE = "github-copilot/gpt-5.4";
    const OTHER = "opencode/nemotron-3-super-free";

    function catalogWithEffort(
      available: { baseModelId: string; effortOptions: EffortOption[] }[]
    ): ModelCatalog {
      return makeCatalog(
        available.map((a) => ({
          baseModelId: a.baseModelId,
          name: a.baseModelId,
          provider: null,
          effortOptions: a.effortOptions,
        }))
      );
    }

    it("prefers catalog effort and falls back to the prefetch cache for other models", () => {
      const opencode = makeDescriptor("opencode");
      const manager = makeManager({
        catalogById: {
          opencode: catalogWithEffort([
            { baseModelId: ACTIVE, effortOptions: [{ value: "high", label: "high" }] },
            { baseModelId: OTHER, effortOptions: [] },
          ]),
        },
        effortCatalogById: {
          opencode: {
            [ACTIVE]: [{ value: "low", label: "low" }],
            [OTHER]: [
              { value: "minimal", label: "minimal" },
              { value: "max", label: "max" },
            ],
          },
        },
      });
      const entries = [
        synthesizeAgentEntry(ACTIVE, ACTIVE, opencode),
        synthesizeAgentEntry(OTHER, OTHER, opencode),
      ];
      const out = buildEffortOptionsByModelKey(manager, entries);
      expect(out[getModelKeyFromModel(entries[0])]).toEqual([{ value: "high", label: "high" }]);
      expect(out[getModelKeyFromModel(entries[1])]).toEqual([
        { value: "minimal", label: "minimal" },
        { value: "max", label: "max" },
      ]);
    });

    it("returns empty when neither catalog nor prefetched effort exists", () => {
      const opencode = makeDescriptor("opencode");
      const manager = makeManager({
        catalogById: {
          opencode: catalogWithEffort([{ baseModelId: OTHER, effortOptions: [] }]),
        },
        effortCatalogById: { opencode: {} },
      });
      const entries = [synthesizeAgentEntry(OTHER, OTHER, opencode)];
      const out = buildEffortOptionsByModelKey(manager, entries);
      expect(out[getModelKeyFromModel(entries[0])]).toEqual([]);
    });
  });

  describe("backendReadinessReason()", () => {
    it("labels each state a user must fix before the backend can run", () => {
      expect(backendReadinessReason({ kind: "absent" })).toBe("Not set up");
      expect(
        backendReadinessReason({
          kind: "incompatible",
          source: "custom",
          currentVersion: "1.0.0",
          minVersion: "2.0.0",
          message: "too old",
        })
      ).toBe("Update required");
      expect(backendReadinessReason({ kind: "error", message: "boom" })).toBe("Setup error");
    });

    it("leaves rows selectable while the backend is ready or still being checked", () => {
      expect(backendReadinessReason({ kind: "ready", source: "custom" })).toBeUndefined();
      expect(backendReadinessReason({ kind: "checking", source: "custom" })).toBeUndefined();
    });
  });
});
