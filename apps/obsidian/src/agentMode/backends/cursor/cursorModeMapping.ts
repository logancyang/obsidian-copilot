import type { ModeMapping } from "@/agentMode/session/types";

export function buildCursorModeMapping(): ModeMapping {
  return {
    kind: "setMode",
    canonical: {
      default: "ask",
      plan: "plan",
      auto: "agent",
    },
  };
}
