import type { ModelInfo, SessionConfigOption, SessionModelState } from "@agentclientprotocol/sdk";
import type { BackendDescriptor } from "@/agentMode/session/types";

/**
 * One option in the effort picker. `value: null` is the bare/"Default"
 * variant — it always renders as "Default" and selects the unsuffixed
 * modelId (or the bare config-option value, when the backend uses one).
 */
export interface EffortOption {
  value: string | null;
  label: string;
}

/**
 * Normalized effort picker state. Backed by either opencode-style modelId
 * variants or claude-code-style `SessionConfigOption`; the picker UI sees
 * exactly this shape regardless.
 */
export interface EffortAdapter {
  /**
   * Which mechanism produced this adapter. Lets the picker check the right
   * ACP capability flag (`session/set_model` vs `session/set_config_option`)
   * without re-introspecting the descriptor — important when both surfaces
   * are defined and `buildEffortAdapter` falls through from one to the other.
   */
  kind: "model" | "configOption";
  /** Display order: "Default" (null) first when present, then variants in observed order. */
  options: EffortOption[];
  /** Currently selected effort. `null` for the bare/"Default" variant. */
  currentValue: string | null;
  /**
   * Apply a user pick. The descriptor decides which ACP call to make and
   * which persistence hook to invoke; both are abstracted behind `ctx`.
   */
  applyEffort(value: string | null, ctx: EffortApplyContext): Promise<void>;
  /** True when the underlying ACP capability isn't available right now. */
  disabled?: boolean;
}

export interface EffortApplyContext {
  setSessionModel(modelId: string): Promise<void>;
  setSessionConfigOption(configId: string, value: string): Promise<void>;
  /** Persist the new selection to the backend's settings. */
  persistModelSelection(modelId: string): Promise<void>;
  /** Persist the chosen effort (configOption backends only). */
  persistEffort(value: string): Promise<void>;
}

/**
 * Build an `EffortAdapter` from session state, dispatching on which
 * mechanism the descriptor implements. Returns `null` when effort doesn't
 * apply (no parseable variants, no matching configOption).
 */
export function buildEffortAdapter(
  descriptor: BackendDescriptor,
  input: {
    modelState: SessionModelState | null;
    configOptions: SessionConfigOption[] | null;
  }
): EffortAdapter | null {
  if (descriptor.parseEffortFromModelId && descriptor.composeModelId) {
    const a = buildModelIdEffortAdapter(descriptor, input.modelState);
    if (a) return a;
  }
  if (descriptor.findEffortConfigOption) {
    const opt = descriptor.findEffortConfigOption(input.configOptions);
    if (opt && opt.type === "select") return buildConfigOptionEffortAdapter(opt);
  }
  return null;
}

/**
 * Collapse opencode-style per-variant entries into one `ModelInfo` per
 * base id. Backends that don't implement `parseEffortFromModelId` get an
 * identity transform.
 *
 * Bucket survivor: prefer the bare entry when present (so its `name` is
 * the clean display name); otherwise fall back to the first advertised
 * variant in observation order, with its trailing " (effort)" suffix
 * stripped. The fallback keeps the concrete variant `modelId` because some
 * backends never advertise the unsuffixed base id.
 */
export function dedupeAvailableModels(
  models: ReadonlyArray<ModelInfo>,
  descriptor: BackendDescriptor
): ModelInfo[] {
  if (!descriptor.parseEffortFromModelId) return [...models];

  const buckets = new Map<
    string,
    { bare: ModelInfo | null; first: ModelInfo; firstEffort: string }
  >();
  const order: string[] = [];

  for (const m of models) {
    const parsed = descriptor.parseEffortFromModelId(m.modelId);
    // Unparseable id → keep as its own bucket so we don't merge it with
    // unrelated entries.
    const baseId = parsed?.baseId ?? m.modelId;
    const effort = parsed?.effort ?? null;
    const bucket = buckets.get(baseId);
    if (!bucket) {
      buckets.set(baseId, {
        bare: effort === null ? m : null,
        first: m,
        firstEffort: effort ?? "",
      });
      order.push(baseId);
    } else if (effort === null && !bucket.bare) {
      bucket.bare = m;
    }
  }

  return order.map((baseId) => {
    const b = buckets.get(baseId)!;
    if (b.bare) return b.bare;
    const cleaned = stripEffortSuffix(b.first.name, b.firstEffort);
    return { ...b.first, name: cleaned || baseId };
  });
}

/**
 * Strip a trailing " (effort)" annotation from a model display name so the
 * dropdown row reads as the base model. Returns the original when no effort
 * is provided, or when the suffix isn't present.
 */
export function stripEffortSuffix(name: string, effort: string | null | undefined): string {
  if (!effort) return name;
  return name.replace(new RegExp(`\\s*\\(${escapeRegExp(effort)}\\)\\s*$`), "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build an effort adapter from opencode-style modelId variants. Returns
 * `null` when the current model has fewer than 2 variants (no picker to
 * show).
 */
function buildModelIdEffortAdapter(
  descriptor: BackendDescriptor,
  modelState: SessionModelState | null
): EffortAdapter | null {
  if (!modelState) return null;
  const parseFn = descriptor.parseEffortFromModelId!;
  const composeFn = descriptor.composeModelId!;

  const current = parseFn(modelState.currentModelId);
  if (!current) return null;

  // Collect every entry sharing this baseId, in observation order.
  const variants: { effort: string | null; modelId: string }[] = [];
  for (const m of modelState.availableModels) {
    const p = parseFn(m.modelId);
    if (!p || p.baseId !== current.baseId) continue;
    if (variants.some((v) => v.effort === p.effort)) continue;
    variants.push({ effort: p.effort, modelId: m.modelId });
  }

  if (variants.length < 2) return null;

  const hasBare = variants.some((v) => v.effort === null);
  const options: EffortOption[] = [];
  if (hasBare) options.push({ value: null, label: "Default" });
  for (const v of variants) {
    if (v.effort === null) continue;
    options.push({ value: v.effort, label: titleCase(v.effort) });
  }

  return {
    kind: "model",
    options,
    currentValue: current.effort,
    applyEffort: async (value, ctx) => {
      const id = composeFn(current.baseId, value);
      await ctx.setSessionModel(id);
      await ctx.persistModelSelection(id);
    },
  };
}

function buildConfigOptionEffortAdapter(opt: SessionConfigOption): EffortAdapter | null {
  if (opt.type !== "select") return null;
  const optionsRaw = opt.options;
  // SessionConfigSelectOptions can be either flat or grouped; flatten
  // grouped form so the picker treats them uniformly.
  const flat: { value: string; name: string }[] = [];
  for (const entry of optionsRaw) {
    if ("options" in entry) {
      for (const inner of entry.options) flat.push({ value: inner.value, name: inner.name });
    } else {
      flat.push({ value: entry.value, name: entry.name });
    }
  }
  if (flat.length === 0) return null;

  const options: EffortOption[] = flat.map((o) => ({
    value: o.value,
    label: o.name || titleCase(o.value),
  }));
  // SessionConfigSelect.currentValue is always a string (per schema).
  const currentValue = String(opt.currentValue);
  const configId = opt.id;

  return {
    kind: "configOption",
    options,
    currentValue,
    applyEffort: async (value, ctx) => {
      // ConfigOption-style efforts have no "Default"/null variant — every
      // option is a concrete selectable value. Treat null as a no-op.
      if (value === null) return;
      await ctx.setSessionConfigOption(configId, value);
      await ctx.persistEffort(value);
    },
  };
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
