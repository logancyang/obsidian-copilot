import type { App } from "obsidian";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { md5 } from "@/utils/hash";

function joinPath(...parts: string[]): string {
  return requireNodeModule<typeof import("node:path")>("path").join(...parts);
}

export function cacheRoot(app: App): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  return joinPath(copilotAppDataDir(os.homedir()), "vaults", getVaultId(app), "context-cache");
}

export function remotesDir(app: App): string {
  return joinPath(cacheRoot(app), "remotes");
}

export function markersDir(app: App, projectId: string): string {
  return joinPath(cacheRoot(app), "markers", md5(projectId));
}

export function snapshotAbsPath(app: App, fileName: string): string {
  return joinPath(remotesDir(app), fileName);
}
