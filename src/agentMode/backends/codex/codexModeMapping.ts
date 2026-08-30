import type { ModeMapping, RawModeState } from "@/agentMode/session/types";

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
      default: advertised.has("agent") ? "agent" : undefined,
      plan: advertised.has("read-only") ? "read-only" : undefined,
      auto: advertised.has("agent-full-access") ? "agent-full-access" : undefined,
    },
    readOnlyModeId: advertised.has("read-only") ? "read-only" : null,
  };
}
