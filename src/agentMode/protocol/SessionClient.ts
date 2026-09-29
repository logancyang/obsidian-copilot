import { applyHostOp, applySessionOp } from "@/agentMode/protocol/apply";
import type {
  Command,
  CommandName,
  CommandResult,
  CommandValue,
} from "@/agentMode/protocol/commands";
import { PROTOCOL_VERSION, type ClientFrame, type ServerFrame } from "@/agentMode/protocol/frames";
import type { HostOp, SessionOp } from "@/agentMode/protocol/ops";
import {
  HOST_SCOPE,
  sessionIdOfScope,
  sessionScope,
  type HostState,
  type Scope,
  type SessionState,
} from "@/agentMode/protocol/state";
import type { ClientTransport } from "@/agentMode/protocol/transport";
import type { SessionId } from "@/agentMode/session/types";

export type ConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline"
  | "version_mismatch";

export interface Diagnostic {
  kind: "gap" | "epoch" | "unexpected_frame";
  scope?: Scope;
  detail: string;
}

export interface SessionClientOptions {
  app: string;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

interface Cursor {
  epoch: string;
  seq: number;
}

export interface HostVersion {
  v: number;
  app: string;
}

export const DISCONNECTED_MESSAGE = "disconnected";

const DISCONNECTED: CommandResult<never> = {
  ok: false,
  code: "failed",
  message: DISCONNECTED_MESSAGE,
};

export class SessionClient {
  private connection: ConnectionState = "connecting";
  private hostId: string | null = null;
  private hostVersion: HostVersion | null = null;
  private host: HostState | null = null;
  private readonly sessions = new Map<SessionId, SessionState>();
  private readonly cursors = new Map<Scope, Cursor>();
  private readonly awaitingSnapshot = new Set<Scope>();
  private readonly watchCounts = new Map<SessionId, number>();
  private readonly pending = new Map<string, (result: CommandResult<unknown>) => void>();
  private readonly listeners = new Set<() => void>();
  private readonly detach: Array<() => void>;
  private focus: SessionId | null = null;
  private commandSeq = 0;

  constructor(
    private readonly transport: ClientTransport,
    private readonly opts: SessionClientOptions
  ) {
    this.detach = [
      transport.onFrame((frame) => this.handleFrame(frame)),
      transport.onOpenChange((open) => this.handleOpenChange(open)),
    ];
  }

  getConnection(): ConnectionState {
    return this.connection;
  }

  getHostVersion(): HostVersion | null {
    return this.hostVersion;
  }

  getHost(): HostState | null {
    return this.host;
  }

  getSession(id: SessionId): SessionState | null {
    return this.sessions.get(id) ?? null;
  }

  getCursor(scope: Scope): number | null {
    return this.cursors.get(scope)?.seq ?? null;
  }

  getCursorEpoch(scope: Scope): string | null {
    return this.cursors.get(scope)?.epoch ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  watchSession(id: SessionId): () => void {
    const count = this.watchCounts.get(id) ?? 0;
    this.watchCounts.set(id, count + 1);
    if (count === 0 && this.connection === "live") this.subscribeScope(sessionScope(id));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.unwatchSession(id);
    };
  }

  /**
   * Tells the host which session this client is showing, or null when it shows none or is hidden.
   * The host clears a focused session's attention mark and skips marking it. The value is kept
   * and re-sent after a reconnect.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
   */
  setFocus(id: SessionId | null): void {
    if (id === this.focus) return;
    this.focus = id;
    if (this.connection === "live") this.send({ type: "focus", sessionId: id });
  }

  command<N extends CommandName>(
    command: Extract<Command, { name: N }>
  ): Promise<CommandResult<CommandValue<N>>> {
    if (this.connection !== "live") {
      return Promise.resolve(DISCONNECTED);
    }
    const id = String(++this.commandSeq);
    return new Promise((resolve) => {
      this.pending.set(id, resolve as (result: CommandResult<unknown>) => void);
      this.transport.send({ type: "command", id, command });
    });
  }

  dispose(): void {
    for (const stop of this.detach) stop();
    this.connection = "offline";
    this.rejectPending();
    this.transport.close();
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private send(frame: ClientFrame): void {
    this.transport.send(frame);
  }

  private handleOpenChange(open: boolean): void {
    if (open) {
      this.connection = "connecting";
      this.send({ type: "hello", v: PROTOCOL_VERSION, app: this.opts.app });
    } else {
      this.connection = this.connection === "live" ? "reconnecting" : "offline";
      this.awaitingSnapshot.clear();
      this.rejectPending();
    }
    this.notify();
  }

  private rejectPending(): void {
    const settle = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of settle) resolve(DISCONNECTED);
  }

  private handleFrame(frame: ServerFrame): void {
    switch (frame.type) {
      case "hello":
        this.handleHello(frame);
        return;
      case "snapshot":
        this.handleSnapshot(frame.scope, frame.epoch, frame.seq, frame.state);
        return;
      case "ops":
        this.handleOps(frame.scope, frame.epoch, frame.from, frame.ops);
        return;
      case "result": {
        const resolve = this.pending.get(frame.id);
        if (!resolve) return;
        this.pending.delete(frame.id);
        resolve(frame.result);
        return;
      }
    }
  }

  private handleHello(frame: Extract<ServerFrame, { type: "hello" }>): void {
    this.hostVersion = { v: frame.v, app: frame.app };
    if (!frame.ok) {
      this.connection = "version_mismatch";
      this.notify();
      return;
    }
    if (this.hostId !== null && this.hostId !== frame.hostId) this.discardReplica();
    this.hostId = frame.hostId;
    this.connection = "live";
    this.subscribeScope(HOST_SCOPE);
    for (const id of this.watchCounts.keys()) this.subscribeScope(sessionScope(id));
    if (this.focus !== null) this.send({ type: "focus", sessionId: this.focus });
    this.notify();
  }

  private discardReplica(): void {
    this.host = null;
    this.sessions.clear();
    this.cursors.clear();
    this.awaitingSnapshot.clear();
  }

  private subscribeScope(scope: Scope, resume = true): void {
    const cursor = resume ? this.cursors.get(scope) : undefined;
    this.send(
      cursor === undefined
        ? { type: "subscribe", scope }
        : { type: "subscribe", scope, fromSeq: cursor.seq, epoch: cursor.epoch }
    );
  }

  private unwatchSession(id: SessionId): void {
    const count = (this.watchCounts.get(id) ?? 0) - 1;
    if (count > 0) {
      this.watchCounts.set(id, count);
      return;
    }
    this.watchCounts.delete(id);
    const scope = sessionScope(id);
    this.cursors.delete(scope);
    this.awaitingSnapshot.delete(scope);
    if (this.connection === "live") this.send({ type: "unsubscribe", scope });
    if (this.sessions.delete(id)) this.notify();
  }

  private handleSnapshot(
    scope: Scope,
    epoch: string,
    seq: number,
    state: HostState | SessionState | null
  ): void {
    const sessionId = sessionIdOfScope(scope);
    if (sessionId !== null && !this.watchCounts.has(sessionId)) return;
    this.awaitingSnapshot.delete(scope);
    if (state === null) {
      this.cursors.delete(scope);
      if (sessionId === null) this.host = null;
      else this.sessions.delete(sessionId);
    } else {
      this.cursors.set(scope, { epoch, seq });
      if (sessionId === null) this.host = state as HostState;
      else this.sessions.set(sessionId, state as SessionState);
    }
    this.notify();
  }

  private handleOps(
    scope: Scope,
    epoch: string,
    from: number,
    ops: readonly (HostOp | SessionOp)[]
  ): void {
    const sessionId = sessionIdOfScope(scope);
    if (sessionId !== null && !this.watchCounts.has(sessionId)) return;
    if (this.awaitingSnapshot.has(scope)) return;
    const cursor = this.cursors.get(scope);
    if (cursor === undefined) {
      this.opts.onDiagnostic?.({
        kind: "unexpected_frame",
        scope,
        detail: "ops before the first snapshot",
      });
      return;
    }
    if (epoch !== cursor.epoch) {
      this.opts.onDiagnostic?.({
        kind: "epoch",
        scope,
        detail: `expected log ${cursor.epoch}, received ${epoch}`,
      });
      this.awaitingSnapshot.add(scope);
      this.subscribeScope(scope, false);
      return;
    }
    if (from > cursor.seq + 1) {
      this.opts.onDiagnostic?.({
        kind: "gap",
        scope,
        detail: `expected ${cursor.seq + 1}, received ${from}`,
      });
      this.awaitingSnapshot.add(scope);
      this.subscribeScope(scope, false);
      return;
    }
    const fresh = from <= cursor.seq ? ops.slice(cursor.seq - from + 1) : ops;
    if (fresh.length === 0) return;
    if (sessionId === null) {
      let next = this.host;
      if (next === null) return;
      for (const op of fresh) next = applyHostOp(next, op as HostOp);
      this.host = next;
    } else {
      let next = this.sessions.get(sessionId);
      if (!next) return;
      for (const op of fresh) next = applySessionOp(next, op as SessionOp);
      this.sessions.set(sessionId, next);
    }
    this.cursors.set(scope, { epoch, seq: cursor.seq + fresh.length });
    this.notify();
  }
}
