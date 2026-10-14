import type { App } from "obsidian";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";

function cacheRoot(app: App): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return path.join(copilotAppDataDir(os.homedir()), "vaults", getVaultId(app), "context-cache");
}

export async function clearContextCache(app: App): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  await fs.promises.rm(cacheRoot(app), { recursive: true, force: true });
}
