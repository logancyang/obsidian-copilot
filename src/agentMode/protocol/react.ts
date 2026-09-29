import { useCallback, useRef, useSyncExternalStore } from "react";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { HostState, SessionState } from "@/agentMode/protocol/state";
import type { SessionId } from "@/agentMode/session/types";

interface SelectionCache<T> {
  host: HostState;
  session: SessionState | null;
  select: unknown;
  value: T;
}

function memoizedSelection<T>(
  cache: { current: SelectionCache<T> | null },
  host: HostState,
  session: SessionState | null,
  select: unknown,
  eq: (a: T, b: T) => boolean,
  compute: () => T
): T {
  const last = cache.current;
  if (last && last.host === host && last.session === session && last.select === select) {
    return last.value;
  }
  const next = compute();
  const value = last && eq(last.value, next) ? last.value : next;
  cache.current = { host, session, select, value };
  return value;
}

export function useHostSelector<T>(
  client: SessionClient,
  select: (host: HostState) => T,
  eq: (a: T, b: T) => boolean = Object.is
): T | null {
  const cache = useRef<SelectionCache<T> | null>(null);
  const getSnapshot = useCallback((): T | null => {
    const host = client.getHost();
    if (host === null) return null;
    return memoizedSelection(cache, host, null, select, eq, () => select(host));
  }, [client, select, eq]);
  return useSyncExternalStore(
    useCallback((listener) => client.subscribe(listener), [client]),
    getSnapshot,
    getSnapshot
  );
}

export function useSessionSelector<T>(
  client: SessionClient,
  id: SessionId,
  select: (session: SessionState, host: HostState) => T,
  eq: (a: T, b: T) => boolean = Object.is
): T | null {
  const cache = useRef<SelectionCache<T> | null>(null);
  const getSnapshot = useCallback((): T | null => {
    const host = client.getHost();
    const session = client.getSession(id);
    if (host === null || session === null) return null;
    return memoizedSelection(cache, host, session, select, eq, () => select(session, host));
  }, [client, id, select, eq]);
  return useSyncExternalStore(
    useCallback((listener) => client.subscribe(listener), [client]),
    getSnapshot,
    getSnapshot
  );
}
