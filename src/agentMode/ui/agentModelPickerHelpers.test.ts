import {
  appendBackendSection,
  buildEffortOptionsByModelKey,
  buildEffortSibling,
  buildModelOnChange,
  buildPickerEntries,
  resolveActiveDisplayState,
  synthesizeAgentEntry,
} from "./agentModelPickerHelpers";
import { getModelKeyFromModel } from "@/settings/model";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type {
  BackendDescriptor,
  BackendState,
  EffortOption,
  EnabledModelEntry,
  ModelEntry,
  ModelState,
} from "@/agentMode/session/types";
import type { ModelActiveContext } from "./agentModelPickerHelpers";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { CopilotSettings } from "@/settings/model";

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  Modal: class {},
  App: class {},
}));

// Stub out the registry so the test doesn't pull in real backend descriptors
// (which would drag in install modals and other unrelated UI).
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
  };
});

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

describe("resolveActiveDisplayState", () => {
  it("returns the active session's state when present", () => {
    const sessionState = makeState("session-model");
    const cacheState = makeState("cache-model");
    const got = resolveActiveDisplayState(sessionState, "codex", () => cacheState);
    expect(got).toBe(sessionState);
  });

  it("isolates sibling tabs on the same backend: cache writes for backend X don't leak when the active session of X has its own state", () => {
    const tab2State = makeState("model-A");
    const tab1WroteThisToCache = makeState("model-B");
    const got = resolveActiveDisplayState(tab2State, "codex", () => tab1WroteThisToCache);
    expect(got?.model?.current.baseModelId).toBe("model-A");
  });

  it("falls back to the cache when the active session reports no state yet", () => {
    const cacheState = makeState("cache-model");
    const got = resolveActiveDisplayState(null, "codex", () => cacheState);
    expect(got).toBe(cacheState);
  });

  it("returns null when there is no active backend at all", () => {
    const got = resolveActiveDisplayState(null, null, () => makeState("ignored"));
    expect(got).toBeNull();
  });

  it("returns null when both session and cache are empty", () => {
    const got = resolveActiveDisplayState(null, "codex", () => null);
    expect(got).toBeNull();
  });
});

// ---- helpers for builder tests ----------------------------------------

function makeDescriptor(id: "codex" | "claude" | "opencode"): BackendDescriptor {
  return {
    id,
    displayName: id,
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
  cachedStateById?: Record<string, BackendState | null>;
  effortCatalogById?: Record<string, Record<string, EffortOption[]>>;
  defaultSelectionById?: Record<string, { baseModelId: string; effort: string | null } | null>;
  setDefaultBackend?: jest.Mock;
  applySelection?: jest.Mock;
  persistDefaultSelection?: jest.Mock;
  createSession?: jest.Mock;
  closeSession?: jest.Mock;
}): AgentSessionManager {
  return {
    getCachedBackendState: (id: string) => opts.cachedStateById?.[id] ?? null,
    getEffortCatalog: (id: string) => opts.effortCatalogById?.[id] ?? null,
    getDefaultSelection: (id: string) => opts.defaultSelectionById?.[id] ?? null,
    setDefaultBackend: opts.setDefaultBackend ?? jest.fn(),
    applySelection: opts.applySelection ?? jest.fn().mockResolvedValue(undefined),
    persistDefaultSelection: opts.persistDefaultSelection ?? jest.fn().mockResolvedValue(undefined),
    createSession: opts.createSession ?? jest.fn().mockResolvedValue(undefined),
    closeSession: opts.closeSession ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as AgentSessionManager;
}

const emptySettings = {} as CopilotSettings;

// ---- buildPickerEntries ----

describe("buildPickerEntries", () => {
  it("hides non-active backend sections once the active session has history", () => {
    const codex = makeDescriptor("codex");
    const claude = makeDescriptor("claude");
    const codexEntry = makeModelEntry("gpt-5");
    const claudeEntry = makeModelEntry("opus");
    const manager = makeManager({
      cachedStateById: {
        codex: { model: makeModelState("gpt-5", [codexEntry]), mode: null },
        claude: { model: makeModelState("opus", [claudeEntry]), mode: null },
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
    // Only the "visible" model is in the cached catalog — the active "ghost"
    // is not, so synth-fallback should fire.
    const manager = makeManager({
      cachedStateById: {
        codex: { model: makeModelState("real-model", [visible]), mode: null },
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
      cachedStateById: {
        codex: { model: makeModelState("gpt-5", [entry]), mode: null },
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
    // Only the first model is enabled; the second must be dropped from the
    // picker even though the agent reports it.
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
      cachedStateById: {
        opencode: {
          model: makeModelState("anthropic/claude-sonnet-4-6", [enabled, disabled]),
          mode: null,
        },
      },
    });
    const ctx: ModelActiveContext = {
      activeSession: null,
      activeChatUIState: null,
      activeBackendId: null,
      activeDescriptor: undefined,
      activeSessionHasHistory: false,
      activeModelState: null,
      activeCurrentEntry: undefined,
    };
    const { entries } = buildPickerEntries(manager, [opencode], ctx, emptySettings);
    expect(entries.map((e) => e.name)).toEqual(["anthropic/claude-sonnet-4-6"]);
  });

  it("drops every model not in the enabled set except the kept one", () => {
    // An empty enabled set curates nothing in, so only keepBaseModelId
    // survives. `dropped` is neither enabled nor kept.
    const kept = makeModelEntry("kept-model");
    const dropped = makeModelEntry("dropped-model");
    const opencode = {
      ...makeDescriptor("opencode"),
      getEnabledModelEntries: () => [],
    } as unknown as BackendDescriptor;
    const manager = makeManager({
      cachedStateById: {
        opencode: { model: makeModelState("kept-model", [kept, dropped]), mode: null },
      },
    });
    const ctx: ModelActiveContext = {
      activeSession: { backendId: "opencode" } as unknown as AgentSession,
      activeChatUIState: null,
      activeBackendId: "opencode",
      activeDescriptor: opencode,
      activeSessionHasHistory: false,
      activeModelState: makeModelState("kept-model", [kept, dropped]),
      activeCurrentEntry: kept,
    };
    const { entries } = buildPickerEntries(manager, [opencode], ctx, emptySettings);
    expect(entries.map((e) => e.name)).toEqual(["kept-model"]);
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
      cachedStateById: {
        codex: { model: makeModelState("gpt-5", [entry]), mode: null },
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
      cachedStateById: {
        codex: { model: makeModelState("real-model", [visible]), mode: null },
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

  it("keeps the sticky active model even when the enabled set excludes it", () => {
    // The active (sticky) model is no longer in the enabled set, but
    // keepBaseModelId must preserve it so curation never strands the
    // running selection.
    const sticky = makeModelEntry("anthropic/claude-haiku");
    const opencode = {
      ...makeDescriptor("opencode"),
      // Empty enabled set — nothing curated in.
      getEnabledModelEntries: () => [],
    } as unknown as BackendDescriptor;
    const manager = makeManager({
      cachedStateById: {
        opencode: { model: makeModelState("anthropic/claude-haiku", [sticky]), mode: null },
      },
    });
    const ctx: ModelActiveContext = {
      activeSession: { backendId: "opencode" } as unknown as AgentSession,
      activeChatUIState: null,
      activeBackendId: "opencode",
      activeDescriptor: opencode,
      activeSessionHasHistory: false,
      activeModelState: makeModelState("anthropic/claude-haiku", [sticky]),
      activeCurrentEntry: sticky,
    };
    const { entries } = buildPickerEntries(manager, [opencode], ctx, emptySettings);
    expect(entries.map((e) => e.name)).toEqual(["anthropic/claude-haiku"]);
  });
});

// ---- appendBackendSection (enabled-driven credential flags) ----

describe("appendBackendSection — getEnabledModelEntries path", () => {
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
      // Only `c` is reported by the agent; `d` is keyed+ok but unreported.
      backendModels: [makeModelEntry("openrouter/c", "Reported C")],
      keepBaseModelId: null,
      settings: emptySettings,
    });
    const byId = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byId["openrouter/a"]._disabledReason).toBe("Add API key");
    expect(byId["openrouter/c"]._disabledReason).toBeUndefined();
    expect(byId["openrouter/d"]._disabledReason).toBe("Not offered by agent");
    // Reported metadata enriches the row name when present.
    expect(byId["openrouter/c"].displayName).toBe("Reported C");
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
      keepBaseModelId: null,
      settings: emptySettings,
    });
    const byId = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byId["opencode/big-pickle"]._isFree).toBe(true);
    expect(byId["lmstudio/gpt-oss-20b"]._isFree).toBe(false);
  });

  it("flags a stale, unreported agent-native model as 'not offered by agent'", () => {
    // claude/codex entries are always credentialState "ok"; an enabled id the
    // agent no longer reports renders flagged rather than silently hidden.
    const claude = {
      ...makeDescriptor("claude"),
      getEnabledModelEntries: () => [
        { baseModelId: "opus-4-5", name: "Opus 4.5", credentialState: "ok" as const },
        { baseModelId: "retired-model", name: "Retired", credentialState: "ok" as const },
      ],
    } as unknown as BackendDescriptor;
    const entries: ModelSelectorEntry[] = [];
    appendBackendSection(entries, claude, {
      backendModels: [makeModelEntry("opus-4-5", "Opus 4.5")],
      keepBaseModelId: null,
      settings: emptySettings,
    });
    const byId = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byId["opus-4-5"]._disabledReason).toBeUndefined();
    expect(byId["retired-model"]._disabledReason).toBe("Not offered by agent");
  });

  it("appends a reported keepBaseModelId not already in the enabled set", () => {
    const entries: ModelSelectorEntry[] = [];
    appendBackendSection(
      entries,
      opencodeWithEntries([{ baseModelId: "openrouter/a", name: "A", credentialState: "ok" }]),
      {
        backendModels: [makeModelEntry("openrouter/a"), makeModelEntry("sticky")],
        keepBaseModelId: "sticky",
        settings: emptySettings,
      }
    );
    const names = entries.map((e) => e.name);
    expect(names).toContain("sticky");
    expect(entries.find((e) => e.name === "sticky")?._disabledReason).toBeUndefined();
  });

  it("defers to the loading placeholder during preload (no reported catalog yet)", () => {
    const entries: ModelSelectorEntry[] = [];
    appendBackendSection(
      entries,
      opencodeWithEntries([{ baseModelId: "openrouter/a", name: "A", credentialState: "ok" }]),
      { backendModels: null, keepBaseModelId: null, settings: emptySettings }
    );
    // No flags before the catalog loads — buildPickerEntries shows "Loading…".
    expect(entries).toHaveLength(0);
  });
});

// ---- buildEffortSibling ----

describe("buildEffortSibling", () => {
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

// ---- buildModelOnChange ----

describe("buildModelOnChange", () => {
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
    const createSession = jest.fn().mockResolvedValue(undefined);
    const setDefaultBackend = jest.fn();
    const closeSession = jest.fn().mockResolvedValue(undefined);
    const manager = makeManager({
      persistDefaultSelection,
      createSession,
      setDefaultBackend,
      closeSession,
      // The legacy single-arg path seeds effort from the target's persisted
      // (settings-managed) default, but must not write it back.
      defaultSelectionById: { claude: { baseModelId: "old", effort: "low" } },
    });
    const entries = [pickerEntry("claude", "opus")];
    const onChange = buildModelOnChange(manager, ctxFor("codex"), entries);
    onChange("claude:opus|agent");
    // Allow the IIFE to run.
    await new Promise((r) => window.setTimeout(r, 0));
    expect(persistDefaultSelection).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith("claude", { baseModelId: "opus", effort: "low" });
    expect(setDefaultBackend).toHaveBeenCalledWith("claude");
    expect(closeSession).toHaveBeenCalledWith("tab-1");
  });

  it("ignores entries with no _backendId or unresolvable baseModelId", () => {
    const setDefaultBackend = jest.fn();
    const applySelection = jest.fn();
    const manager = makeManager({ setDefaultBackend, applySelection });
    const entries = [
      { name: "no-backend", provider: "agent", enabled: true, isBuiltIn: false, displayName: "x" },
    ];
    const onChange = buildModelOnChange(manager, ctxFor("codex"), entries);
    // Bare `name|provider` form — entry has no `_backendId`.
    onChange("no-backend|agent");
    expect(setDefaultBackend).not.toHaveBeenCalled();
    expect(applySelection).not.toHaveBeenCalled();
  });
});

// ---- buildEffortOptionsByModelKey ----

describe("buildEffortOptionsByModelKey", () => {
  const ACTIVE = "github-copilot/gpt-5.4";
  const OTHER = "opencode/nemotron-3-super-free";

  function stateWithEffort(
    currentBaseId: string,
    available: { baseModelId: string; effortOptions: EffortOption[] }[]
  ): BackendState {
    return {
      model: {
        current: { baseModelId: currentBaseId, effort: null },
        apply: { kind: "setConfigOption", configId: "model" },
        availableModels: available.map((a) => ({
          baseModelId: a.baseModelId,
          name: a.baseModelId,
          provider: null,
          effortOptions: a.effortOptions,
        })),
      },
      mode: null,
    };
  }

  it("prefers live effort for the active model and falls back to the prefetch cache for others", () => {
    const opencode = makeDescriptor("opencode");
    const manager = makeManager({
      cachedStateById: {
        opencode: stateWithEffort(ACTIVE, [
          { baseModelId: ACTIVE, effortOptions: [{ value: "high", label: "high" }] },
          { baseModelId: OTHER, effortOptions: [] }, // not active → no live effort
        ]),
      },
      effortCatalogById: {
        opencode: {
          [ACTIVE]: [{ value: "low", label: "low" }], // ignored — live wins
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

  it("returns empty when neither live nor cached effort exists", () => {
    const opencode = makeDescriptor("opencode");
    const manager = makeManager({
      cachedStateById: {
        opencode: stateWithEffort(OTHER, [{ baseModelId: OTHER, effortOptions: [] }]),
      },
      effortCatalogById: { opencode: {} },
    });
    const entries = [synthesizeAgentEntry(OTHER, OTHER, opencode)];
    const out = buildEffortOptionsByModelKey(manager, entries);
    expect(out[getModelKeyFromModel(entries[0])]).toEqual([]);
  });
});
