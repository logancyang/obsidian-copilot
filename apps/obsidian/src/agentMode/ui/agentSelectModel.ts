import type { BackendDescriptor, BackendId, InstallState } from "@/agentMode/session/types";

export type AgentSelectStatus =
  | "checking"
  | "installed"
  | "outdated"
  | "absent"
  | "error"
  | "signed-out";

export interface AgentSelectRow {
  id: BackendId;
  name: string;
  description: string;
  status: AgentSelectStatus;
  recommended: boolean;
  statusMessage: string | null;
}

export type AgentSelectAction = "start" | "configure" | "wait";

export interface AgentSelectCta {
  label: string;
  note: string | null;
  action: AgentSelectAction;
}

const EMPTY_AGENT_SELECT_ROWS: readonly AgentSelectRow[] = Object.freeze([]);

function toSelectStatus(kind: InstallState["kind"]): AgentSelectStatus {
  switch (kind) {
    case "ready":
      return "installed";
    case "checking":
      return "checking";
    case "incompatible":
      return "outdated";
    case "error":
      return "error";
    case "absent":
      return "absent";
  }
}

function statusMessageOf(state: InstallState): string | null {
  return state.kind === "incompatible" || state.kind === "error" ? state.message : null;
}

export function buildAgentSelectRows(
  descriptors: readonly BackendDescriptor[],
  states: Partial<Record<BackendId, InstallState>>,
  recommendedId: BackendId
): readonly AgentSelectRow[] {
  if (descriptors.length === 0) return EMPTY_AGENT_SELECT_ROWS;
  return descriptors.map((descriptor) => {
    const state = states[descriptor.id] ?? { kind: "absent" as const };
    return {
      id: descriptor.id,
      name: descriptor.displayName,
      description: descriptor.setupDescription,
      status: toSelectStatus(state.kind),
      recommended: descriptor.id === recommendedId,
      statusMessage: statusMessageOf(state),
    };
  });
}

export function resolveAgentSelectCta(row: AgentSelectRow): AgentSelectCta {
  if (row.status === "checking") {
    return {
      label: "Checking…",
      note: `Checking ${row.name} setup…`,
      action: "wait",
    };
  }
  if (row.status === "installed") {
    return { label: "Start chat", note: null, action: "start" };
  }
  return {
    label: "Configure",
    note: row.statusMessage ?? `${row.name} isn't set up on this machine yet.`,
    action: "configure",
  };
}
