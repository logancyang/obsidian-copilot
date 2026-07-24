import {
  getMiyoStatusSnapshot,
  type MiyoStatusSnapshot,
  subscribeMiyoStatus,
} from "@/miyo/miyoStatusStore";
import { useSyncExternalStore } from "react";

/**
 * Subscribe a component to the Miyo status store. Re-renders whenever the
 * snapshot changes (refresh, invalidate, config change). The store returns a
 * referentially stable snapshot, so this is safe for `useSyncExternalStore`.
 */
export function useMiyoStatus(): MiyoStatusSnapshot {
  return useSyncExternalStore(subscribeMiyoStatus, getMiyoStatusSnapshot);
}
