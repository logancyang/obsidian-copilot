import {
  PROTOCOL_VERSION,
  type ClientFrame,
  type HostFrame,
  type ScopeId,
} from "@copilot/protocol/frames";
import { applySessionOp, type SessionOp, type SessionState } from "@copilot/protocol/session";

interface Replica {
  state: SessionState;
  seq: number;
  awaitingSnapshot: boolean;
}

export class SessionClient {
  private accepted = false;
  private readonly watchers = new Map<ScopeId, number>();
  private readonly replicas = new Map<ScopeId, Replica>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly send: (frame: ClientFrame) => void) {}

  connect(): void {
    this.send({ type: "hello", version: PROTOCOL_VERSION });
  }

  receive(frame: HostFrame): void {
    switch (frame.type) {
      case "hello":
        this.accepted = frame.accepted;
        if (!frame.accepted) return;
        for (const scope of this.watchers.keys()) this.send({ type: "subscribe", scope });
        return;
      case "snapshot":
        if (!this.watchers.has(frame.scope)) return;
        this.replicas.set(frame.scope, {
          state: frame.state,
          seq: frame.seq,
          awaitingSnapshot: false,
        });
        this.notify();
        return;
      case "ops":
        this.applyOps(frame.scope, frame.from, frame.ops);
        return;
      case "result":
        return;
    }
  }

  watch(scope: ScopeId): () => void {
    const watchers = this.watchers.get(scope) ?? 0;
    this.watchers.set(scope, watchers + 1);
    if (watchers === 0 && this.accepted) this.send({ type: "subscribe", scope });
    return () => this.release(scope);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(scope: ScopeId): SessionState | null {
    return this.replicas.get(scope)?.state ?? null;
  }

  private release(scope: ScopeId): void {
    const watchers = (this.watchers.get(scope) ?? 0) - 1;
    if (watchers > 0) {
      this.watchers.set(scope, watchers);
      return;
    }
    this.watchers.delete(scope);
    this.replicas.delete(scope);
    this.send({ type: "unsubscribe", scope });
  }

  private applyOps(scope: ScopeId, from: number, ops: readonly SessionOp[]): void {
    const replica = this.replicas.get(scope);
    if (!replica || replica.awaitingSnapshot) return;
    if (from !== replica.seq + 1) {
      replica.awaitingSnapshot = true;
      this.send({ type: "subscribe", scope });
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
