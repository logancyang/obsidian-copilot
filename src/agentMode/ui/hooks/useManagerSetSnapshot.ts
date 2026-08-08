import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useEffect, useRef, useState } from "react";

/** True when both sets hold exactly the same ids — used to skip no-op renders. */
function sameMembership(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/**
 * Reactive snapshot of a manager-derived id set (running chats, attention
 * chats, …), resynced on every manager notify. New snapshots are adopted only
 * when the membership actually changes, so an unrelated notify (tab switch,
 * label edit) doesn't churn the consumer's reference. `getSnapshot` is held in
 * a ref so an inline arrow at the call site doesn't tear down the subscription
 * each render.
 */
export function useManagerSetSnapshot(
  manager: AgentSessionManager,
  getSnapshot: (manager: AgentSessionManager) => ReadonlySet<string>
): ReadonlySet<string> {
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;

  const [ids, setIds] = useState<ReadonlySet<string>>(() => getSnapshot(manager));

  useEffect(() => {
    const sync = (): void => {
      const next = getSnapshotRef.current(manager);
      setIds((prev) => (sameMembership(prev, next) ? prev : next));
    };
    sync();
    return manager.subscribe(sync);
  }, [manager]);

  return ids;
}
