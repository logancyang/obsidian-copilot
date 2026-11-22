import type { App } from "obsidian";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";

const LEGACY_PDF_CACHE_DIR = ".copilot/pdf-cache";

export async function clearLegacyCaches(app: App): Promise<void> {
  const { adapter } = app.vault;
  if (await adapter.exists(LEGACY_PDF_CACHE_DIR)) {
    await adapter.rmdir(LEGACY_PDF_CACHE_DIR, true);
  }

  if (!isDesktopRuntime()) return;
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const contextCacheDir = path.join(
    copilotAppDataDir(os.homedir()),
    "vaults",
    getVaultId(app),
    "context-cache"
  );
  await fs.promises.rm(contextCacheDir, { recursive: true, force: true });
}
