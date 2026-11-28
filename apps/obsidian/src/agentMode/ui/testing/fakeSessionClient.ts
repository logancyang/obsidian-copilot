import { SessionClient } from "@copilot/protocol/client";
import type { ClientFrame } from "@copilot/protocol/frames";
import { EMPTY_SESSION_STATE, type SessionOp, type SessionState } from "@copilot/protocol/session";

export interface FakeSessionClient {
  client: SessionClient;
  setState(liveChatId: string, state: Partial<SessionState>): void;
  watchedLiveChats(): string[];
}

export function fakeSessionClient(
  states: Record<string, Partial<SessionState>> = {}
): FakeSessionClient {
  const current = new Map<string, { state: SessionState; seq: number }>(
    Object.entries(states).map(([liveChatId, state]) => [
      liveChatId,
      { state: { ...EMPTY_SESSION_STATE, ...state }, seq: 0 },
    ])
  );
  const watched = new Set<string>();
  const entry = (liveChatId: string) => {
    if (!current.has(liveChatId)) current.set(liveChatId, { state: EMPTY_SESSION_STATE, seq: 0 });
    return current.get(liveChatId)!;
  };
  const answer = (frame: ClientFrame): void => {
    if (frame.type === "subscribe") {
      watched.add(frame.liveChatId);
      const { state, seq } = entry(frame.liveChatId);
      client.receive({ type: "snapshot", liveChatId: frame.liveChatId, seq, state });
    } else if (frame.type === "unsubscribe") {
      watched.delete(frame.liveChatId);
    }
  };
  const client = new SessionClient(answer);
  return {
    client,
    setState(liveChatId, next) {
      const held = entry(liveChatId);
      const ops = (Object.keys(next) as (keyof SessionState)[]).map(
        (key) => ({ type: "slice", key, value: next[key] }) as SessionOp
      );
      const from = held.seq + 1;
      held.state = { ...held.state, ...next };
      held.seq += ops.length;
      if (watched.has(liveChatId)) client.receive({ type: "ops", liveChatId, from, ops });
    },
    watchedLiveChats: () => [...watched],
  };
}
