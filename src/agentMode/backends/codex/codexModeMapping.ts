import type {
  BackendConfigOption,
  BackendState,
  CopilotMode,
  ModeApplySpec,
  ModeMapping,
  ModeOption,
  RawModeState,
} from "@/agentMode/session/types";

/**
 * Resolve the supported Codex adapter's modes against its live inventory so a
 * partial or changed catalog cannot surface a mode the session will reject.
 */
export function buildCodexModeMapping(modeState: RawModeState | null): ModeMapping {
  if (!modeState) {
    return {
      kind: "setMode",
      // `applyMode` performs one inventory-free lookup before dispatch. Do not
      // replace the live session's translated ids with guessed legacy ids here.
      // https://github.com/logancyang/obsidian-copilot/issues/2916
      canonical: {},
      readOnlyModeId: "read-only",
    };
  }

  const advertised = new Set(modeState.availableModes.map((mode) => mode.id));
  return {
    kind: "setMode",
    canonical: {
      default: advertised.has("read-only") ? "read-only" : undefined,
      auto: advertised.has("agent") ? "agent" : undefined,
    },
    readOnlyModeId: advertised.has("read-only") ? "read-only" : null,
  };
}

/** Present Codex's collaboration workflow and approval presets as one picker. */
export function buildCodexModeState(
  modeState: RawModeState | null,
  configOptions: BackendConfigOption[] | null
): BackendState["mode"] {
  if (!modeState) return null;
  const advertised = new Set(modeState.availableModes.map((mode) => mode.id));
  const collaboration = configOptions?.find(
    (option) => option.id === "collaboration_mode" && option.type === "select"
  );
  const collaborationValues = new Set(
    collaboration?.type === "select"
      ? collaboration.options.flatMap((option) =>
          "options" in option ? option.options.map((inner) => inner.value) : [option.value]
        )
      : []
  );
  const canResetCollaboration =
    collaboration?.type === "select" && collaborationValues.has("default");
  const options: ModeOption[] = [];
  const apply: Partial<Record<CopilotMode, ModeApplySpec>> = {};

  if (advertised.has("read-only")) {
    options.push({ value: "default", label: "Default" });
    apply.default = canResetCollaboration
      ? {
          kind: "sequence",
          steps: [
            { kind: "setMode", nativeId: "read-only" },
            { kind: "setConfigOption", configId: collaboration.id, value: "default" },
          ],
        }
      : { kind: "setMode", nativeId: "read-only" };
  }

  // ACP's "read-only" ID still allows workspace edits; it selects the approval preset.
  // Planning is a separate Codex workflow.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
  if (
    advertised.has("agent") &&
    collaboration?.type === "select" &&
    collaborationValues.has("plan")
  ) {
    options.push({ value: "plan", label: "Plan" });
    apply.plan = {
      kind: "sequence",
      steps: [
        { kind: "setMode", nativeId: "agent" },
        { kind: "setConfigOption", configId: collaboration.id, value: "plan" },
      ],
    };
  }

  if (advertised.has("agent")) {
    options.push({ value: "auto", label: "Auto" });
    apply.auto = canResetCollaboration
      ? {
          kind: "sequence",
          steps: [
            { kind: "setConfigOption", configId: collaboration.id, value: "default" },
            { kind: "setMode", nativeId: "agent" },
          ],
        }
      : { kind: "setMode", nativeId: "agent" };
  }

  if (options.length === 0) return null;
  const current: CopilotMode | null =
    modeState.currentModeId === "agent" &&
    collaboration?.type === "select" &&
    collaboration.currentValue === "plan" &&
    apply.plan
      ? "plan"
      : modeState.currentModeId === "agent" &&
          (collaboration?.type !== "select" || collaboration.currentValue === "default") &&
          apply.auto
        ? "auto"
        : modeState.currentModeId === "read-only" &&
            (collaboration?.type !== "select" || collaboration.currentValue === "default") &&
            apply.default
          ? "default"
          : null;
  return { current, options, apply };
}
