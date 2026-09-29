import { applyTranscriptOp } from "@/agentMode/protocol/applyTranscript";
import type { HostOp, SessionOp } from "@/agentMode/protocol/ops";
import type { HostState, SessionState, TabPatch, TabSummary } from "@/agentMode/protocol/state";

function patchTab(tab: TabSummary, patch: TabPatch): TabSummary {
  const keys = Object.keys(patch) as (keyof TabPatch)[];
  if (keys.every((key) => tab[key] === patch[key])) return tab;
  return { ...tab, ...patch };
}

export function applyHostOp(state: HostState, op: HostOp): HostState {
  switch (op.t) {
    case "tab.add": {
      const others = state.tabs.filter((tab) => tab.id !== op.tab.id);
      const index = Math.min(Math.max(op.index, 0), others.length);
      return { tabs: [...others.slice(0, index), op.tab, ...others.slice(index)] };
    }
    case "tab.remove": {
      if (!state.tabs.some((tab) => tab.id === op.id)) return state;
      return { tabs: state.tabs.filter((tab) => tab.id !== op.id) };
    }
    case "tab.patch": {
      const index = state.tabs.findIndex((tab) => tab.id === op.id);
      if (index === -1) return state;
      const next = patchTab(state.tabs[index], op.patch);
      if (next === state.tabs[index]) return state;
      const tabs = state.tabs.slice();
      tabs[index] = next;
      return { tabs };
    }
  }
}

export function applySessionOp(state: SessionState, op: SessionOp): SessionState {
  if (op.t === "slice") {
    if (Object.is(state[op.key], op.value)) return state;
    return { ...state, [op.key]: op.value };
  }
  const transcript = applyTranscriptOp(state.transcript, op);
  return transcript === state.transcript ? state : { ...state, transcript };
}
