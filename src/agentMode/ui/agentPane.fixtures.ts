import { applyHostOp, applySessionOp } from "@/agentMode/protocol/apply";
import type { Command, CommandResult } from "@/agentMode/protocol/commands";
import { PROTOCOL_VERSION, type ClientFrame, type ServerFrame } from "@/agentMode/protocol/frames";
import type { HostOp, SessionOp } from "@/agentMode/protocol/ops";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import {
  INITIAL_SESSION_STATE,
  sessionScope,
  type HostState,
  type SessionState,
  type TabSummary,
} from "@/agentMode/protocol/state";
import { ClientView } from "@/agentMode/protocol/ClientView";
import { buildBackendSummary, buildHostState, buildTab } from "@/agentMode/protocol/testBuilders";
import type { AgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";
import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
import type { SessionId } from "@/agentMode/session/types";
import type { App } from "obsidian";

// A client over a scripted single-session host, for the message pane's stories and tests. Frames
// are delivered synchronously so the pane renders its first frame with the replica in place.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export interface FixtureClientOptions {
  sessionId: SessionId;
  tab?: Partial<TabSummary>;
  host?: Partial<HostState>;
  session?: Partial<SessionState>;
  onCommand?: (command: Command, fixture: FixtureClient) => CommandResult<unknown>;
}

export interface FixtureClient {
  client: SessionClient;
  commands: Command[];
  focused: Array<SessionId | null>;
  getSession(): SessionState;
  emitSession(...ops: SessionOp[]): void;
  emitHost(...ops: HostOp[]): void;
}

const HOST_ID = "fixture-host";

export function createFixtureClient(options: FixtureClientOptions): FixtureClient {
  const { sessionId } = options;
  let host: HostState = buildHostState({
    tabs: [buildTab({ id: sessionId, ...options.tab })],
    ...options.host,
  });
  let session: SessionState = { ...INITIAL_SESSION_STATE, ...options.session };
  let hostSeq = 0;
  let sessionSeq = 0;
  const frameListeners = new Set<(frame: ServerFrame) => void>();
  const subscribed = new Set<string>();
  const deliver = (frame: ServerFrame): void => {
    for (const listener of [...frameListeners]) listener(frame);
  };
  const commands: Command[] = [];
  const focused: Array<SessionId | null> = [];

  const fixture: FixtureClient = {
    client: undefined as unknown as SessionClient,
    commands,
    focused,
    getSession: () => session,
    emitSession(...ops) {
      const from = sessionSeq + 1;
      for (const op of ops) session = applySessionOp(session, op);
      sessionSeq += ops.length;
      if (subscribed.has(sessionScope(sessionId))) {
        deliver({ type: "ops", epoch: "e1", scope: sessionScope(sessionId), from, ops });
      }
    },
    emitHost(...ops) {
      const from = hostSeq + 1;
      for (const op of ops) host = applyHostOp(host, op);
      hostSeq += ops.length;
      if (subscribed.has("host")) deliver({ type: "ops", epoch: "e1", scope: "host", from, ops });
    },
  };

  const receive = (frame: ClientFrame): void => {
    switch (frame.type) {
      case "hello":
        deliver({ type: "hello", v: PROTOCOL_VERSION, app: "fixture", hostId: HOST_ID, ok: true });
        return;
      case "subscribe":
        subscribed.add(frame.scope);
        deliver(
          frame.scope === "host"
            ? { type: "snapshot", epoch: "e1", scope: "host", seq: hostSeq, state: host }
            : { type: "snapshot", epoch: "e1", scope: frame.scope, seq: sessionSeq, state: session }
        );
        return;
      case "unsubscribe":
        subscribed.delete(frame.scope);
        return;
      case "focus":
        focused.push(frame.sessionId);
        return;
      case "command":
        commands.push(frame.command);
        deliver({
          type: "result",
          id: frame.id,
          result: options.onCommand?.(frame.command, fixture) ?? { ok: true, value: undefined },
        });
        return;
    }
  };

  fixture.client = new SessionClient(
    {
      send: receive,
      onFrame(listener) {
        frameListeners.add(listener);
        return () => frameListeners.delete(listener);
      },
      onOpenChange(listener) {
        listener(true);
        return () => undefined;
      },
      close: () => undefined,
    },
    { app: "fixture" }
  );
  fixture.client.watchSession(sessionId);
  return fixture;
}

// A desktop-like environment whose actions do nothing, so a story shows the controls a desktop
// panel offers without touching a vault.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export const inertPaneCapabilities: AgentPaneCapabilities = {
  vaultBase: null,
  openPath: () => undefined,
  insertAtCursor: () => undefined,
  openPlanPreview: async () => undefined,
  closePlanPreview: () => undefined,
};

// Builders and a view for stories, which may not import protocol values themselves.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/612
export const fixtureTab = buildTab;
export const fixtureBackend = buildBackendSummary;

export function createFixtureView(fixture: FixtureClient, activeId: SessionId): ClientView {
  const view = new ClientView("__global__");
  view.reconcile(fixture.client.getHost());
  view.activate({ id: activeId, projectId: "__global__" });
  return view;
}

// A draft store whose every composer is live, for stories of a pane that owns its drafts.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export function createFixtureDraftStore(app: App): AgentInputDraftStore {
  return new AgentInputDraftStore(app, () => true);
}
