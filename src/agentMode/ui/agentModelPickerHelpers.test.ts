import {
  buildEffortSibling,
  buildModelOnChange,
  buildPickerEntries,
  resolveActiveDisplayState,
} from "./agentModelPickerHelpers";
import type {
  BackendDescriptor,
  BackendState,
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
    model: { current: { baseModelId: modelId, effort: null }, availableModels: [entry] },
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
  defaultSelectionById?: Record<string, { baseModelId: string; effort: string | null } | null>;
  setDefaultBackend?: jest.Mock;
  applySelection?: jest.Mock;
  persistDefaultSelection?: jest.Mock;
  createSession?: jest.Mock;
  closeSession?: jest.Mock;
}): AgentSessionManager {
  return {
    getCachedBackendState: (id: string) => opts.cachedStateById?.[id] ?? null,
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

  it("cross-backend pick persists the new (model, effort) on the target backend before creating the session", async () => {
    const persistDefaultSelection = jest.fn().mockResolvedValue(undefined);
    const createSession = jest.fn().mockResolvedValue(undefined);
    const setDefaultBackend = jest.fn();
    const closeSession = jest.fn().mockResolvedValue(undefined);
    const callOrder: string[] = [];
    persistDefaultSelection.mockImplementation(async () => {
      callOrder.push("persist");
    });
    createSession.mockImplementation(async () => {
      callOrder.push("create");
    });
    const manager = makeManager({
      persistDefaultSelection,
      createSession,
      setDefaultBackend,
      closeSession,
      defaultSelectionById: { claude: { baseModelId: "old", effort: "low" } },
    });
    const entries = [pickerEntry("claude", "opus")];
    const onChange = buildModelOnChange(manager, ctxFor("codex"), entries);
    onChange("claude:opus|agent");
    // Allow the IIFE to run.
    await new Promise((r) => window.setTimeout(r, 0));
    expect(persistDefaultSelection).toHaveBeenCalledWith("claude", {
      baseModelId: "opus",
      effort: "low",
    });
    expect(createSession).toHaveBeenCalledWith("claude");
    expect(callOrder).toEqual(["persist", "create"]);
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
