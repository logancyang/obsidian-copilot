import type {
  BackendConfigOption,
  BackendDescriptor,
  BackendModelInfo,
  RawModelState,
  RawModeState,
  BackendState,
  CopilotMode,
  EffortOption,
  ModeApplySpec,
  ModeMapping,
  ModeOption,
  ModelApplySpec,
  ModelEntry,
  ModelSelection,
  ModelState,
} from "@/agentMode/session/types";

const CANONICAL_ORDER: CopilotMode[] = ["default", "plan", "auto"];
const CANONICAL_LABELS: Record<CopilotMode, string> = {
  default: "Default",
  plan: "Plan",
  auto: "Auto",
};

/**
 * Backend-supplied raw catalogs — what a backend has after `session/new`
 * (or after a wire-format → neutral conversion). Backends call
 * `translateBackendState` with this and the descriptor to produce the
 * normalized `BackendState` consumers see.
 */
export interface BackendStateInputs {
  models: RawModelState | null;
  modes: RawModeState | null;
  configOptions: BackendConfigOption[] | null;
}

/**
 * Project a backend's neutral catalogs onto the unified `BackendState`
 * consumers use. Pure function — depends only on the inputs and the
 * descriptor's wire codec + mode mapping. Re-running on every state
 * mutation is cheap.
 */
export function translateBackendState(
  inputs: BackendStateInputs,
  descriptor: BackendDescriptor
): BackendState {
  return {
    model: translateModel(inputs, descriptor),
    mode: translateMode(inputs, descriptor),
  };
}

/**
 * Look up the rich `ModelEntry` for a given `baseModelId` in a
 * `ModelState`. Provided as a tiny session-layer helper so consumers
 * that need name/description/effortOptions for the current selection
 * don't open-code the lookup.
 */
export function findModelEntry(
  state: ModelState | null | undefined,
  baseModelId: string
): ModelEntry | undefined {
  return state?.availableModels.find((e) => e.baseModelId === baseModelId);
}

function translateModel(
  inputs: BackendStateInputs,
  descriptor: BackendDescriptor
): ModelState | null {
  // Prefer the dedicated `models` state (codex, claude, opencode ≤ 1.15.12).
  // Newer opencode (≥ 1.15.13) dropped that field and advertises its catalog
  // only through a generic `category:"model"` select config option, switched
  // via `session/set_config_option` instead of `session/set_model`.
  const fromConfig = inputs.models ? null : modelStateFromConfigOption(inputs.configOptions);
  const modelState = inputs.models ?? fromConfig?.state ?? null;
  if (!modelState) return null;
  const effortFromConfig = fromConfig ? effortConfigOption(inputs.configOptions) : null;
  const apply: ModelApplySpec = fromConfig
    ? {
        kind: "setConfigOption",
        configId: fromConfig.configId,
        ...(effortFromConfig ? { effortConfigId: effortFromConfig.id } : {}),
      }
    : { kind: "setModel" };

  // Group advertised wire ids by baseModelId, preserving first-seen order.
  type Group = {
    baseModelId: string;
    provider: string | null;
    name: string;
    description?: string;
    /** Per-effort entries for suffix-style backends (decoded from wire ids). */
    variants: { effort: string | null; wireId: string }[];
  };
  const groups: Group[] = [];
  const groupByBase = new Map<string, Group>();

  for (const m of modelState.availableModels) {
    const decoded = descriptor.wire.decode(m.modelId);
    const baseId = decoded.selection.baseModelId;
    const existing = groupByBase.get(baseId);
    const group: Group =
      existing ??
      (() => {
        const fresh: Group = {
          baseModelId: baseId,
          provider: decoded.provider,
          name: m.name,
          description: m.description ?? undefined,
          variants: [],
        };
        groupByBase.set(baseId, fresh);
        groups.push(fresh);
        return fresh;
      })();
    if (!group.variants.some((v) => v.effort === decoded.selection.effort)) {
      group.variants.push({ effort: decoded.selection.effort, wireId: m.modelId });
    }
  }

  const availableModels: ModelEntry[] = groups.map((g) => ({
    baseModelId: g.baseModelId,
    // Strip a trailing `(<effort>)` only when the group has multiple
    // variants — those rows render an effort dropdown, so the suffix
    // becomes redundant. The recognized vocabulary comes from the
    // variants themselves (decoded by the descriptor's wire codec),
    // so backends own their effort tokens — we don't duplicate them.
    name: normalizeName(
      g.variants.length >= 2 ? stripEffortSuffix(g.name, g.variants) : g.name,
      descriptor
    ),
    // Only backends that opt in surface their per-model blurb; others (opencode)
    // would just add noisy/duplicative lines, so the field is dropped here.
    description: descriptor.showModelDescriptions ? g.description : undefined,
    provider: g.provider,
    effortOptions: deriveEffortOptions(g, descriptor),
  }));

  // Build current. The agent's currentModelId may decompose into a
  // baseModelId not present in availableModels (rare; stale probe state).
  // In that case, synthesize an entry and append so the current selection
  // always has a corresponding entry in `availableModels`.
  const decodedCurrent = descriptor.wire.decode(modelState.currentModelId);
  const currentBaseId = decodedCurrent.selection.baseModelId;
  let currentEntry = availableModels.find((e) => e.baseModelId === currentBaseId);
  if (!currentEntry) {
    const synthEffortOptions = descriptor.wire.effortConfigFor
      ? optionsFromConfigOption(descriptor.wire.effortConfigFor(currentBaseId))
      : [];
    currentEntry = {
      baseModelId: currentBaseId,
      name: normalizeName(currentBaseId, descriptor),
      provider: decodedCurrent.provider,
      effortOptions: synthEffortOptions,
    };
    availableModels.push(currentEntry);
  }
  // A thought-level option describes only the currently selected model; other
  // models may expose a different variant set after they become active.
  if (effortFromConfig) {
    currentEntry.effortOptions = optionsFromConfigOption(effortFromConfig);
  }

  const current: ModelSelection = {
    baseModelId: currentEntry.baseModelId,
    effort: resolveCurrentEffort(
      decodedCurrent.selection.effort,
      currentEntry,
      descriptor,
      inputs.configOptions,
      effortFromConfig
    ),
  };

  return { current, availableModels, apply };
}

/**
 * Fallback model source for backends that advertise their catalog only via a
 * generic `category:"model"` select config option (opencode ≥ 1.15.13) instead
 * of a dedicated `RawModelState`. Flattens grouped options like
 * `optionsFromConfigOption`. Returns the synthesized `RawModelState` plus the
 * option id (so the caller can route switches through `set_config_option`), or
 * `null` when no populated model option exists — leaving `model` null for
 * backends that report nothing.
 */
function modelStateFromConfigOption(
  configOptions: BackendConfigOption[] | null
): { state: RawModelState; configId: string } | null {
  if (!configOptions) return null;
  const opt = configOptions.find((o) => o.category === "model" && o.type === "select");
  if (!opt || opt.type !== "select") return null;
  const availableModels: BackendModelInfo[] = [];
  for (const entry of opt.options) {
    if ("options" in entry) {
      for (const inner of entry.options) {
        availableModels.push({
          modelId: inner.value,
          name: inner.name,
          description: inner.description,
        });
      }
    } else {
      availableModels.push({
        modelId: entry.value,
        name: entry.name,
        description: entry.description,
      });
    }
  }
  if (availableModels.length === 0) return null;
  return {
    state: { currentModelId: String(opt.currentValue), availableModels },
    configId: opt.id,
  };
}

function effortConfigOption(
  configOptions: BackendConfigOption[] | null
): BackendConfigOption | null {
  return configOptions?.find((o) => o.category === "thought_level" && o.type === "select") ?? null;
}

function deriveEffortOptions(
  group: { variants: { effort: string | null; wireId: string }[]; baseModelId: string },
  descriptor: BackendDescriptor
): EffortOption[] {
  // Suffix-style: ≥2 variants for the same base means we have an effort
  // dimension encoded in the wire id.
  if (group.variants.length >= 2) {
    const options: EffortOption[] = [];
    const hasBare = group.variants.some((v) => v.effort === null);
    if (hasBare) options.push({ value: null, label: "default" });
    for (const v of group.variants) {
      if (v.effort === null) continue;
      options.push({ value: v.effort, label: v.effort.toLowerCase() });
    }
    return options;
  }
  // Descriptor-style: ask the codec for a per-model effort option.
  if (descriptor.wire.effortConfigFor) {
    const opt = descriptor.wire.effortConfigFor(group.baseModelId);
    return optionsFromConfigOption(opt);
  }
  return [];
}

function optionsFromConfigOption(opt: BackendConfigOption | null): EffortOption[] {
  if (!opt || opt.type !== "select") return [];
  const flat: { value: string; name: string }[] = [];
  for (const entry of opt.options) {
    if ("options" in entry) {
      for (const inner of entry.options) flat.push({ value: inner.value, name: inner.name });
    } else {
      flat.push({ value: entry.value, name: entry.name });
    }
  }
  return flat.map((o) => ({ value: o.value, label: (o.name || o.value).toLowerCase() }));
}

/**
 * Resolve `current.effort` for the active selection. For suffix-style
 * (effort encoded in wire id), the decoded value wins. For descriptor-
 * style, prefer the live `currentValue` from `inputs.configOptions`
 * (matched by the spec's id) so user effort changes round-trip; fall
 * back to the spec's default when the agent hasn't reported one yet.
 * The result is snapped to an option that exists in
 * `currentEntry.effortOptions`; otherwise null.
 */
function resolveCurrentEffort(
  decodedEffort: string | null,
  currentEntry: ModelEntry,
  descriptor: BackendDescriptor,
  configOptions: BackendConfigOption[] | null,
  effortFromConfig: BackendConfigOption | null = null
): string | null {
  let candidate: string | null = decodedEffort;
  if (candidate === null && effortFromConfig?.type === "select") {
    candidate = String(effortFromConfig.currentValue);
  }
  if (candidate === null && descriptor.wire.effortConfigFor) {
    const spec = descriptor.wire.effortConfigFor(currentEntry.baseModelId);
    if (spec && spec.type === "select") {
      const live = configOptions?.find((c) => c.id === spec.id);
      const liveValue = live && live.type === "select" ? String(live.currentValue) : null;
      candidate = liveValue ?? (spec.currentValue != null ? String(spec.currentValue) : null);
    }
  }
  if (candidate === null) {
    return currentEntry.effortOptions.some((o) => o.value === null) ? null : null;
  }
  if (currentEntry.effortOptions.some((o) => o.value === candidate)) return candidate;
  return null;
}

function translateMode(
  inputs: BackendStateInputs,
  descriptor: BackendDescriptor
): BackendState["mode"] {
  const mapping = descriptor.getModeMapping?.(inputs.modes, inputs.configOptions);
  if (!mapping) return null;
  if (mapping.kind === "setMode") return translateSetModeMapping(mapping, inputs.modes);
  return translateConfigOptionModeMapping(mapping, inputs.configOptions);
}

function translateSetModeMapping(
  mapping: ModeMapping,
  modeState: RawModeState | null
): BackendState["mode"] {
  if (!modeState) return null;
  const advertised = new Set(modeState.availableModes.map((m) => m.id));
  const options: ModeOption[] = [];
  const apply: Partial<Record<CopilotMode, ModeApplySpec>> = {};
  for (const value of CANONICAL_ORDER) {
    const native = mapping.canonical[value];
    if (!native || !advertised.has(native)) continue;
    options.push({ value, label: CANONICAL_LABELS[value] });
    apply[value] = { kind: "setMode", nativeId: native };
  }
  if (options.length === 0) return null;
  const current = reverseProjectMode(mapping.canonical, modeState.currentModeId, options);
  return { current, options, apply };
}

function translateConfigOptionModeMapping(
  mapping: ModeMapping,
  configOptions: BackendConfigOption[] | null
): BackendState["mode"] {
  if (!mapping.configId || !configOptions) return null;
  const opt = configOptions.find((o) => o.id === mapping.configId);
  if (!opt || opt.type !== "select") return null;

  const flatValues = new Set<string>();
  for (const entry of opt.options) {
    if ("options" in entry) {
      for (const inner of entry.options) flatValues.add(inner.value);
    } else {
      flatValues.add(entry.value);
    }
  }

  const options: ModeOption[] = [];
  const apply: Partial<Record<CopilotMode, ModeApplySpec>> = {};
  for (const value of CANONICAL_ORDER) {
    const native = mapping.canonical[value];
    if (!native || !flatValues.has(native)) continue;
    options.push({ value, label: CANONICAL_LABELS[value] });
    apply[value] = { kind: "setConfigOption", configId: opt.id, value: native };
  }
  if (options.length === 0) return null;

  const current = reverseProjectMode(mapping.canonical, String(opt.currentValue), options);
  return { current, options, apply };
}

/**
 * Reverse-project a native mode id back to a canonical Copilot mode.
 * Returns `null` when the agent is sitting in a mode the descriptor
 * doesn't map (e.g. Claude's `acceptEdits` — intentionally hidden).
 */
function reverseProjectMode(
  canonical: ModeMapping["canonical"],
  nativeId: string,
  visibleOptions: ModeOption[]
): CopilotMode | null {
  const visible = new Set(visibleOptions.map((o) => o.value));
  for (const opt of CANONICAL_ORDER) {
    if (!visible.has(opt)) continue;
    if (canonical[opt] === nativeId) return opt;
  }
  return null;
}

/** Apply the descriptor's optional display-name normalization, if any. */
function normalizeName(name: string, descriptor: BackendDescriptor): string {
  return descriptor.normalizeModelName?.(name) ?? name;
}

function stripEffortSuffix(name: string, variants: { effort: string | null }[]): string {
  const m = name.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (!m) return name;
  const efforts = new Set(variants.flatMap((v) => (v.effort ? [v.effort.toLowerCase()] : [])));
  if (!efforts.has(m[2].toLowerCase())) return name;
  return m[1].trim();
}

/**
 * Stable signature of the model slice of a `BackendState`. Used by the
 * model+effort picker hook to invalidate its memo only on model-relevant
 * changes.
 */
export function modelStateSignature(state: BackendState | null): string {
  const m = state?.model;
  if (!m) return "";
  const apply =
    m.apply.kind === "setConfigOption"
      ? `setConfigOption:${m.apply.configId}:${m.apply.effortConfigId ?? ""}`
      : m.apply.kind;
  return [
    m.current.baseModelId,
    m.current.effort ?? "",
    apply,
    m.availableModels
      .map(
        (e) =>
          `${e.baseModelId}:${e.provider ?? ""}:${e.effortOptions
            .map((o) => o.value ?? "_")
            .join("|")}`
      )
      .join(","),
  ].join("/");
}

/**
 * Stable signature of the mode slice of a `BackendState`. Used by the mode
 * picker hook to invalidate its memo only on mode-relevant changes. Includes
 * each option's apply-spec kind so capability flips (`setMode` ↔
 * `setConfigOption`) propagate.
 */
export function modeStateSignature(state: BackendState | null): string {
  const md = state?.mode;
  if (!md) return "";
  const apply = md.options.map((o) => `${o.value}:${md.apply[o.value]?.kind ?? ""}`).join(",");
  return `${md.current ?? ""}|${apply}`;
}

/**
 * Stable signature of a normalized `BackendState`. Used by the preloader
 * to skip notifying listeners on no-op updates.
 */
export function backendStateSignature(state: BackendState | null): string {
  if (!state) return "";
  return `${modelStateSignature(state)}#${modeStateSignature(state)}`;
}
