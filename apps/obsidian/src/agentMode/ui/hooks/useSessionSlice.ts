import type { SessionClient } from "@copilot/protocol/client";
import { EMPTY_SESSION_STATE, type LiveChatId, type SessionState } from "@copilot/protocol/session";
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export const SessionClientContext = createContext<SessionClient | null>(null);

export function useSessionSlice<K extends keyof SessionState>(
  liveChatId: LiveChatId,
  key: K
): SessionState[K] {
  const client = useContext(SessionClientContext);
  if (!client) throw new Error("useSessionSlice needs a SessionClientContext provider above it.");
  const subscribe = useCallback(
    (onChange: () => void) => {
      const release = client.watch(liveChatId);
      const unsubscribe = client.subscribe(onChange);
      return () => {
        unsubscribe();
        release();
      };
    },
    [client, liveChatId]
  );
  const getSnapshot = () => (client.getState(liveChatId) ?? readOnce(client, liveChatId))[key];
  return useSyncExternalStore(subscribe, getSnapshot);
}

// React renders before it subscribes, and an in-process host answers a subscribe before returning, so asking once here keeps a newly shown chat's first frame from painting empty. https://github.com/Brevilabs/obsidian-copilot-private/issues/609
function readOnce(client: SessionClient, liveChatId: LiveChatId): SessionState {
  const release = client.watch(liveChatId);
  const state = client.getState(liveChatId);
  release();
  return state ?? EMPTY_SESSION_STATE;
}
