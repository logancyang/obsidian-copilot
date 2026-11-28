import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { ClientFrame, HostFrame } from "@copilot/protocol/frames";
import {
  applySessionOp,
  EMPTY_SESSION_STATE,
  type LiveChatId,
  type SessionOp,
  type SessionState,
} from "@copilot/protocol/session";

export type HostChat = Pick<AgentSession, "subscribe" | "getSessionUsage" | "getPlanUsage">;

export interface HostChats {
  getSession(id: string): HostChat | null;
}

type Connection = (frame: HostFrame) => void;

interface LiveChat {
  chat: HostChat;
  state: SessionState;
  seq: number;
  subscribers: Set<Connection>;
  stopListening: () => void;
}

export class SessionHost {
  private readonly liveChats = new Map<LiveChatId, LiveChat>();

  constructor(private readonly chats: HostChats) {}

  connect(connection: Connection): (frame: ClientFrame) => void {
    return (frame) => this.receive(connection, frame);
  }

  dispose(): void {
    for (const live of this.liveChats.values()) live.stopListening();
    this.liveChats.clear();
  }

  private receive(connection: Connection, frame: ClientFrame): void {
    switch (frame.type) {
      case "subscribe":
        this.subscribe(connection, frame.liveChatId);
        return;
      case "unsubscribe":
        this.unsubscribe(connection, frame.liveChatId);
        return;
    }
  }

  private subscribe(connection: Connection, liveChatId: LiveChatId): void {
    const live = this.liveChats.get(liveChatId) ?? this.open(liveChatId);
    if (!live) {
      connection({ type: "snapshot", liveChatId, seq: 0, state: EMPTY_SESSION_STATE });
      return;
    }
    live.subscribers.add(connection);
    connection({ type: "snapshot", liveChatId, seq: live.seq, state: live.state });
  }

  private unsubscribe(connection: Connection, liveChatId: LiveChatId): void {
    const live = this.liveChats.get(liveChatId);
    if (!live) return;
    live.subscribers.delete(connection);
    if (live.subscribers.size > 0) return;
    live.stopListening();
    this.liveChats.delete(liveChatId);
  }

  private open(liveChatId: LiveChatId): LiveChat | null {
    const chat = this.chats.getSession(liveChatId);
    if (!chat) return null;
    const live: LiveChat = {
      chat,
      state: { usage: chat.getSessionUsage(), planUsage: chat.getPlanUsage() },
      seq: 0,
      subscribers: new Set(),
      stopListening: () => {},
    };
    // The chat batches its streaming notifications, so ops leave on that batch and no timer of the host's own. https://github.com/Brevilabs/obsidian-copilot-private/issues/609
    live.stopListening = chat.subscribe({
      onMessagesChanged: () => this.publish(liveChatId, live),
      onStatusChanged: () => {},
    });
    this.liveChats.set(liveChatId, live);
    return live;
  }

  private publish(liveChatId: LiveChatId, live: LiveChat): void {
    const ops: SessionOp[] = [];
    const usage = live.chat.getSessionUsage();
    if (usage !== live.state.usage) ops.push({ type: "slice", key: "usage", value: usage });
    const planUsage = live.chat.getPlanUsage();
    if (planUsage !== live.state.planUsage) {
      ops.push({ type: "slice", key: "planUsage", value: planUsage });
    }
    if (ops.length === 0) return;
    const from = live.seq + 1;
    live.state = ops.reduce(applySessionOp, live.state);
    live.seq += ops.length;
    for (const connection of live.subscribers) {
      connection({ type: "ops", liveChatId, from, ops });
    }
  }
}
