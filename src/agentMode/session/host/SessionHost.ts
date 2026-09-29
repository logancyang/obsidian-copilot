import type { Command } from "@/agentMode/protocol/commands";
import { PROTOCOL_VERSION, type ClientFrame, type ServerFrame } from "@/agentMode/protocol/frames";
import {
  STREAMING_OP_TYPES,
  type HostOp,
  type ScopeOp,
  type SessionOp,
} from "@/agentMode/protocol/ops";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import {
  HOST_SCOPE,
  sessionIdOfScope,
  sessionScope,
  type HostState,
  type Scope,
  type SessionState,
} from "@/agentMode/protocol/state";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import {
  runCommand,
  type CommandContext,
  type SessionHostManager,
} from "@/agentMode/session/host/commandHandlers";
import {
  createInProcessTransport,
  type InProcessTransport,
} from "@/agentMode/session/host/inProcessTransport";
import { OpLog } from "@/agentMode/session/host/OpLog";
import { SessionProjector } from "@/agentMode/session/host/SessionProjector";
import { TabProjector } from "@/agentMode/session/host/TabProjector";
import { toWireOp, toWireTranscript } from "@/agentMode/session/host/wireMessages";
import { estimateOpBytes } from "@/agentMode/session/host/opSize";
import { v4 as uuidv4 } from "uuid";

export const OP_LOG_MAX_OPS = 2000;
export const OP_LOG_MAX_BYTES = 8 * 1024 * 1024;
export const STREAM_FLUSH_MS = 16;

export interface SessionHostOptions extends Omit<CommandContext, "manager"> {
  manager: SessionHostManager;
  appVersion: string;
  newHostId?: () => string;
  opLogLimits?: { maxOps: number; maxBytes: number };
}

export interface HostConnection {
  receive(frame: ClientFrame): void;
  close(): void;
}

interface Binding {
  session: AgentSession;
  log: OpLog<SessionOp>;
  projector: SessionProjector;
  release: () => void;
}

interface Connection {
  send: (frame: ServerFrame) => void;
  sent: Map<Scope, number>;
  greeted: boolean;
}

export class SessionHost {
  private readonly hostId: string;
  private readonly hostLog: OpLog<HostOp>;
  private readonly tabs: TabProjector;
  private readonly bindings = new Map<string, Binding>();
  private readonly connections = new Set<Connection>();
  private readonly unsubscribeManager: () => void;
  private flushTimer: number | null = null;
  private disposed = false;

  constructor(private readonly options: SessionHostOptions) {
    this.hostId = (options.newHostId ?? uuidv4)();
    this.hostLog = this.newLog<HostOp>();
    this.tabs = new TabProjector((op) => this.emitHost(op));
    this.unsubscribeManager = options.manager.subscribe(() => this.sync());
    this.sync();
  }

  private newLog<Op extends ScopeOp>(): OpLog<Op> {
    const limits = this.options.opLogLimits ?? {
      maxOps: OP_LOG_MAX_OPS,
      maxBytes: OP_LOG_MAX_BYTES,
    };
    return new OpLog<Op>({ ...limits, sizeOf: estimateOpBytes });
  }

  getHostId(): string {
    return this.hostId;
  }

  connect(send: (frame: ServerFrame) => void): HostConnection {
    const connection: Connection = { send, sent: new Map(), greeted: false };
    this.connections.add(connection);
    return {
      receive: (frame) => this.receive(connection, frame),
      close: () => {
        this.connections.delete(connection);
      },
    };
  }

  createClient(options: { serialize?: boolean } = {}): {
    client: SessionClient;
    transport: InProcessTransport;
  } {
    const serialize = options.serialize ?? process.env.NODE_ENV !== "production";
    const transport = createInProcessTransport(this, { serialize });
    return { client: new SessionClient(transport, { app: this.options.appVersion }), transport };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeManager();
    for (const binding of this.bindings.values()) binding.release();
    this.bindings.clear();
    this.connections.clear();
    if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  getHostState(): HostState {
    return this.tabs.getState();
  }

  getSessionState(id: string): SessionState | null {
    const binding = this.bindings.get(id);
    return binding ? this.snapshotSession(binding) : null;
  }

  private snapshotSession(binding: Binding): SessionState {
    return {
      transcript: toWireTranscript(binding.session.store.getMessages()),
      ...binding.projector.getSlices(),
    };
  }

  private sync(): void {
    if (this.disposed) return;
    const { manager } = this.options;
    const live = new Map(manager.getSessions().map((session) => [session.internalId, session]));
    const changed = new Set<string>();
    for (const [id, binding] of [...this.bindings]) {
      if (live.get(id) === binding.session) continue;
      binding.release();
      this.bindings.delete(id);
      changed.add(id);
    }
    for (const [id, session] of live) {
      if (this.bindings.has(id)) continue;
      this.bindings.set(id, this.bind(session));
      changed.add(id);
    }
    for (const id of changed) this.announceScope(sessionScope(id));
    this.tabs.reconcile(manager.getTabSessions());
  }

  private bind(session: AgentSession): Binding {
    const scope = sessionScope(session.internalId);
    const log = this.newLog<SessionOp>();
    const emit = (op: SessionOp): void => this.emit(scope, log, op);
    const projector = new SessionProjector(session, emit);
    const stopStore = session.store.onOp((op) => emit(toWireOp(op)));
    const refresh = (): void => {
      projector.project();
      this.tabs.refresh(session);
    };
    const stopSession = session.subscribe({
      onMessagesChanged: refresh,
      onStatusChanged: refresh,
      onModelChanged: refresh,
      onLabelChanged: refresh,
      onCurrentPlanChanged: refresh,
      onCurrentTodoListChanged: refresh,
      onNeedsAttentionChanged: refresh,
    });
    return {
      session,
      log,
      projector,
      release: () => {
        stopStore();
        stopSession();
      },
    };
  }

  private logFor(scope: Scope): OpLog<ScopeOp> | null {
    if (scope === HOST_SCOPE) return this.hostLog;
    const id = sessionIdOfScope(scope);
    return id === null ? null : (this.bindings.get(id)?.log ?? null);
  }

  private snapshotOf(scope: Scope): HostState | SessionState | null {
    if (scope === HOST_SCOPE) return this.tabs.getState();
    const id = sessionIdOfScope(scope);
    const binding = id === null ? undefined : this.bindings.get(id);
    return binding ? this.snapshotSession(binding) : null;
  }

  private emitHost(op: HostOp): void {
    this.emit(HOST_SCOPE, this.hostLog, op);
  }

  private emit<Op extends ScopeOp>(scope: Scope, log: OpLog<Op>, op: Op): void {
    log.append(op);
    if (STREAMING_OP_TYPES.has(op.t)) {
      this.scheduleFlush();
      return;
    }
    this.flushScope(scope);
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flushAll();
    }, STREAM_FLUSH_MS);
  }

  private flushAll(): void {
    for (const connection of this.connections) {
      for (const scope of [...connection.sent.keys()]) this.flushConnection(connection, scope);
    }
  }

  private flushScope(scope: Scope): void {
    for (const connection of this.connections) {
      if (connection.sent.has(scope)) this.flushConnection(connection, scope);
    }
  }

  private flushConnection(connection: Connection, scope: Scope): void {
    const log = this.logFor(scope);
    const sent = connection.sent.get(scope);
    if (!log || sent === undefined) return;
    const head = log.getHead();
    if (head === sent) return;
    connection.sent.set(scope, head);
    connection.send({ type: "ops", scope, from: sent + 1, ops: log.since(sent) });
  }

  private announceScope(scope: Scope): void {
    for (const connection of this.connections) {
      if (connection.sent.has(scope)) this.sendSnapshot(connection, scope);
    }
  }

  private sendSnapshot(connection: Connection, scope: Scope): void {
    const log = this.logFor(scope);
    const state = this.snapshotOf(scope);
    connection.sent.set(scope, log?.getHead() ?? 0);
    connection.send({ type: "snapshot", scope, seq: log?.getHead() ?? 0, state });
  }

  private receive(connection: Connection, frame: ClientFrame): void {
    if (this.disposed) return;
    if (frame.type === "hello") {
      const ok = frame.v === PROTOCOL_VERSION;
      connection.greeted = ok;
      connection.send({
        type: "hello",
        v: PROTOCOL_VERSION,
        app: this.options.appVersion,
        hostId: this.hostId,
        ok,
      });
      return;
    }
    if (!connection.greeted) return;
    switch (frame.type) {
      case "subscribe":
        this.subscribe(connection, frame.scope, frame.fromSeq);
        return;
      case "unsubscribe":
        connection.sent.delete(frame.scope);
        return;
      case "command":
        void this.execute(connection, frame.id, frame.command);
        return;
    }
  }

  private subscribe(connection: Connection, scope: Scope, fromSeq: number | undefined): void {
    const log = this.logFor(scope);
    if (log && fromSeq !== undefined && log.covers(fromSeq)) {
      connection.sent.set(scope, log.getHead());
      connection.send({ type: "ops", scope, from: fromSeq + 1, ops: log.since(fromSeq) });
      return;
    }
    this.sendSnapshot(connection, scope);
  }

  private async execute(connection: Connection, id: string, command: Command): Promise<void> {
    const result = await runCommand(
      {
        manager: this.options.manager,
        resolveNote: this.options.resolveNote,
        isKnownBackend: this.options.isKnownBackend,
      },
      command
    );
    if (this.disposed) return;
    this.flushAll();
    if (this.connections.has(connection)) connection.send({ type: "result", id, result });
  }
}
