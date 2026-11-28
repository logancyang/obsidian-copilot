import type { SessionOp, SessionState } from "@copilot/protocol/session";

export const PROTOCOL_VERSION = 1;

export type ScopeId = string;

export type ClientFrame =
  | { type: "hello"; version: number }
  | { type: "subscribe"; scope: ScopeId; fromSeq?: number }
  | { type: "unsubscribe"; scope: ScopeId };

export type HostFrame =
  | { type: "hello"; version: number; accepted: boolean }
  | { type: "snapshot"; scope: ScopeId; seq: number; state: SessionState }
  | { type: "ops"; scope: ScopeId; from: number; ops: readonly SessionOp[] };
