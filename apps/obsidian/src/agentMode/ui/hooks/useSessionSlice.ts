import type { SessionClient } from "@copilot/protocol/client";
import { EMPTY_SESSION_STATE, type SessionState } from "@copilot/protocol/session";
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export const SessionClientContext = createContext<SessionClient | null>(null);

export function useSessionSlice<K extends keyof SessionState>(
  scope: string,
  key: K
): SessionState[K] {
  const client = useContext(SessionClientContext);
  if (!client) throw new Error("useSessionSlice needs a SessionClientContext provider above it.");
  const subscribe = useCallback(
    (onChange: () => void) => {
      const release = client.watch(scope);
      const unsubscribe = client.subscribe(onChange);
      return () => {
        unsubscribe();
        release();
      };
    },
    [client, scope]
  );
  const getSnapshot = () => (client.getState(scope) ?? readOnce(client, scope))[key];
  return useSyncExternalStore(subscribe, getSnapshot);
}

// React renders before it subscribes, and an in-process host answers a subscribe before returning, so asking once here keeps a newly shown chat's first frame from painting empty. https://github.com/Brevilabs/obsidian-copilot-private/issues/609
function readOnce(client: SessionClient, scope: string): SessionState {
  const release = client.watch(scope);
  const state = client.getState(scope);
  release();
  return state ?? EMPTY_SESSION_STATE;
}
