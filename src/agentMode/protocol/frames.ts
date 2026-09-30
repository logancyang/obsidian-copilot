import type { Command, CommandResult } from "@/agentMode/protocol/commands";
import type { HostOp, SessionOp } from "@/agentMode/protocol/ops";
import type { HostState, Scope, SessionState } from "@/agentMode/protocol/state";

export const PROTOCOL_VERSION = 1;

export type ClientFrame =
  | { type: "hello"; v: number; app: string }
  | { type: "subscribe"; scope: Scope; fromSeq?: number }
  | { type: "unsubscribe"; scope: Scope }
  | { type: "command"; id: string; command: Command };

export type ServerFrame =
  | { type: "hello"; v: number; app: string; hostId: string; ok: boolean }
  | { type: "snapshot"; scope: Scope; seq: number; state: HostState | SessionState | null }
  | { type: "ops"; scope: Scope; from: number; ops: readonly (HostOp | SessionOp)[] }
  | { type: "result"; id: string; result: CommandResult<unknown> };
