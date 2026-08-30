import type { ModeMapping, RawModeState } from "@/agentMode/session/types";

const ANTIGRAVITY_MODE_CANDIDATES = {
  default: ["agent", "default", "ask"],
  plan: ["plan", "read-only"],
  auto: ["auto", "full-access", "yolo"],
} as const;

function firstAdvertised(
  advertised: ReadonlySet<string>,
  candidates: readonly string[]
): string | undefined {
  return candidates.find((candidate) => advertised.has(candidate));
}

/**
 * Antigravity ACP adapters advertise their native mode vocabulary at runtime.
 * Map the canonical Copilot modes (default / plan / auto) to the first matching
 * candidate advertised by the adapter. When modeState is null (no live state),
 * return null so AgentSessionManager preserves the live spec without overriding it.
 */
export function buildAntigravityModeMapping(modeState: RawModeState | null): ModeMapping | null {
  if (!modeState) {
    return null;
  }
  const advertised = new Set(modeState.availableModes.map((m) => m.id));
  return {
    kind: "setMode",
    canonical: {
      default: firstAdvertised(advertised, ANTIGRAVITY_MODE_CANDIDATES.default),
      plan: firstAdvertised(advertised, ANTIGRAVITY_MODE_CANDIDATES.plan),
      auto: firstAdvertised(advertised, ANTIGRAVITY_MODE_CANDIDATES.auto),
    },
    readOnlyModeId: advertised.has("read-only")
      ? "read-only"
      : advertised.has("plan")
        ? "plan"
        : null,
  };
}
