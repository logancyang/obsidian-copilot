/**
 * Reconciles the Copilot Plus provider with the user's Plus state and with the
 * lineup the models service publishes. `syncCopilotPlusProvider` is the single
 * bridge the plugin host calls on sign-in / sign-out and once on load.
 *
 * The models endpoint is the authority for which models exist but is never on
 * the startup path: every consumer reads the cached snapshot in
 * `settings.copilotPlusCatalog`, and a response that matches the cache writes
 * nothing, which is what keeps a routine reload from restarting a running
 * agent. https://github.com/Brevilabs/obsidian-copilot-private/issues/319
 */

import { BrevilabsClient, type BrevilabsModelsResponse } from "@/LLMProviders/brevilabsClient";
import { BREVILABS_MODELS_BASE_URL } from "@/constants";
import { logError, logInfo } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import {
  readCopilotPlusCatalog,
  type CopilotPlusCatalog,
} from "@/modelManagement/setup/copilotPlusCatalog";
import {
  getSettings,
  setSettings,
  subscribeToSettingsChange,
  type CopilotSettings,
} from "@/settings/model";

/** Reads the public models endpoint. Injected so the sync stays unit-testable. */
export type CopilotPlusModelsFetcher = () => Promise<BrevilabsModelsResponse | null>;

/**
 * Whether a settings change requires re-reconciling the Plus provider:
 * a sign-in / sign-out (`isPaidUser` flip) or a key rotation while signed in.
 *
 * This is the settings subscriber's trigger, extracted so the one settings
 * write that must NOT read as sign-out is testable: Reset Settings preserves
 * `isPaidUser` alongside the license key, and this predicate staying false is
 * what keeps the destructive `unregisterPlusProvider` cascade (provider row,
 * configured models, backend refs, provider keychain entry) from firing on a
 * signed-in user's reset.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/259
 *
 * @param prev - Settings before the change.
 * @param next - Settings after the change.
 */
export function plusSyncNeeded(
  prev: Pick<CopilotSettings, "isPaidUser" | "plusLicenseKey">,
  next: Pick<CopilotSettings, "isPaidUser" | "plusLicenseKey">
): boolean {
  return (
    prev.isPaidUser !== next.isPaidUser ||
    (!!next.isPaidUser && prev.plusLicenseKey !== next.plusLicenseKey)
  );
}

/**
 * Upper bound on one lineup read. Nothing waits on it to start; it bounds the
 * caller's serialized sync queue, which `requestUrl` (no timeout of its own)
 * would otherwise hold for as long as the OS takes to give up a hung connection.
 */
const LINEUP_TIMEOUT_MS = 10_000;

/**
 * Attempts allowed when there is no cached lineup to fall back on. A first
 * sign-in that fails its one read leaves someone who has just paid with a
 * provider and no models until the next reload; every other caller degrades to
 * the cache. https://github.com/Brevilabs/obsidian-copilot-private/issues/319
 */
const COLD_START_ATTEMPTS = 3;
const COLD_START_BACKOFF_MS = 2_000;

/** Resolve after `ms`. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Resolve with the read's result, or with null as soon as it stops mattering:
 * the deadline passes, or the Plus state it was started for moves on. The
 * latter keeps sign-out immediate, since the unregister is chained behind
 * whatever read is in flight.
 *
 * @param read - The in-flight endpoint read.
 * @param stillWanted - Whether its result is still the one the caller asked for.
 */
function readWithin<T>(read: Promise<T | null>, stillWanted: () => boolean): Promise<T | null> {
  return new Promise((resolve) => {
    let timer = 0;
    let unsubscribe = (): void => {};
    const settle = (value: T | null) => {
      window.clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    timer = window.setTimeout(() => settle(null), LINEUP_TIMEOUT_MS);
    unsubscribe = subscribeToSettingsChange(() => {
      if (!stillWanted()) settle(null);
    });
    read.then(settle, () => settle(null));
  });
}

/**
 * Refresh the cached lineup from the models endpoint. Writing only on a real
 * difference is load-bearing: every consumer of the cache rebuilds on a
 * settings change, and for OpenCode that rebuild restarts the subprocess.
 *
 * @param fetchModels - Reader for the public models endpoint.
 * @param stillWanted - Whether the Plus state this read was started for still
 *   holds; false abandons the read rather than making a sign-out wait for it.
 * @returns The lineup now in the cache, or null when the response was
 *   unreadable and the previous snapshot stands.
 */
async function refreshCachedLineup(
  fetchModels: CopilotPlusModelsFetcher,
  stillWanted: () => boolean
): Promise<CopilotPlusCatalog | null> {
  const attempts = getSettings().copilotPlusCatalog.models.length === 0 ? COLD_START_ATTEMPTS : 1;
  let catalog: CopilotPlusCatalog | null = null;
  for (let attempt = 0; attempt < attempts && !catalog; attempt++) {
    if (attempt > 0) await delay(COLD_START_BACKOFF_MS);
    catalog = readCopilotPlusCatalog(await readWithin(fetchModels(), stillWanted));
    if (!catalog && !stillWanted()) return null;
  }
  if (!catalog) {
    logInfo("[modelManagement] Copilot Plus lineup unreadable; keeping the cached one");
    return null;
  }
  const cached = getSettings().copilotPlusCatalog;
  const same =
    JSON.stringify([cached.models, cached.defaultEnabledIds]) ===
    JSON.stringify([catalog.models, catalog.defaultEnabledIds]);
  if (!same) {
    setSettings({
      copilotPlusCatalog: {
        models: [...catalog.models],
        defaultEnabledIds: [...catalog.defaultEnabledIds],
      },
    });
  }
  return catalog;
}

/**
 * Register or unregister the Plus provider to match Plus state, reconciling its
 * models against the published lineup. Best-effort: a failure is logged, not
 * thrown, since this runs as background reconciliation off a settings change.
 * Both paths refresh the cached lineup, and the signed-out one removes the
 * provider first, so revoking access never waits on the network.
 *
 * `licenseKey` is already hydrated from Obsidian Keychain by the settings
 * persistence boundary.
 *
 * @param api - Model-management instance owned by the current plugin lifecycle.
 * @param isPaidUser - Whether the user currently holds a license.
 * @param licenseKey - The Plus relay token, absent when signed out.
 * @param fetchModels - Reader for the public models endpoint.
 */
export async function syncCopilotPlusProvider(
  api: ModelManagementApi,
  isPaidUser: boolean,
  licenseKey: string | undefined,
  fetchModels: CopilotPlusModelsFetcher = () => BrevilabsClient.getInstance().getModels()
): Promise<void> {
  try {
    if (!isPaidUser || !licenseKey) {
      await api.setup.copilotPlus.unregisterPlusProvider();
      // The locked "Copilot license required" rows render from the same cache,
      // so an install that never signs in has to read the (public) endpoint
      // itself or it never learns the Plus models exist. Removal above is
      // already done, so nothing here delays a sign-out, and the read abandons
      // itself the moment a sign-in makes the licensed sync the authority.
      // The cold-start retry carries over because it fires only on an empty
      // cache, which on this path is exactly the install with no preview.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/476
      await refreshCachedLineup(fetchModels, () => {
        const now = getSettings();
        return !now.isPaidUser || !now.plusLicenseKey;
      });
      return;
    }
    const plusStateUnchanged = (): boolean => {
      const now = getSettings();
      return now.isPaidUser === true && now.plusLicenseKey === licenseKey;
    };
    const catalog = await refreshCachedLineup(fetchModels, plusStateUnchanged);
    // A sign-out, key rotation, or plugin reload can land during the read;
    // registering on the stale argument would restore a revoked license's
    // provider and keychain credential.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
    if (!plusStateUnchanged()) {
      logInfo(
        "[modelManagement] Copilot Plus state changed during the lineup read; not registering"
      );
      return;
    }
    await api.setup.copilotPlus.registerPlusProvider({
      providerType: "openai-compatible",
      displayName: "Copilot",
      baseUrl: BREVILABS_MODELS_BASE_URL,
      apiKey: licenseKey,
      // An unreadable response leaves the persisted rows untouched: reconciling
      // against nothing would delete the user's whole lineup offline.
      ...(catalog ? { models: catalog.models, autoEnrollModelIds: catalog.defaultEnabledIds } : {}),
    });
  } catch (err) {
    logError("[modelManagement] Copilot Plus provider sync failed", err);
  }
}
