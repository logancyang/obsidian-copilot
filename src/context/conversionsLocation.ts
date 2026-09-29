import type { App } from "obsidian";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { md5 } from "@/utils/hash";
import type { MaterializedSourceType } from "./contextCacheStore";

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

export function filesDir(app: App): string {
  return joinPath(cacheRoot(app), "files");
}

export function markersDir(app: App, projectId: string): string {
  return joinPath(cacheRoot(app), "markers", md5(projectId));
}

export function snapshotAbsPath(app: App, type: MaterializedSourceType, fileName: string): string {
  return joinPath(type === "file" ? filesDir(app) : remotesDir(app), fileName);
}
