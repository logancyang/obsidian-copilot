import type { HostOp, HostState } from "@copilot/protocol/host";
import type { LiveChatId, SessionOp, SessionState } from "@copilot/protocol/session";

export type ChatFeed = { feed: "chat"; liveChatId: LiveChatId };

export type HostFeed = { feed: "host" };

export type ClientFrame = { type: "subscribe" | "unsubscribe" } & (ChatFeed | HostFeed);

export type HostFrame =
  | (ChatFeed & { type: "snapshot"; seq: number; state: SessionState })
  | (ChatFeed & { type: "ops"; from: number; ops: readonly SessionOp[] })
  | (HostFeed & { type: "snapshot"; seq: number; state: HostState })
  | (HostFeed & { type: "ops"; from: number; ops: readonly HostOp[] });
