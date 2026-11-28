import {
  getMiyoStatusSnapshot,
  type MiyoStatusSnapshot,
  subscribeMiyoStatus,
} from "@/miyo/miyoStatusStore";
import { useSyncExternalStore } from "react";

export function useMiyoStatus(): MiyoStatusSnapshot {
  return useSyncExternalStore(subscribeMiyoStatus, getMiyoStatusSnapshot);
}
