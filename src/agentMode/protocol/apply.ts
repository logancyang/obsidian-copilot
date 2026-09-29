import { applyTranscriptOp } from "@/agentMode/protocol/applyTranscript";
import type { HostOp, SessionOp } from "@/agentMode/protocol/ops";
import type {
  HostFlags,
  HostState,
  SessionState,
  TabPatch,
  TabSummary,
} from "@/agentMode/protocol/state";

function patchTab(tab: TabSummary, patch: TabPatch): TabSummary {
  const keys = Object.keys(patch) as (keyof TabPatch)[];
  if (keys.every((key) => tab[key] === patch[key])) return tab;
  return { ...tab, ...patch };
}

function patchFlags(flags: HostFlags, patch: Partial<HostFlags>): HostFlags {
  const keys = Object.keys(patch) as (keyof HostFlags)[];
  if (keys.every((key) => flags[key] === patch[key])) return flags;
  return { ...flags, ...patch };
}

export function applyHostOp(state: HostState, op: HostOp): HostState {
  switch (op.t) {
    case "tab.add": {
      const others = state.tabs.filter((tab) => tab.id !== op.tab.id);
      const index = Math.min(Math.max(op.index, 0), others.length);
      return { ...state, tabs: [...others.slice(0, index), op.tab, ...others.slice(index)] };
    }
    case "tab.remove": {
      if (!state.tabs.some((tab) => tab.id === op.id)) return state;
      return { ...state, tabs: state.tabs.filter((tab) => tab.id !== op.id) };
    }
    case "tab.patch": {
      const index = state.tabs.findIndex((tab) => tab.id === op.id);
      if (index === -1) return state;
      const next = patchTab(state.tabs[index], op.patch);
      if (next === state.tabs[index]) return state;
      const tabs = state.tabs.slice();
      tabs[index] = next;
      return { ...state, tabs };
    }
    case "backend.set": {
      if (state.backends[op.index] === op.backend) return state;
      const others = state.backends.filter((backend) => backend.id !== op.backend.id);
      const index = Math.min(Math.max(op.index, 0), others.length);
      return {
        ...state,
        backends: [...others.slice(0, index), op.backend, ...others.slice(index)],
      };
    }
    case "host.patch": {
      const host = patchFlags(state.host, op.patch);
      return host === state.host ? state : { ...state, host };
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
