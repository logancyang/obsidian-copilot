import type { PlanUsage } from "@copilot/protocol/planUsage";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";

export type SessionId = string;

export type LiveChatId = string;

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

export type SliceOp<S> = {
  [K in keyof S]: { type: "slice"; key: K; value: S[K] };
}[keyof S];

export type SessionOp = SliceOp<SessionState>;

export function applySliceOp<S extends object>(state: S, op: SliceOp<S>): S {
  if (Object.is(state[op.key], op.value)) return state;
  return { ...state, [op.key]: op.value };
}

export function applySessionOp(state: SessionState, op: SessionOp): SessionState {
  return applySliceOp(state, op);
}
