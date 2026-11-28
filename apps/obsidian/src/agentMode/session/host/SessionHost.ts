import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { ClientFrame, HostFrame, ScopeId } from "@copilot/protocol/frames";
import {
  applySessionOp,
  EMPTY_SESSION_STATE,
  type SessionOp,
  type SessionState,
} from "@copilot/protocol/session";

export type HostChat = Pick<AgentSession, "subscribe" | "getSessionUsage" | "getPlanUsage">;

export interface HostChats {
  getSession(id: string): HostChat | null;
  subscribe(listener: () => void): () => void;
}

type Connection = (frame: HostFrame) => void;

interface HostScope {
  chat: HostChat;
  state: SessionState;
  seq: number;
  subscribers: Set<Connection>;
  stopListening: () => void;
}

export class SessionHost {
  private readonly scopes = new Map<ScopeId, HostScope>();
  private readonly stopListeningToChats: () => void;

  constructor(private readonly chats: HostChats) {
    this.stopListeningToChats = chats.subscribe(() => this.dropClosedChats());
  }

  connect(connection: Connection): (frame: ClientFrame) => void {
    return (frame) => this.receive(connection, frame);
  }

  dispose(): void {
    this.stopListeningToChats();
    for (const scope of this.scopes.values()) scope.stopListening();
    this.scopes.clear();
  }

  private receive(connection: Connection, frame: ClientFrame): void {
    switch (frame.type) {
      case "subscribe":
        this.subscribe(connection, frame.scope);
        return;
      case "unsubscribe":
        this.scopes.get(frame.scope)?.subscribers.delete(connection);
        return;
    }
  }

  private subscribe(connection: Connection, id: ScopeId): void {
    const scope = this.scopes.get(id) ?? this.open(id);
    if (!scope) {
      connection({ type: "snapshot", scope: id, seq: 0, state: EMPTY_SESSION_STATE });
      return;
    }
    scope.subscribers.add(connection);
    connection({ type: "snapshot", scope: id, seq: scope.seq, state: scope.state });
  }

  private open(id: ScopeId): HostScope | null {
    const chat = this.chats.getSession(id);
    if (!chat) return null;
    const scope: HostScope = {
      chat,
      state: { usage: chat.getSessionUsage(), planUsage: chat.getPlanUsage() },
      seq: 0,
      subscribers: new Set(),
      stopListening: () => {},
    };
    // The chat batches its streaming notifications, so ops leave on that batch and no timer of the host's own. https://github.com/Brevilabs/obsidian-copilot-private/issues/609
    scope.stopListening = chat.subscribe({
      onMessagesChanged: () => this.publish(id, scope),
      onStatusChanged: () => {},
    });
    this.scopes.set(id, scope);
    return scope;
  }

  private publish(id: ScopeId, scope: HostScope): void {
    const ops: SessionOp[] = [];
    const usage = scope.chat.getSessionUsage();
    if (usage !== scope.state.usage) ops.push({ type: "slice", key: "usage", value: usage });
    const planUsage = scope.chat.getPlanUsage();
    if (planUsage !== scope.state.planUsage) {
      ops.push({ type: "slice", key: "planUsage", value: planUsage });
    }
    if (ops.length === 0) return;
    const from = scope.seq + 1;
    scope.state = ops.reduce(applySessionOp, scope.state);
    scope.seq += ops.length;
    for (const connection of scope.subscribers) {
      connection({ type: "ops", scope: id, from, ops });
    }
  }

  private dropClosedChats(): void {
    for (const [id, scope] of this.scopes) {
      if (this.chats.getSession(id) === scope.chat) continue;
      scope.stopListening();
      this.scopes.delete(id);
    }
  }
}
