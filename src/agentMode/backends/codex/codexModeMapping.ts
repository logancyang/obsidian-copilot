import type {
  BackendConfigOption,
  BackendState,
  CopilotMode,
  ModeMapping,
  RawModeState,
} from "@/agentMode/session/types";

/**
 * Codex's inventory-free mode table. The picker comes from
 * {@link buildCodexModeState}; this only names the preset fan-out QA turns use.
 */
export function buildCodexModeMapping(): ModeMapping {
  return {
    kind: "setMode",
    // `applyMode` performs one inventory-free lookup before dispatch. Do not
    // replace the live session's translated ids with guessed legacy ids here.
    // https://github.com/logancyang/obsidian-copilot/issues/2916
    canonical: {},
    readOnlyModeId: "read-only",
  };
}

// ACP's "read-only" ID still allows workspace edits; it selects the approval
// preset. Planning is Codex's separate collaboration workflow.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/551
const CURRENT_MODE: Record<string, CopilotMode> = {
  "read-only/default": "default",
  "agent/plan": "plan",
  "agent/default": "auto",
};

/** Present Codex's collaboration workflow and approval presets as one picker. */
export function buildCodexModeState(
  modeState: RawModeState | null,
  configOptions: BackendConfigOption[] | null
): BackendState["mode"] {
  const advertised = new Set(modeState?.availableModes.map((mode) => mode.id));
  const collaboration = configOptions?.find((option) => option.id === "collaboration_mode");
  if (!modeState || !collaboration || !advertised.has("read-only") || !advertised.has("agent")) {
    return null;
  }
  const configId = collaboration.id;
  return {
    current: CURRENT_MODE[`${modeState.currentModeId}/${collaboration.currentValue}`] ?? null,
    options: [
      { value: "default", label: "Default" },
      { value: "plan", label: "Plan" },
      { value: "auto", label: "Auto" },
    ],
    apply: {
      default: {
        kind: "sequence",
        steps: [
          { kind: "setMode", nativeId: "read-only" },
          { kind: "setConfigOption", configId, value: "default" },
        ],
      },
      plan: {
        kind: "sequence",
        steps: [
          { kind: "setMode", nativeId: "agent" },
          { kind: "setConfigOption", configId, value: "plan" },
        ],
      },
      auto: {
        kind: "sequence",
        steps: [
          { kind: "setConfigOption", configId, value: "default" },
          { kind: "setMode", nativeId: "agent" },
        ],
      },
    },
  };
}
