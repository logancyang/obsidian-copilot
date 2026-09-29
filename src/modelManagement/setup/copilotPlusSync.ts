// The endpoint is never on the startup path; consumers read the cached snapshot so a reload writes
// nothing and restarts no running agent:
// https://github.com/Brevilabs/obsidian-copilot-private/issues/319

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

export type CopilotPlusModelsFetcher = () => Promise<BrevilabsModelsResponse | null>;

// This predicate staying false on Reset Settings keeps the destructive `unregisterPlusProvider` cascade from firing:
// https://github.com/logancyang/obsidian-copilot-preview/issues/259
export function plusSyncNeeded(
  prev: Pick<CopilotSettings, "isPaidUser" | "plusLicenseKey">,
  next: Pick<CopilotSettings, "isPaidUser" | "plusLicenseKey">
): boolean {
  return (
    prev.isPaidUser !== next.isPaidUser ||
    (!!next.isPaidUser && prev.plusLicenseKey !== next.plusLicenseKey)
  );
}

const LINEUP_TIMEOUT_MS = 10_000;

// A first sign-in with no cached lineup that fails its one read leaves a paying user with no models:
// https://github.com/Brevilabs/obsidian-copilot-private/issues/319
const COLD_START_ATTEMPTS = 3;
const COLD_START_BACKOFF_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

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

async function refreshCachedLineup(
  fetchModels: CopilotPlusModelsFetcher,
  stillWanted: () => boolean
): Promise<CopilotPlusCatalog | null> {
  const attempts = getSettings().copilotPlusCatalog.models.length === 0 ? COLD_START_ATTEMPTS : 1;
  let catalog: CopilotPlusCatalog | null = null;
  for (let attempt = 0; attempt < attempts && !catalog; attempt++) {
    if (attempt > 0) {
      await delay(COLD_START_BACKOFF_MS);
      // A Plus state change during the backoff has already fired, so the next
      // read's subscription would never see it: without this the abandoned
      // sync starts another request and holds the caller's serialized queue
      // for the whole deadline.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/476
      if (!stillWanted()) return null;
    }
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
      ...(catalog ? { models: catalog.models, autoEnrollModelIds: catalog.defaultEnabledIds } : {}),
    });
  } catch (err) {
    logError("[modelManagement] Copilot Plus provider sync failed", err);
  }
}
