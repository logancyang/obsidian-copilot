import type { ConnectionManager, ConnectorsSnapshot } from "@/connectors/connectionManager";
import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};
const noSnapshot = () => null;

export function useConnectorsSnapshot(
  manager: ConnectionManager | undefined
): ConnectorsSnapshot | null {
  return useSyncExternalStore(
    manager?.subscribe ?? subscribeToNothing,
    manager?.getSnapshot ?? noSnapshot
  );
}
