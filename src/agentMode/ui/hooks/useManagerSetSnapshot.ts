import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useEffect, useRef, useState } from "react";

function sameMembership(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

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
