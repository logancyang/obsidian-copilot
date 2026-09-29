import type { Command, CommandResult } from "@/agentMode/protocol/commands";
import type { HostOp, SessionOp } from "@/agentMode/protocol/ops";
import type { HostState, Scope, SessionState } from "@/agentMode/protocol/state";
import type { SessionId } from "@/agentMode/session/types";

export const PROTOCOL_VERSION = 1;

// A cursor is a position in one op log, so it names the log (`epoch`) as well as the position
// (`seq`). A host that restarts, or a session that is swapped in behind an existing id, starts a
// new log whose sequence numbers overlap the old one; without the epoch a reconnecting client
// would resume from a position that belongs to a different log and silently corrupt its replica.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export type ClientFrame =
  | { type: "hello"; v: number; app: string }
  | { type: "subscribe"; scope: Scope; fromSeq?: number; epoch?: string }
  | { type: "unsubscribe"; scope: Scope }
  | { type: "focus"; sessionId: SessionId | null }
  | { type: "command"; id: string; command: Command };

export type ServerFrame =
  | { type: "hello"; v: number; app: string; hostId: string; ok: boolean }
  | {
      type: "snapshot";
      scope: Scope;
      epoch: string;
      seq: number;
      state: HostState | SessionState | null;
    }
  | {
      type: "ops";
      scope: Scope;
      epoch: string;
      from: number;
      ops: readonly (HostOp | SessionOp)[];
    }
  | { type: "result"; id: string; result: CommandResult<unknown> };
