import type { AgentPlanEntry } from "@/agentMode/session/types";

export function planEntryIcon(s: AgentPlanEntry["status"]): string {
  if (s === "completed") return "●";
  if (s === "in_progress") return "◐";
  return "○";
}

export function planEntryClass(s: AgentPlanEntry["status"]): string {
  return s === "completed" ? "tw-text-muted tw-line-through" : "";
}
