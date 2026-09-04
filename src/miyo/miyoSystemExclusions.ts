import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl, getMiyoFolderName } from "@/miyo/miyoUtils";
import { getSystemExcludedFolders } from "@/search/searchUtils";
import type { CopilotSettings } from "@/settings/model";
import type { App } from "obsidian";

const syncQueues = new WeakMap<App, Promise<void>>();

function normalizeFolder(folder: string): string {
  return folder.replace(/\\/g, "/").replace(/\/+$/, "");
}

async function reconcileSystemExclusions(app: App, settings: CopilotSettings): Promise<boolean> {
  const client = new MiyoClient({ plusLicenseKey: settings.plusLicenseKey });
  const baseUrl = await client.resolveBaseUrl(getMiyoCustomUrl(settings));
  const folderName = getMiyoFolderName(app);
  const folder = await client.getFolder(baseUrl, folderName);
  const current = folder.exclude_folders ?? [];
  const known = new Set(current.map(normalizeFolder));
  const missing = getSystemExcludedFolders(settings).filter(
    (systemRoot) => !known.has(normalizeFolder(systemRoot))
  );
  if (missing.length === 0) return false;

  // Copilot roots only accumulate in copilotRootHistory. Preserve every rule
  // the user configured in Miyo and append only missing system roots, so a
  // stale device or overlapping root change cannot erase a narrower scope.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/284
  await client.updateFolder(baseUrl, folderName, {
    exclude_folders: [...current, ...missing],
  });
  return true;
}

/**
 * Ensure Miyo excludes every current and historical Copilot root.
 *
 * Calls for the same vault are serialized because Miyo's PATCH replaces the
 * array. Each queued call re-reads the folder before merging, so concurrent
 * root changes cannot overwrite one another or the user's Miyo-owned rules.
 *
 * @param app - Active Obsidian app whose vault registration is reconciled.
 * @param settings - Settings snapshot that triggered the reconciliation.
 * @returns Whether Miyo's folder record needed an update.
 */
export function syncMiyoSystemExclusions(app: App, settings: CopilotSettings): Promise<boolean> {
  const previous = syncQueues.get(app) ?? Promise.resolve();
  const next = previous.then(() => reconcileSystemExclusions(app, settings));
  syncQueues.set(
    app,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}
