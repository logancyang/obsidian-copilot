import { getMiyoFolderName, subscribeToMiyoFolderName } from "@/miyo/miyoUtils";
import type { App } from "obsidian";
import { useSyncExternalStore } from "react";

export function useMiyoFolderName(app: App): string {
  return useSyncExternalStore(subscribeToMiyoFolderName, () => getMiyoFolderName(app));
}
