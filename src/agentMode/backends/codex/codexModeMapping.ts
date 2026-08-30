import type { ModeMapping, RawModeState } from "@/agentMode/session/types";

const CODEX_MODE_CANDIDATES = {
  default: ["agent", "auto", "default"],
  plan: ["plan", "read-only"],
  auto: ["agent-full-access", "full-access", "bypassPermissions"],
} as const;

function firstAdvertised(
  advertised: ReadonlySet<string>,
  candidates: readonly string[]
): string | undefined {
  return candidates.find((candidate) => advertised.has(candidate));
}

/**
 * Codex ACP adapters have used multiple native mode vocabularies. Resolve
 * against the live inventory so an adapter rename cannot silently remove the
 * user's path out of a restrictive mode.
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
      default: firstAdvertised(advertised, CODEX_MODE_CANDIDATES.default),
      plan: firstAdvertised(advertised, CODEX_MODE_CANDIDATES.plan),
      auto: firstAdvertised(advertised, CODEX_MODE_CANDIDATES.auto),
    },
    readOnlyModeId: advertised.has("read-only") ? "read-only" : null,
  };
}
