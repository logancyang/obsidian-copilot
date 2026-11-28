import type { SessionClient } from "@copilot/protocol/client";
import { EMPTY_HOST_STATE, type HostState } from "@copilot/protocol/host";
import { EMPTY_SESSION_STATE, type LiveChatId, type SessionState } from "@copilot/protocol/session";
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export const SessionClientContext = createContext<SessionClient | null>(null);

export function useSessionSlice<K extends keyof SessionState>(
  liveChatId: LiveChatId,
  key: K
): SessionState[K] {
  const client = useSessionClient("useSessionSlice");
  const watch = useCallback(() => client.watch(liveChatId), [client, liveChatId]);
  const read = () => client.getState(liveChatId);
  return useFeedSlice(client, watch, read, EMPTY_SESSION_STATE, key);
}

export function useHostSlice<K extends keyof HostState>(key: K): HostState[K] {
  const client = useSessionClient("useHostSlice");
  const watch = useCallback(() => client.watchHost(), [client]);
  const read = () => client.getHostState();
  return useFeedSlice(client, watch, read, EMPTY_HOST_STATE, key);
}

function useSessionClient(hook: string): SessionClient {
  const client = useContext(SessionClientContext);
  if (!client) throw new Error(`${hook} needs a SessionClientContext provider above it.`);
  return client;
}

function useFeedSlice<S, K extends keyof S>(
  client: SessionClient,
  watch: () => () => void,
  read: () => S | null,
  empty: S,
  key: K
): S[K] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const release = watch();
      const unsubscribe = client.subscribe(onChange);
      return () => {
        unsubscribe();
        release();
      };
    },
    [client, watch]
  );
  return useSyncExternalStore(subscribe, () => (read() ?? readOnce(watch, read) ?? empty)[key]);
}

// React renders before it subscribes, and an in-process host answers a subscribe before returning, so asking once here keeps a newly shown feed's first frame from painting empty. https://github.com/Brevilabs/obsidian-copilot-private/issues/609
function readOnce<S>(watch: () => () => void, read: () => S | null): S | null {
  const release = watch();
  const state = read();
  release();
  return state;
}
