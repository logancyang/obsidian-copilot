import type { AgentSession } from "@/agentMode/session/AgentSession";
import {
  PROTOCOL_VERSION,
  type ClientFrame,
  type HostFrame,
  type ScopeId,
} from "@copilot/protocol/frames";
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

export const OP_LOG_LIMIT = 256;

interface Connection {
  send: (frame: HostFrame) => void;
  accepted: boolean;
}

interface HostScope {
  chat: HostChat;
  state: SessionState;
  seq: number;
  log: SessionOp[];
  subscribers: Set<Connection>;
  stopListening: () => void;
}

export class SessionHost {
  private readonly scopes = new Map<ScopeId, HostScope>();
  private readonly stopListeningToChats: () => void;

  constructor(private readonly chats: HostChats) {
    this.stopListeningToChats = chats.subscribe(() => this.dropClosedChats());
  }

  connect(send: (frame: HostFrame) => void): (frame: ClientFrame) => void {
    const connection: Connection = { send, accepted: false };
    return (frame) => this.receive(connection, frame);
  }

  dispose(): void {
    this.stopListeningToChats();
    for (const scope of this.scopes.values()) scope.stopListening();
    this.scopes.clear();
  }

  private receive(connection: Connection, frame: ClientFrame): void {
    switch (frame.type) {
      case "hello":
        connection.accepted = frame.version === PROTOCOL_VERSION;
        connection.send({
          type: "hello",
          version: PROTOCOL_VERSION,
          accepted: connection.accepted,
        });
        return;
      case "subscribe":
        if (connection.accepted) this.subscribe(connection, frame.scope, frame.fromSeq);
        return;
      case "unsubscribe":
        this.scopes.get(frame.scope)?.subscribers.delete(connection);
        return;
    }
  }

  private subscribe(connection: Connection, id: ScopeId, fromSeq: number | undefined): void {
    const scope = this.scopes.get(id) ?? this.open(id);
    if (!scope) {
      connection.send({ type: "snapshot", scope: id, seq: 0, state: EMPTY_SESSION_STATE });
      return;
    }
    scope.subscribers.add(connection);
    const firstLogged = scope.seq - scope.log.length;
    if (fromSeq !== undefined && fromSeq >= firstLogged && fromSeq <= scope.seq) {
      const ops = scope.log.slice(fromSeq - firstLogged);
      connection.send({ type: "ops", scope: id, from: fromSeq + 1, ops });
      return;
    }
    connection.send({ type: "snapshot", scope: id, seq: scope.seq, state: scope.state });
  }

  private open(id: ScopeId): HostScope | null {
    const chat = this.chats.getSession(id);
    if (!chat) return null;
    const scope: HostScope = {
      chat,
      state: { usage: chat.getSessionUsage(), planUsage: chat.getPlanUsage() },
      seq: 0,
      log: [],
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
    scope.log.push(...ops);
    if (scope.log.length > OP_LOG_LIMIT) scope.log.splice(0, scope.log.length - OP_LOG_LIMIT);
    for (const connection of scope.subscribers) {
      connection.send({ type: "ops", scope: id, from, ops });
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
