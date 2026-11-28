import type { LiveChatId, SessionOp, SessionState } from "@copilot/protocol/session";

export type ClientFrame =
  | { type: "subscribe"; liveChatId: LiveChatId }
  | { type: "unsubscribe"; liveChatId: LiveChatId };

export type HostFrame =
  | { type: "snapshot"; liveChatId: LiveChatId; seq: number; state: SessionState }
  | { type: "ops"; liveChatId: LiveChatId; from: number; ops: readonly SessionOp[] };
