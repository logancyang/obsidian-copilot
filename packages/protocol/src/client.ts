import type { ClientFrame, HostFrame } from "@copilot/protocol/frames";
import {
  applySessionOp,
  type LiveChatId,
  type SessionOp,
  type SessionState,
} from "@copilot/protocol/session";

interface Replica {
  state: SessionState;
  seq: number;
  awaitingSnapshot: boolean;
}

export class SessionClient {
  private readonly watchers = new Map<LiveChatId, number>();
  private readonly replicas = new Map<LiveChatId, Replica>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly send: (frame: ClientFrame) => void) {}

  receive(frame: HostFrame): void {
    switch (frame.type) {
      case "snapshot":
        if (!this.watchers.has(frame.liveChatId)) return;
        this.replicas.set(frame.liveChatId, {
          state: frame.state,
          seq: frame.seq,
          awaitingSnapshot: false,
        });
        this.notify();
        return;
      case "ops":
        this.applyOps(frame.liveChatId, frame.from, frame.ops);
        return;
    }
  }

  watch(liveChatId: LiveChatId): () => void {
    const watchers = this.watchers.get(liveChatId) ?? 0;
    this.watchers.set(liveChatId, watchers + 1);
    if (watchers === 0) this.send({ type: "subscribe", liveChatId });
    return () => this.release(liveChatId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(liveChatId: LiveChatId): SessionState | null {
    return this.replicas.get(liveChatId)?.state ?? null;
  }

  private release(liveChatId: LiveChatId): void {
    const watchers = (this.watchers.get(liveChatId) ?? 0) - 1;
    if (watchers > 0) {
      this.watchers.set(liveChatId, watchers);
      return;
    }
    this.watchers.delete(liveChatId);
    this.replicas.delete(liveChatId);
    this.send({ type: "unsubscribe", liveChatId });
  }

  private applyOps(liveChatId: LiveChatId, from: number, ops: readonly SessionOp[]): void {
    const replica = this.replicas.get(liveChatId);
    if (!replica || replica.awaitingSnapshot) return;
    if (from !== replica.seq + 1) {
      replica.awaitingSnapshot = true;
      this.send({ type: "subscribe", liveChatId });
      return;
    }
    replica.state = ops.reduce(applySessionOp, replica.state);
    replica.seq += ops.length;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
