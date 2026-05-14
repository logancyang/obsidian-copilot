import {
  backendStateSignature,
  findModelEntry,
  modelStateSignature,
  modeStateSignature,
  translateBackendState,
} from "./translateBackendState";
import type { BackendState } from "./types";
import type {
  BackendConfigOption,
  BackendDescriptor,
  RawModeState,
  RawModelState,
  ModeMapping,
  ModelWireCodec,
} from "./types";

/** Default codec: no provider, no effort. Treats wire id as the bare baseModelId. */
const passthroughWire: ModelWireCodec = {
  encode: (sel) => sel.baseModelId,
  decode: (id) => ({ selection: { baseModelId: id, effort: null }, provider: null }),
};

function descriptor(opts: Partial<BackendDescriptor> = {}): BackendDescriptor {
  return {
    id: "test",
    displayName: "Test",
    wire: passthroughWire,
    getInstallState: () => ({ kind: "ready", source: "managed" }),
    subscribeInstallState: () => () => {},
    openInstallUI: () => undefined,
    createBackendProcess: () =>
      ({}) as unknown as ReturnType<BackendDescriptor["createBackendProcess"]>,
    ...opts,
  } as unknown as BackendDescriptor;
}

/** Suffix-style codec: `<provider>/<base>[/<effort>]`. */
const suffixWire: ModelWireCodec = {
  encode: (sel) => (sel.effort ? `${sel.baseModelId}/${sel.effort}` : sel.baseModelId),
  decode: (id) => {
    if (!id) return { selection: { baseModelId: id, effort: null }, provider: null };
    const segments = id.split("/");
    if (segments.length === 1) {
      return { selection: { baseModelId: id, effort: null }, provider: null };
    }
    if (segments.length === 2) {
      return { selection: { baseModelId: id, effort: null }, provider: segments[0] };
    }
    if (segments.length === 3) {
      return {
        selection: { baseModelId: `${segments[0]}/${segments[1]}`, effort: segments[2] },
        provider: segments[0],
      };
    }
    return { selection: { baseModelId: id, effort: null }, provider: null };
  },
};

function suffixDescriptor(extra: Partial<BackendDescriptor> = {}): BackendDescriptor {
  return descriptor({ wire: suffixWire, ...extra });
}

function selectOption(
  id: string,
  values: { value: string; name?: string }[],
  current?: string
): BackendConfigOption {
  return {
    id,
    type: "select",
    category: null,
    name: id,
    currentValue: current ?? values[0]?.value,
    options: values.map((v) => ({ value: v.value, name: v.name ?? v.value })),
  };
}

describe("translateBackendState — model: null cases", () => {
  it("returns model: null when raw.models is null (case 1)", () => {
    const state = translateBackendState(
      { models: null, modes: null, configOptions: null },
      descriptor()
    );
    expect(state.model).toBeNull();
  });
});

describe("translateBackendState — suffix-style backends", () => {
  it("collapses gpt-5 + variants into one entry with effort options (case 2)", () => {
    const models: RawModelState = {
      currentModelId: "openai/gpt-5/low",
      availableModels: [
        { modelId: "openai/gpt-5", name: "GPT-5" },
        { modelId: "openai/gpt-5/low", name: "GPT-5 (low)" },
        { modelId: "openai/gpt-5/medium", name: "GPT-5 (medium)" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    expect(state.model).not.toBeNull();
    expect(state.model!.availableModels).toHaveLength(1);
    const entry = state.model!.availableModels[0];
    expect(entry.baseModelId).toBe("openai/gpt-5");
    expect(entry.provider).toBe("openai");
    expect(entry.effortOptions.map((o) => o.value)).toEqual([null, "low", "medium"]);
    expect(state.model!.current.baseModelId).toBe(entry.baseModelId);
    expect(state.model!.current.effort).toBe("low");
  });

  it("multi-provider catalog produces one entry per base with own provider (case 3)", () => {
    const models: RawModelState = {
      currentModelId: "openai/gpt-5/low",
      availableModels: [
        { modelId: "openai/gpt-5/low", name: "GPT-5 (low)" },
        { modelId: "anthropic/claude-sonnet-4-5/low", name: "Sonnet (low)" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    const entries = state.model!.availableModels;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ baseModelId: "openai/gpt-5", provider: "openai" });
    expect(entries[1]).toMatchObject({
      baseModelId: "anthropic/claude-sonnet-4-5",
      provider: "anthropic",
    });
  });

  it("single-variant base produces empty effortOptions (case 4)", () => {
    const models: RawModelState = {
      currentModelId: "openai/gpt-5",
      availableModels: [{ modelId: "openai/gpt-5", name: "GPT-5" }],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    expect(state.model!.availableModels[0].effortOptions).toEqual([]);
    expect(state.model!.current.effort).toBeNull();
  });

  it("mixed catalog: some bases have variants, some don't (case 5)", () => {
    const models: RawModelState = {
      currentModelId: "openai/gpt-5/medium",
      availableModels: [
        { modelId: "openai/gpt-5", name: "GPT-5" },
        { modelId: "openai/gpt-5/medium", name: "GPT-5 (medium)" },
        { modelId: "anthropic/sonnet", name: "Sonnet" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    const entries = state.model!.availableModels;
    const gpt = entries.find((e) => e.baseModelId === "openai/gpt-5")!;
    const sonnet = entries.find((e) => e.baseModelId === "anthropic/sonnet")!;
    expect(gpt.effortOptions.map((o) => o.value)).toEqual([null, "medium"]);
    expect(sonnet.effortOptions).toEqual([]);
  });

  it("current selection with effort suffix is reachable in availableModels (case 9)", () => {
    const models: RawModelState = {
      currentModelId: "openai/gpt-5/low",
      availableModels: [
        { modelId: "openai/gpt-5", name: "GPT-5" },
        { modelId: "openai/gpt-5/low", name: "GPT-5 (low)" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    expect(state.model!.current.baseModelId).toBe("openai/gpt-5");
    expect(state.model!.current.effort).toBe("low");
    expect(findModelEntry(state.model, state.model!.current.baseModelId)).toBeDefined();
  });

  it("strips trailing effort suffix from grouped name when ≥2 variants", () => {
    const models: RawModelState = {
      currentModelId: "openai/gpt-5/low",
      availableModels: [
        { modelId: "openai/gpt-5/low", name: "GPT-5 (low)" },
        { modelId: "openai/gpt-5/medium", name: "GPT-5 (medium)" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    expect(state.model!.availableModels[0].name).toBe("GPT-5");
  });

  it("leaves single-variant names untouched even if they look like effort suffixes", () => {
    const models: RawModelState = {
      currentModelId: "x/some-model",
      availableModels: [{ modelId: "x/some-model", name: "Some Model (medium)" }],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    expect(state.model!.availableModels[0].name).toBe("Some Model (medium)");
  });
});

describe("translateBackendState — descriptor-style backends", () => {
  function effortDescriptor(map: Record<string, BackendConfigOption | null>): BackendDescriptor {
    return descriptor({
      wire: {
        encode: passthroughWire.encode,
        decode: passthroughWire.decode,
        effortConfigFor: (baseModelId: string) => map[baseModelId] ?? null,
      },
    });
  }

  it("populates effortOptions for every model with a configOption (case 6)", () => {
    const opt = selectOption("effort", [{ value: "low" }, { value: "high" }]);
    const models: RawModelState = {
      currentModelId: "claude-sonnet",
      availableModels: [
        { modelId: "claude-sonnet", name: "Sonnet" },
        { modelId: "claude-opus", name: "Opus" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      effortDescriptor({ "claude-sonnet": opt, "claude-opus": opt })
    );
    expect(state.model!.availableModels[0].effortOptions.map((o) => o.value)).toEqual([
      "low",
      "high",
    ]);
    expect(state.model!.availableModels[1].effortOptions.map((o) => o.value)).toEqual([
      "low",
      "high",
    ]);
  });

  it("Haiku-style model with no effort returns empty effortOptions (case 7)", () => {
    const sonnetOpt = selectOption("effort", [{ value: "low" }, { value: "high" }]);
    const models: RawModelState = {
      currentModelId: "claude-haiku",
      availableModels: [
        { modelId: "claude-sonnet", name: "Sonnet" },
        { modelId: "claude-haiku", name: "Haiku" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      effortDescriptor({ "claude-sonnet": sonnetOpt, "claude-haiku": null })
    );
    const haiku = state.model!.availableModels.find((e) => e.baseModelId === "claude-haiku")!;
    expect(haiku.effortOptions).toEqual([]);
    expect(state.model!.current.baseModelId).toBe(haiku.baseModelId);
    expect(state.model!.current.effort).toBeNull();
  });

  it("descriptor-style current effort uses live configOptions when present (case 10)", () => {
    const spec = selectOption(
      "effort",
      [{ value: "low" }, { value: "medium" }, { value: "high" }],
      "low"
    );
    const liveOpts: BackendConfigOption[] = [
      selectOption("effort", [{ value: "low" }, { value: "medium" }, { value: "high" }], "high"),
    ];
    const models: RawModelState = {
      currentModelId: "claude-sonnet",
      availableModels: [{ modelId: "claude-sonnet", name: "Sonnet" }],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: liveOpts },
      effortDescriptor({ "claude-sonnet": spec })
    );
    expect(state.model!.current.effort).toBe("high");
  });

  it("descriptor-style current effort falls back to spec.currentValue without live opts (case 10)", () => {
    const spec = selectOption(
      "effort",
      [{ value: "low" }, { value: "medium" }, { value: "high" }],
      "medium"
    );
    const models: RawModelState = {
      currentModelId: "claude-sonnet",
      availableModels: [{ modelId: "claude-sonnet", name: "Sonnet" }],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      effortDescriptor({ "claude-sonnet": spec })
    );
    expect(state.model!.current.effort).toBe("medium");
  });

  it("Haiku has no effort dimension — current.effort: null (case 11)", () => {
    const models: RawModelState = {
      currentModelId: "claude-haiku",
      availableModels: [{ modelId: "claude-haiku", name: "Haiku" }],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      effortDescriptor({ "claude-haiku": null })
    );
    expect(state.model!.current.effort).toBeNull();
    expect(findModelEntry(state.model, state.model!.current.baseModelId)!.effortOptions).toEqual(
      []
    );
  });
});

describe("translateBackendState — provider/parsing edge cases", () => {
  it("provider precompute — entries preserve per-id provider (case 8)", () => {
    const models: RawModelState = {
      currentModelId: "openai/gpt-5",
      availableModels: [
        { modelId: "openai/gpt-5", name: "GPT-5" },
        { modelId: "free-form-id", name: "FF" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    const gpt = state.model!.availableModels.find((e) => e.baseModelId === "openai/gpt-5")!;
    const ff = state.model!.availableModels.find((e) => e.baseModelId === "free-form-id")!;
    expect(gpt.provider).toBe("openai");
    expect(ff.provider).toBeNull();
  });

  it("currentModelId not in availableModels — translator synthesizes entry (case 12)", () => {
    const models: RawModelState = {
      currentModelId: "openai/missing",
      availableModels: [{ modelId: "openai/gpt-5", name: "GPT-5" }],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    expect(state.model!.availableModels).toHaveLength(2);
    expect(state.model!.current.baseModelId).toBe("openai/missing");
    expect(findModelEntry(state.model, state.model!.current.baseModelId)).toBeDefined();
  });

  it("backend with passthrough codec and no descriptor effort hook (case 13)", () => {
    const models: RawModelState = {
      currentModelId: "x/y",
      availableModels: [
        { modelId: "x/y", name: "x/y" },
        { modelId: "p/q", name: "p/q" },
      ],
    };
    const state = translateBackendState({ models, modes: null, configOptions: null }, descriptor());
    for (const e of state.model!.availableModels) {
      expect(e.effortOptions).toEqual([]);
      expect(e.provider).toBeNull();
    }
    expect(state.model!.current.effort).toBeNull();
  });

  it("description present / absent round-trips (case 14)", () => {
    const models: RawModelState = {
      currentModelId: "claude-sonnet",
      availableModels: [
        { modelId: "claude-sonnet", name: "Sonnet", description: "Smart and balanced" },
        { modelId: "claude-haiku", name: "Haiku" },
      ],
    };
    const state = translateBackendState({ models, modes: null, configOptions: null }, descriptor());
    expect(state.model!.availableModels[0].description).toBe("Smart and balanced");
    expect(state.model!.availableModels[1].description).toBeUndefined();
  });

  it("EffortOption shape from suffix grouping ≡ shape from effortConfigFor (case 15)", () => {
    // Suffix path: gpt-5 with low/medium/high
    const suffixModels: RawModelState = {
      currentModelId: "openai/gpt-5/medium",
      availableModels: [
        { modelId: "openai/gpt-5/low", name: "GPT-5 (low)" },
        { modelId: "openai/gpt-5/medium", name: "GPT-5 (medium)" },
        { modelId: "openai/gpt-5/high", name: "GPT-5 (high)" },
      ],
    };
    const suffixState = translateBackendState(
      { models: suffixModels, modes: null, configOptions: null },
      suffixDescriptor()
    );
    const suffixOpts = suffixState.model!.availableModels[0].effortOptions;

    // Descriptor path: same effort levels via effortConfigFor
    const cfgOpt = selectOption("effort", [
      { value: "low" },
      { value: "medium" },
      { value: "high" },
    ]);
    const descrModels: RawModelState = {
      currentModelId: "claude-sonnet",
      availableModels: [{ modelId: "claude-sonnet", name: "Sonnet" }],
    };
    const descrState = translateBackendState(
      { models: descrModels, modes: null, configOptions: null },
      descriptor({
        wire: {
          encode: passthroughWire.encode,
          decode: passthroughWire.decode,
          effortConfigFor: () => cfgOpt,
        },
      })
    );
    const descrOpts = descrState.model!.availableModels[0].effortOptions;

    // Both produce {value, label} shape — labels differ (Default vs from
    // configOption name) but value vocabulary aligns.
    expect(suffixOpts.every((o) => "value" in o && "label" in o)).toBe(true);
    expect(descrOpts.every((o) => "value" in o && "label" in o)).toBe(true);
    // Values: suffix path adds null when bare exists, but here it doesn't.
    expect(suffixOpts.map((o) => o.value)).toEqual(["low", "medium", "high"]);
    expect(descrOpts.map((o) => o.value)).toEqual(["low", "medium", "high"]);
  });

  it("wire.decode → wire.encode round-trip identity (case 16)", () => {
    const wireIds = ["openai/gpt-5", "openai/gpt-5/low", "anthropic/sonnet/high"];
    for (const id of wireIds) {
      const decoded = suffixWire.decode(id);
      expect(suffixWire.encode(decoded.selection)).toBe(id);
    }
  });
});

describe("translateBackendState — mode (setMode style)", () => {
  const mapping: ModeMapping = {
    kind: "setMode",
    canonical: { default: "default", plan: "plan", auto: "bypassPermissions" },
  };

  it("filters canonical options to those advertised in availableModes", () => {
    const modes: RawModeState = {
      currentModeId: "default",
      availableModes: [
        { id: "default", name: "Default" },
        { id: "plan", name: "Plan" },
      ],
    };
    const state = translateBackendState(
      { models: null, modes, configOptions: null },
      descriptor({ getModeMapping: () => mapping })
    );
    expect(state.mode).not.toBeNull();
    expect(state.mode!.options.map((o) => o.value)).toEqual(["default", "plan"]);
    expect(state.mode!.current).toBe("default");
    expect(state.mode!.apply.default).toEqual({ kind: "setMode", nativeId: "default" });
    expect(state.mode!.apply.plan).toEqual({ kind: "setMode", nativeId: "plan" });
  });

  it("returns null mode when descriptor exposes no mapping", () => {
    const modes: RawModeState = {
      currentModeId: "default",
      availableModes: [{ id: "default", name: "Default" }],
    };
    const state = translateBackendState({ models: null, modes, configOptions: null }, descriptor());
    expect(state.mode).toBeNull();
  });

  it("reverse-projects unmapped native modes to null current", () => {
    const modes: RawModeState = {
      currentModeId: "acceptEdits",
      availableModes: [
        { id: "default", name: "Default" },
        { id: "plan", name: "Plan" },
        { id: "acceptEdits", name: "Accept Edits" },
      ],
    };
    const state = translateBackendState(
      { models: null, modes, configOptions: null },
      descriptor({ getModeMapping: () => mapping })
    );
    expect(state.mode!.current).toBeNull();
  });
});

describe("translateBackendState — mode (configOption style)", () => {
  it("builds canonical options from a select configOption's enum values", () => {
    const configOptions: BackendConfigOption[] = [
      {
        id: "agent",
        type: "select",
        category: null,
        name: "Agent",
        currentValue: "build",
        options: [
          { value: "build", name: "Build" },
          { value: "plan", name: "Plan" },
        ],
      },
    ];
    const mapping: ModeMapping = {
      kind: "configOption",
      configId: "agent",
      canonical: { default: "build", plan: "plan" },
    };
    const state = translateBackendState(
      { models: null, modes: null, configOptions },
      descriptor({ getModeMapping: () => mapping })
    );
    expect(state.mode!.options.map((o) => o.value)).toEqual(["default", "plan"]);
    expect(state.mode!.current).toBe("default");
    expect(state.mode!.apply.default).toEqual({
      kind: "setConfigOption",
      configId: "agent",
      value: "build",
    });
  });
});

describe("translateBackendState — invariants", () => {
  it("current.baseModelId matches one of availableModels (case 20)", () => {
    const models: RawModelState = {
      currentModelId: "openai/gpt-5/low",
      availableModels: [
        { modelId: "openai/gpt-5", name: "GPT-5" },
        { modelId: "openai/gpt-5/low", name: "GPT-5 low" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    expect(findModelEntry(state.model, state.model!.current.baseModelId)).toBeDefined();
  });

  it("current.effort is null or matches a value in the corresponding entry's effortOptions (case 21)", () => {
    const models: RawModelState = {
      currentModelId: "openai/gpt-5/low",
      availableModels: [
        { modelId: "openai/gpt-5", name: "GPT-5" },
        { modelId: "openai/gpt-5/low", name: "GPT-5 low" },
      ],
    };
    const state = translateBackendState(
      { models, modes: null, configOptions: null },
      suffixDescriptor()
    );
    const cur = state.model!.current;
    const entry = findModelEntry(state.model, cur.baseModelId)!;
    expect(cur.effort === null || entry.effortOptions.some((o) => o.value === cur.effort)).toBe(
      true
    );
  });
});

describe("backendStateSignature", () => {
  it("is stable across structurally identical raws (case 17)", () => {
    const models: RawModelState = {
      currentModelId: "x/y",
      availableModels: [{ modelId: "x/y", name: "x/y" }],
    };
    const a = translateBackendState({ models, modes: null, configOptions: null }, descriptor());
    const b = translateBackendState({ models, modes: null, configOptions: null }, descriptor());
    expect(backendStateSignature(a)).toBe(backendStateSignature(b));
  });

  it("differs when current flips (case 18)", () => {
    const before = translateBackendState(
      {
        models: {
          currentModelId: "a",
          availableModels: [
            { modelId: "a", name: "A" },
            { modelId: "b", name: "B" },
          ],
        },
        modes: null,
        configOptions: null,
      },
      descriptor()
    );
    const after = translateBackendState(
      {
        models: {
          currentModelId: "b",
          availableModels: [
            { modelId: "a", name: "A" },
            { modelId: "b", name: "B" },
          ],
        },
        modes: null,
        configOptions: null,
      },
      descriptor()
    );
    expect(backendStateSignature(before)).not.toBe(backendStateSignature(after));
  });

  it("differs when effortOptions changes (case 19)", () => {
    const baseModels: RawModelState = {
      currentModelId: "openai/gpt-5",
      availableModels: [{ modelId: "openai/gpt-5", name: "GPT-5" }],
    };
    const before = translateBackendState(
      { models: baseModels, modes: null, configOptions: null },
      suffixDescriptor()
    );
    const after = translateBackendState(
      {
        models: {
          currentModelId: "openai/gpt-5",
          availableModels: [
            { modelId: "openai/gpt-5", name: "GPT-5" },
            { modelId: "openai/gpt-5/low", name: "GPT-5 low" },
          ],
        },
        modes: null,
        configOptions: null,
      },
      suffixDescriptor()
    );
    expect(backendStateSignature(before)).not.toBe(backendStateSignature(after));
  });
});

describe("modelStateSignature", () => {
  it("returns empty string when model is null", () => {
    expect(modelStateSignature(null)).toBe("");
    expect(modelStateSignature({ model: null, mode: null })).toBe("");
  });

  it("is identical for equivalent model slices regardless of mode", () => {
    const sharedModel: BackendState["model"] = {
      current: { baseModelId: "x", effort: null },
      availableModels: [{ baseModelId: "x", name: "X", provider: null, effortOptions: [] }],
    };
    const a: BackendState = { model: sharedModel, mode: null };
    const b: BackendState = {
      model: sharedModel,
      mode: { current: "plan", options: [{ value: "plan", label: "Plan" }], apply: {} },
    };
    expect(modelStateSignature(a)).toBe(modelStateSignature(b));
  });

  it("differs when current model flips", () => {
    const a: BackendState = {
      model: {
        current: { baseModelId: "x", effort: null },
        availableModels: [
          { baseModelId: "x", name: "X", provider: null, effortOptions: [] },
          { baseModelId: "y", name: "Y", provider: null, effortOptions: [] },
        ],
      },
      mode: null,
    };
    const b: BackendState = {
      ...a,
      model: { ...a.model!, current: { baseModelId: "y", effort: null } },
    };
    expect(modelStateSignature(a)).not.toBe(modelStateSignature(b));
  });
});

describe("modeStateSignature", () => {
  it("returns empty string when mode is null", () => {
    expect(modeStateSignature(null)).toBe("");
    expect(modeStateSignature({ model: null, mode: null })).toBe("");
  });

  it("is identical for equivalent mode slices regardless of model", () => {
    const sharedMode: BackendState["mode"] = {
      current: "plan",
      options: [{ value: "plan", label: "Plan" }],
      apply: { plan: { kind: "setMode", nativeId: "plan" } },
    };
    const a: BackendState = { model: null, mode: sharedMode };
    const b: BackendState = {
      model: {
        current: { baseModelId: "x", effort: null },
        availableModels: [{ baseModelId: "x", name: "X", provider: null, effortOptions: [] }],
      },
      mode: sharedMode,
    };
    expect(modeStateSignature(a)).toBe(modeStateSignature(b));
  });

  it("differs when current mode flips", () => {
    const opts = [
      { value: "plan" as const, label: "Plan" },
      { value: "default" as const, label: "Default" },
    ];
    const a: BackendState = {
      model: null,
      mode: { current: "plan", options: opts, apply: {} },
    };
    const b: BackendState = {
      model: null,
      mode: { current: "default", options: opts, apply: {} },
    };
    expect(modeStateSignature(a)).not.toBe(modeStateSignature(b));
  });

  it("differs when an option's apply-spec kind flips", () => {
    const opts = [{ value: "plan" as const, label: "Plan" }];
    const a: BackendState = {
      model: null,
      mode: {
        current: "plan",
        options: opts,
        apply: { plan: { kind: "setMode", nativeId: "plan" } },
      },
    };
    const b: BackendState = {
      model: null,
      mode: {
        current: "plan",
        options: opts,
        apply: { plan: { kind: "setConfigOption", configId: "mode", value: "plan" } },
      },
    };
    expect(modeStateSignature(a)).not.toBe(modeStateSignature(b));
  });
});
