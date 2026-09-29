import { applyHostOp } from "@/agentMode/protocol/apply";
import type { HostOp } from "@/agentMode/protocol/ops";
import {
  INITIAL_HOST_STATE,
  type HostState,
  type TabPatch,
  type TabSummary,
} from "@/agentMode/protocol/state";
import type { AgentSession } from "@/agentMode/session/AgentSession";

const MUTABLE_TAB_FIELDS = [
  "status",
  "label",
  "labelSource",
  "needsAttention",
  "canSwitchModel",
  "canSwitchEffort",
  "canSwitchMode",
] as const satisfies readonly (keyof TabPatch)[];

export function summarizeTab(session: AgentSession): TabSummary {
  return {
    id: session.internalId,
    chatInputId: session.chatInputId,
    backendId: session.backendId,
    projectId: session.projectId,
    status: session.getStatus(),
    label: session.getLabel(),
    labelSource: session.getLabelSource(),
    needsAttention: session.getNeedsAttention(),
    canSwitchModel: session.canSwitchModel(),
    canSwitchEffort: session.canSwitchEffort(),
    canSwitchMode: session.canSwitchMode(),
  };
}

export class TabProjector {
  private state: HostState = INITIAL_HOST_STATE;

  constructor(private readonly emit: (op: HostOp) => void) {}

  getState(): HostState {
    return this.state;
  }

  reconcile(sessions: readonly AgentSession[]): void {
    const desired = new Set(sessions.map((session) => session.internalId));
    for (const tab of this.state.tabs) {
      if (!desired.has(tab.id)) this.apply({ t: "tab.remove", id: tab.id });
    }
    sessions.forEach((session, index) => {
      const current = this.state.tabs[index];
      if (current?.id === session.internalId) return;
      this.apply({ t: "tab.add", index, tab: summarizeTab(session) });
    });
    for (const session of sessions) this.refresh(session);
  }

  refresh(session: AgentSession): void {
    const tab = this.state.tabs.find((candidate) => candidate.id === session.internalId);
    if (!tab) return;
    const next = summarizeTab(session);
    const patch: Record<string, unknown> = {};
    for (const key of MUTABLE_TAB_FIELDS) {
      if (tab[key] !== next[key]) patch[key] = next[key];
    }
    if (Object.keys(patch).length === 0) return;
    this.apply({ t: "tab.patch", id: tab.id, patch: patch });
  }

  private apply(op: HostOp): void {
    this.state = applyHostOp(this.state, op);
    this.emit(op);
  }
}
