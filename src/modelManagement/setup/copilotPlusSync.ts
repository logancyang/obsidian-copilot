/**
 * Reconciles the Copilot Plus provider with the user's current Plus state and
 * with the lineup the models service publishes.
 *
 * `syncCopilotPlusProvider` is the single bridge the plugin host calls on Plus
 * sign-in / sign-out and once on load: it registers the Plus provider when
 * signed in (with a key) and unregisters it otherwise.
 *
 * The models endpoint is the authority for which models exist, but it is never
 * on the startup path. Everything that needs the lineup reads the cached
 * snapshot in `settings.copilotPlusCatalog`, so an agent starts on last-known-
 * good models at once and a slow or unreachable service costs nothing. A
 * response that matches the cache writes nothing, which is what keeps a routine
 * reload from restarting a running agent; a response that differs writes once
 * and the agent refreshes then.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/319
 */

import { BrevilabsClient, type BrevilabsModelsResponse } from "@/LLMProviders/brevilabsClient";
import { BREVILABS_MODELS_BASE_URL } from "@/constants";
import { logError, logInfo } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { readCopilotPlusCatalog } from "@/modelManagement/setup/copilotPlusCatalog";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";

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

/** Whether two lineups describe the same models with the same metadata. */
function sameLineup(a: readonly ModelInfo[], b: readonly ModelInfo[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Upper bound on one lineup read.
 *
 * Nothing waits on this to start, so the deadline is not there to protect
 * startup. It bounds the caller's serialized queue: a sign-out is chained
 * behind whatever sync is in flight, and `requestUrl` enforces no timeout of
 * its own, so a hung connection would otherwise hold a revoked license
 * registered for as long as the OS takes to give up. Giving up early costs one
 * refresh of a cache that is already good.
 */
const LINEUP_TIMEOUT_MS = 10_000;

/** Resolve with null if `promise` has not settled within `ms`. */
function withDeadline<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    const settle = (value: T | null) => {
      window.clearTimeout(timer);
      resolve(value);
    };
    promise.then(settle, () => settle(null));
  });
}

/**
 * Refresh the cached lineup from the models endpoint.
 *
 * Writing only on a real difference is load-bearing rather than an
 * optimization: every consumer of this cache is rebuilt from a settings
 * change, and for the OpenCode agent that rebuild means restarting the
 * subprocess and replacing the user's session. A reload that finds the same
 * lineup must therefore be completely silent.
 *
 * @param fetchModels - Reader for the public models endpoint.
 * @returns The lineup now in the cache, or null when the response was
 *   unreadable and the previous snapshot stands.
 */
async function refreshCachedLineup(
  fetchModels: CopilotPlusModelsFetcher
): Promise<{ models: readonly ModelInfo[]; defaultEnabledIds: readonly string[] } | null> {
  const catalog = readCopilotPlusCatalog(await withDeadline(fetchModels(), LINEUP_TIMEOUT_MS));
  if (!catalog) {
    logInfo("[modelManagement] Copilot Plus lineup unreadable; keeping the cached one");
    return null;
  }
  const cached = getSettings().copilotPlusCatalog;
  if (
    !sameLineup(cached.models, catalog.models) ||
    cached.defaultEnabledIds.join("\0") !== catalog.defaultEnabledIds.join("\0")
  ) {
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
 *
 * Sign-out is not allowed to wait on the network — the endpoint read happens
 * only on the signed-in path, so revoking access is immediate.
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
      return;
    }
    const catalog = await refreshCachedLineup(fetchModels);
    await api.setup.copilotPlus.registerPlusProvider({
      providerType: "openai-compatible",
      displayName: "Copilot",
      baseUrl: BREVILABS_MODELS_BASE_URL,
      apiKey: licenseKey,
      // An unreadable response leaves the persisted rows untouched rather than
      // reconciling against nothing, which would read as the service having
      // withdrawn every model and delete the user's whole lineup offline.
      ...(catalog ? { models: catalog.models, autoEnrollModelIds: catalog.defaultEnabledIds } : {}),
    });
  } catch (err) {
    logError("[modelManagement] Copilot Plus provider sync failed", err);
  }
}
