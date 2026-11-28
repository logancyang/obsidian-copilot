import type { SessionOp, SessionState } from "@copilot/protocol/session";

export type ScopeId = string;

export type ClientFrame =
  | { type: "subscribe"; scope: ScopeId }
  | { type: "unsubscribe"; scope: ScopeId };

export type HostFrame =
  | { type: "snapshot"; scope: ScopeId; seq: number; state: SessionState }
  | { type: "ops"; scope: ScopeId; from: number; ops: readonly SessionOp[] };
