import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { HostState } from "@/agentMode/protocol/state";
import type { SessionId } from "@/agentMode/session/types";

// Keeps a replica of every attached tab's session on this client. A client that watches a session
// only while it is on screen shows an empty pane for the first frames after a tab switch or a new
// session; the desktop panel avoids that by watching every tab, which costs it nothing because the
// host projects those sessions anyway. Returns a function that drops every watch.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export function watchAttachedTabs(client: SessionClient): () => void {
  const releases = new Map<SessionId, () => void>();
  let lastHost: HostState | null = null;

  const sync = (): void => {
    const host = client.getHost();
    if (host === lastHost) return;
    lastHost = host;
    const attached = new Set<SessionId>();
    for (const tab of host?.tabs ?? []) {
      attached.add(tab.id);
      if (!releases.has(tab.id)) releases.set(tab.id, client.watchSession(tab.id));
    }
    for (const [id, release] of releases) {
      if (attached.has(id)) continue;
      release();
      releases.delete(id);
    }
  };

  const unsubscribe = client.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    for (const release of releases.values()) release();
    releases.clear();
  };
}
