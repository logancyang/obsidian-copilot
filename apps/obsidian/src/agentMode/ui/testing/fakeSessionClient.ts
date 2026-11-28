import { SessionClient } from "@copilot/protocol/client";
import { PROTOCOL_VERSION, type ClientFrame } from "@copilot/protocol/frames";
import { EMPTY_SESSION_STATE, type SessionOp, type SessionState } from "@copilot/protocol/session";

export interface FakeSessionClient {
  client: SessionClient;
  setState(scope: string, state: Partial<SessionState>): void;
  watchedScopes(): string[];
}

export function fakeSessionClient(
  states: Record<string, Partial<SessionState>> = {}
): FakeSessionClient {
  const current = new Map<string, { state: SessionState; seq: number }>(
    Object.entries(states).map(([scope, state]) => [
      scope,
      { state: { ...EMPTY_SESSION_STATE, ...state }, seq: 0 },
    ])
  );
  const watched = new Set<string>();
  const entry = (scope: string) => {
    if (!current.has(scope)) current.set(scope, { state: EMPTY_SESSION_STATE, seq: 0 });
    return current.get(scope)!;
  };
  const answer = (frame: ClientFrame): void => {
    if (frame.type === "hello") {
      client.receive({ type: "hello", version: PROTOCOL_VERSION, accepted: true });
    } else if (frame.type === "subscribe") {
      watched.add(frame.scope);
      const { state, seq } = entry(frame.scope);
      client.receive({ type: "snapshot", scope: frame.scope, seq, state });
    } else if (frame.type === "unsubscribe") {
      watched.delete(frame.scope);
    }
  };
  const client = new SessionClient(answer);
  client.connect();
  return {
    client,
    setState(scope, next) {
      const held = entry(scope);
      const ops = (Object.keys(next) as (keyof SessionState)[]).map(
        (key) => ({ type: "slice", key, value: next[key] }) as SessionOp
      );
      const from = held.seq + 1;
      held.state = { ...held.state, ...next };
      held.seq += ops.length;
      if (watched.has(scope)) client.receive({ type: "ops", scope, from, ops });
    },
    watchedScopes: () => [...watched],
  };
}
