import { useCallback, useRef, useSyncExternalStore } from "react";
import type { ClientView, ClientViewState } from "@/agentMode/protocol/ClientView";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { HostState, SessionState, TabSummary } from "@/agentMode/protocol/state";
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
  id: SessionId | null,
  select: (session: SessionState, host: HostState) => T,
  eq: (a: T, b: T) => boolean = Object.is
): T | null {
  const cache = useRef<SelectionCache<T> | null>(null);
  const getSnapshot = useCallback((): T | null => {
    const host = client.getHost();
    const session = id === null ? null : client.getSession(id);
    if (host === null || session === null) return null;
    return memoizedSelection(cache, host, session, select, eq, () => select(session, host));
  }, [client, id, select, eq]);
  return useSyncExternalStore(
    useCallback((listener) => client.subscribe(listener), [client]),
    getSnapshot,
    getSnapshot
  );
}

export interface ClientViewSnapshot {
  host: HostState | null;
  view: ClientViewState;
  scopeTabs: readonly TabSummary[];
  activeTab: TabSummary | null;
}

const NO_TABS: readonly TabSummary[] = Object.freeze([]);

/**
 * Reads this client's own view of the shared tab set: the tabs in its project scope and the one it
 * shows. It changes when either the host's tab set or the client's view state does.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export function useClientView(client: SessionClient, view: ClientView): ClientViewSnapshot {
  const cache = useRef<ClientViewSnapshot | null>(null);
  const getSnapshot = useCallback((): ClientViewSnapshot => {
    const host = client.getHost();
    const viewState = view.getState();
    const last = cache.current;
    if (last && last.host === host && last.view === viewState) return last;
    const scopeTabs =
      host === null ? NO_TABS : host.tabs.filter((tab) => tab.projectId === viewState.projectScope);
    const stable =
      last &&
      last.scopeTabs.length === scopeTabs.length &&
      last.scopeTabs.every((tab, i) => tab === scopeTabs[i])
        ? last.scopeTabs
        : scopeTabs;
    const next: ClientViewSnapshot = {
      host,
      view: viewState,
      scopeTabs: stable.length === 0 ? NO_TABS : stable,
      activeTab: host?.tabs.find((tab) => tab.id === viewState.activeTabId) ?? null,
    };
    cache.current = next;
    return next;
  }, [client, view]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const stopClient = client.subscribe(listener);
      const stopView = view.subscribe(listener);
      return () => {
        stopClient();
        stopView();
      };
    },
    [client, view]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
