import type { SessionOp, SessionState } from "@copilot/protocol/session";

export const PROTOCOL_VERSION = 1;

export type ScopeId = string;

// No command crosses yet; each step that moves a chat action onto the protocol adds its variant. https://github.com/Brevilabs/obsidian-copilot-private/issues/609
export type Command = never;

export type CommandResult =
  | { ok: true; value: unknown }
  | { ok: false; code: "unknown_command"; message: string };

export type ClientFrame =
  | { type: "hello"; version: number }
  | { type: "subscribe"; scope: ScopeId; fromSeq?: number }
  | { type: "unsubscribe"; scope: ScopeId }
  | { type: "command"; id: string; command: Command };

export type HostFrame =
  | { type: "hello"; version: number; accepted: boolean }
  | { type: "snapshot"; scope: ScopeId; seq: number; state: SessionState }
  | { type: "ops"; scope: ScopeId; from: number; ops: readonly SessionOp[] }
  | { type: "result"; id: string; result: CommandResult };
