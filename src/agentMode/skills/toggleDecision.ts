import type { BackendId, Skill } from "./types";

export type ToggleDecision =
  | { kind: "no-op" }
  | { kind: "canonical-toggle"; enabled: boolean }
  | { kind: "mirrored-remove-one"; agent: BackendId }
  | {
      kind: "migrate-confirm";
      variant: "project-single" | "project-mirrored" | "disable-last-agent";
      targetAgent: BackendId;
      action: "expandToNewAgent" | "disableLastAgent";
    };

export function decideToggleAction(
  skill: Skill,
  agent: BackendId,
  willBeEnabled: boolean
): ToggleDecision {
  if (skill.location.kind === "canonical") {
    return { kind: "canonical-toggle", enabled: willBeEnabled };
  }

  const { agentDirs } = skill.location;
  const isAlreadyEnabled = agentDirs.includes(agent);

  if (willBeEnabled) {
    if (isAlreadyEnabled) return { kind: "no-op" };
    return {
      kind: "migrate-confirm",
      variant: agentDirs.length >= 2 ? "project-mirrored" : "project-single",
      targetAgent: agent,
      action: "expandToNewAgent",
    };
  }

  if (!isAlreadyEnabled) return { kind: "no-op" };
  if (agentDirs.length === 1) {
    return {
      kind: "migrate-confirm",
      variant: "disable-last-agent",
      targetAgent: agent,
      action: "disableLastAgent",
    };
  }
  return { kind: "mirrored-remove-one", agent };
}
