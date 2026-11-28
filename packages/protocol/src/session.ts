import type { PlanUsage } from "@copilot/protocol/planUsage";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";

export type SessionId = string;

export type AgentSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

export interface SessionState {
  usage: SessionUsage | null;
  planUsage: PlanUsage | null;
}

export const EMPTY_SESSION_STATE: SessionState = Object.freeze({ usage: null, planUsage: null });

export type SessionOp = {
  [K in keyof SessionState]: { type: "slice"; key: K; value: SessionState[K] };
}[keyof SessionState];

export function applySessionOp(state: SessionState, op: SessionOp): SessionState {
  if (Object.is(state[op.key], op.value)) return state;
  return { ...state, [op.key]: op.value };
}
