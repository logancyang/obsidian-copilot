import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import type { BackendDescriptor } from "@/agentMode/session/types";

/**
 * Copilot's canonical operational modes for Agent Mode. Each backend's
 * `getModeMapping` projects these onto its own native mode/agent ids.
 *
 *   - `default` — balanced; agent may write/exec but the user must approve
 *                 each permission request. Picked when the user hasn't
 *                 explicitly selected a mode.
 *   - `plan`    — agent drafts a plan; no writes.
 *   - `auto`    — same as default, but bypass all permission prompts.
 */
export type CopilotMode = "default" | "plan" | "auto";

/** One option in the mode picker — a Copilot-canonical mode the backend supports. */
export interface ModeOption {
  value: CopilotMode;
  label: string;
}

/**
 * Per-backend mapping from canonical Copilot modes to native ids the agent
 * understands. Returned by descriptors via `getModeMapping(...)`.
 *
 *   - `kind: "setMode"`     — apply via ACP `session/set_mode`. `canonical`
 *     values are matched against `SessionModeState.availableModes[].id`.
 *   - `kind: "configOption"`— apply via ACP `session/set_config_option`.
 *     `configId` names the option; `canonical` values are matched against
 *     that select option's enum values.
 */
export interface ModeMapping {
  kind: "setMode" | "configOption";
  /** Required when `kind === "configOption"`. Ignored for `setMode`. */
  configId?: string;
  canonical: Partial<Record<CopilotMode, string>>;
}

/**
 * Normalized mode picker state, regardless of whether the backend uses
 * `session/set_mode` or `session/set_config_option`. The picker UI sees
 * exactly this shape.
 */
export interface ModeAdapter {
  kind: "setMode" | "configOption";
  /** Display order: default → plan → auto, filtered to supported entries. */
  options: ModeOption[];
  /** Canonical projection of the agent's current mode, or `null` if not mapped. */
  currentValue: CopilotMode | null;
  applyMode(value: CopilotMode, ctx: ModeApplyContext): Promise<void>;
  /** True when the underlying ACP capability isn't available right now. */
  disabled?: boolean;
}

export interface ModeApplyContext {
  setSessionMode(modeId: string): Promise<void>;
  setSessionConfigOption(configId: string, value: string): Promise<void>;
  /** Persist the new selection to the backend's settings. */
  persistMode(value: CopilotMode): Promise<void>;
}

const CANONICAL_ORDER: CopilotMode[] = ["default", "plan", "auto"];
const CANONICAL_LABELS: Record<CopilotMode, string> = {
  default: "Default",
  plan: "Plan",
  auto: "Auto",
};

/**
 * Build a `ModeAdapter` from session state, dispatching on the descriptor's
 * `getModeMapping`. Returns `null` when modes don't apply to this backend
 * or no canonical options resolve against the live state.
 */
export function buildModeAdapter(
  descriptor: BackendDescriptor,
  input: {
    modeState: SessionModeState | null;
    configOptions: SessionConfigOption[] | null;
  }
): ModeAdapter | null {
  const mapping = descriptor.getModeMapping?.(input.modeState, input.configOptions);
  if (!mapping) return null;
  if (mapping.kind === "setMode") return buildSetModeAdapter(mapping, input.modeState);
  return buildConfigOptionModeAdapter(mapping, input.configOptions);
}

/**
 * Build a setMode-style adapter. Filters canonical options to those whose
 * native id is currently advertised by the agent. `currentValue` reverse-
 * projects the agent's `currentModeId` back to its canonical name.
 */
function buildSetModeAdapter(
  mapping: ModeMapping,
  modeState: SessionModeState | null
): ModeAdapter | null {
  if (!modeState) return null;
  const advertised = new Set(modeState.availableModes.map((m) => m.id));
  const options: ModeOption[] = [];
  for (const value of CANONICAL_ORDER) {
    const native = mapping.canonical[value];
    if (!native || !advertised.has(native)) continue;
    options.push({ value, label: CANONICAL_LABELS[value] });
  }
  if (options.length === 0) return null;

  const currentValue = reverseProject(mapping.canonical, modeState.currentModeId, options);

  return {
    kind: "setMode",
    options,
    currentValue,
    applyMode: async (value, ctx) => {
      const native = mapping.canonical[value];
      if (!native) return;
      await ctx.setSessionMode(native);
      await ctx.persistMode(value);
    },
  };
}

/**
 * Build a configOption-style adapter. Looks up the matching select option
 * by `configId`, filters canonical options to those whose native id is
 * present in the select's enum, and returns a picker that applies via
 * `session/set_config_option`.
 */
function buildConfigOptionModeAdapter(
  mapping: ModeMapping,
  configOptions: SessionConfigOption[] | null
): ModeAdapter | null {
  if (!mapping.configId || !configOptions) return null;
  const opt = configOptions.find((o) => o.id === mapping.configId);
  if (!opt || opt.type !== "select") return null;

  // SessionConfigSelectOptions can be either flat or grouped; flatten so
  // the picker matches uniformly.
  const flatValues = new Set<string>();
  for (const entry of opt.options) {
    if ("options" in entry) {
      for (const inner of entry.options) flatValues.add(inner.value);
    } else {
      flatValues.add(entry.value);
    }
  }

  const options: ModeOption[] = [];
  for (const value of CANONICAL_ORDER) {
    const native = mapping.canonical[value];
    if (!native || !flatValues.has(native)) continue;
    options.push({ value, label: CANONICAL_LABELS[value] });
  }
  if (options.length === 0) return null;

  const currentValue = reverseProject(mapping.canonical, String(opt.currentValue), options);
  const configId = opt.id;

  return {
    kind: "configOption",
    options,
    currentValue,
    applyMode: async (value, ctx) => {
      const native = mapping.canonical[value];
      if (!native) return;
      await ctx.setSessionConfigOption(configId, native);
      await ctx.persistMode(value);
    },
  };
}

/**
 * Project a native mode id back to a canonical Copilot mode. Returns `null`
 * when the agent is sitting in a mode the descriptor doesn't map (e.g.
 * Claude's `acceptEdits` — intentionally hidden from the picker).
 */
function reverseProject(
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
