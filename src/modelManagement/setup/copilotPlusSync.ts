/**
 * Keeps the Copilot Plus provider synchronized with the models service.
 *
 * The public `GET /models` response is the only catalog authority. Persisted
 * configured-model rows are a cache used to build provider configuration; they
 * are not evidence that a Plus model still exists on the relay.
 */

import {
  BrevilabsClient,
  type BrevilabsModelEntry,
  type BrevilabsModelsResponse,
} from "@/LLMProviders/brevilabsClient";
import { BREVILABS_MODELS_BASE_URL, ChatModels } from "@/constants";
import { logError, logWarn } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { parseCopilotPlusContextLength } from "@/modelManagement/setup/copilotPlusCatalog";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { CopilotSettings } from "@/settings/model";

const EMPTY_MODELS: readonly ModelInfo[] = Object.freeze([]);
const EMPTY_REASONING_EFFORTS: readonly string[] = Object.freeze([]);
const CATALOG_TIMEOUT_MS = 30_000;

export const COPILOT_PLUS_MODELS: readonly ModelInfo[] = Object.freeze([
  {
    id: ChatModels.COPILOT_PLUS_FLASH,
    displayName: "Copilot Plus Flash",
    description: "The default model: fastest responses and the most quota.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_KIMI_K2_6,
    displayName: "Kimi K2.6",
    description: "Good for long-running reasoning tasks.",
    toolCall: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_GLM_5_2,
    displayName: "GLM-5.2",
    description: "A long-horizon frontier open model that beats some of the best closed models.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_KIMI_K2_7_CODE,
    displayName: "Kimi K2.7 Code",
    description: "Optimized for coding tasks.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_DEEPSEEK_V4_PRO,
    displayName: "DeepSeek V4 Pro",
    description: "A top-tier model for the hardest reasoning and agentic tasks.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_DEEPSEEK_V4_FLASH_0731,
    displayName: "DeepSeek V4 Flash 0731",
    description: "The newest DeepSeek V4 Flash snapshot: fast, cheap, and broadly capable.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_MIMO_V2_5,
    displayName: "MiMo V2.5",
    description: "Cost-effective and capable for everyday use.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_MINIMAX_M2_7,
    displayName: "MiniMax M2.7",
    description: "A compact, efficient model for lightweight tasks.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
]);

export const COPILOT_PLUS_DEFAULT_ENABLED_MODELS: readonly string[] = Object.freeze([
  ChatModels.COPILOT_PLUS_FLASH,
  ChatModels.COPILOT_PLUS_DEEPSEEK_V4_PRO,
  ChatModels.COPILOT_PLUS_GLM_5_2,
]);

export type CopilotPlusCatalogStatus = "loading" | "ready" | "error";

/** Immutable live-catalog state shared with picker and session consumers. */
export interface CopilotPlusCatalogSnapshot {
  status: CopilotPlusCatalogStatus;
  models: readonly ModelInfo[];
}

export interface CopilotPlusSyncResult {
  status: "ready" | "error";
  models: readonly ModelInfo[];
}

export type CopilotPlusModelsFetcher = () => Promise<BrevilabsModelsResponse | null>;

const LOADING_SNAPSHOT: CopilotPlusCatalogSnapshot = Object.freeze({
  status: "loading",
  models: EMPTY_MODELS,
});
const ERROR_RESULT: CopilotPlusSyncResult = Object.freeze({
  status: "error",
  models: EMPTY_MODELS,
});

function toModelInfo(entry: BrevilabsModelEntry): ModelInfo | null {
  const id = entry.id?.trim();
  if (!id) return null;

  const model: ModelInfo = {
    id,
    displayName: entry.label?.trim() || id,
    description: entry.description?.trim() || undefined,
  };
  if (typeof entry.supports_reasoning === "boolean") {
    model.reasoning = entry.supports_reasoning;
  }
  // Keep the endpoint's ordered effort contract with the synchronized model,
  // including an explicit empty list, so Agent startup never has to refetch it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
  if (Array.isArray(entry.reasoning_efforts)) {
    const efforts = entry.reasoning_efforts
      .filter((effort): effort is string => typeof effort === "string")
      .map((effort) => effort.trim())
      .filter((effort) => effort.length > 0);
    if (entry.reasoning_efforts.length === 0) {
      model.reasoningEfforts = EMPTY_REASONING_EFFORTS;
    } else if (efforts.length > 0) {
      model.reasoningEfforts = Object.freeze(efforts);
    }
  }
  if (typeof entry.supports_images === "boolean") {
    model.modalities = {
      input: entry.supports_images === true ? ["text", "image"] : ["text"],
      output: ["text"],
    };
  }
  const context = parseCopilotPlusContextLength(entry.context_length);
  // Context meters consume this same snapshot so they never start a second
  // models-endpoint request after OpenCode starts.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
  if (context !== null) model.limits = { context };
  return model;
}

function readLiveModels(response: BrevilabsModelsResponse | null): readonly ModelInfo[] | null {
  if (!Array.isArray(response?.data)) return null;
  const models: ModelInfo[] = [];
  const modelIds = new Set<string>();
  for (const entry of response.data) {
    const model = entry && typeof entry === "object" ? toModelInfo(entry) : null;
    if (!model || modelIds.has(model.id)) return null;
    modelIds.add(model.id);
    models.push(model);
  }
  // An empty or malformed success must not erase cached provider rows. The
  // next successful refresh can safely reconcile the authoritative catalog.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
  if (models.length === 0) return null;
  return Object.freeze(models);
}

async function fetchModelsWithDeadline(
  fetchModels: CopilotPlusModelsFetcher
): Promise<BrevilabsModelsResponse | null> {
  // A request that never settles must become an actionable unavailable state,
  // not leave a saved model disabled as Loading forever.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
  let timeoutId: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(null), CATALOG_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fetchModels(), timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

/**
 * Whether a settings change requires re-reconciling the Plus provider.
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

/** Callable serialized sync queue and observable live-catalog store. */
export interface CopilotPlusSyncQueue {
  (isPaidUser: boolean, licenseKey: string | undefined): Promise<void>;
  getSnapshot(): CopilotPlusCatalogSnapshot;
  subscribe(listener: () => void): () => void;
  /** Wait for the newest provider reconciliation without rejecting on catalog failure. */
  waitForSettled(): Promise<CopilotPlusCatalogSnapshot>;
}

/**
 * Build a per-plugin queue so Plus lifecycle changes reconcile in settings order.
 *
 * @param api - Model-management instance owned by the current plugin lifecycle.
 * @param fetchModels - Public models-endpoint reader.
 */
export function createCopilotPlusSyncQueue(
  api: ModelManagementApi,
  fetchModels: CopilotPlusModelsFetcher = () => BrevilabsClient.getInstance().getModels()
): CopilotPlusSyncQueue {
  let latestRequest = 0;
  let snapshot: CopilotPlusCatalogSnapshot = LOADING_SNAPSHOT;
  let catalogPromise: Promise<CopilotPlusSyncResult> | null = null;
  let latestSync: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const publish = (next: CopilotPlusCatalogSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const loadCatalog = (): Promise<CopilotPlusSyncResult> => {
    if (!catalogPromise) {
      catalogPromise = fetchModelsWithDeadline(fetchModels)
        .then((response) => {
          const models = readLiveModels(response);
          if (!models) {
            logWarn("[modelManagement] Copilot Plus catalog unavailable");
            return ERROR_RESULT;
          }
          return Object.freeze({ status: "ready" as const, models });
        })
        .catch((error) => {
          logError("[modelManagement] Copilot Plus catalog fetch failed", error);
          return ERROR_RESULT;
        });
    }
    return catalogPromise;
  };

  const enqueue: CopilotPlusSyncQueue = (isPaidUser, licenseKey) => {
    const request = ++latestRequest;
    const isFirstRequest = catalogPromise === null;
    const catalog = loadCatalog();
    if (isFirstRequest) publish(LOADING_SNAPSHOT);
    const previousSync = latestSync;

    // Revocation cannot wait for the public catalog. Invalidating the request
    // first also prevents an older sign-in, still waiting on the endpoint, from
    // registering credentials after this sign-out.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
    if (!isPaidUser || !licenseKey) {
      latestSync = (async () => {
        try {
          await api.setup.copilotPlus.unregisterPlusProvider();
          const result = await catalog;
          if (request === latestRequest) publish(result);
        } catch (error) {
          logError("[modelManagement] Copilot Plus provider sync failed", error);
          if (request === latestRequest) publish(ERROR_RESULT);
        }
      })();
      return latestSync;
    }

    latestSync = (async () => {
      // A preceding sign-out must finish before a newer key is registered. An
      // older sign-in becomes a no-op after the request-number check below.
      await previousSync.catch(() => undefined);
      const result = await catalog;
      if (request !== latestRequest) return;
      if (result.status === "error") {
        publish(result);
        return;
      }
      try {
        await api.setup.copilotPlus.registerPlusProvider({
          providerType: "openai-compatible",
          displayName: "Copilot",
          baseUrl: BREVILABS_MODELS_BASE_URL,
          apiKey: licenseKey,
          models: result.models,
        });
        if (request === latestRequest) publish(result);
      } catch (error) {
        logError("[modelManagement] Copilot Plus provider sync failed", error);
        if (request === latestRequest) publish(ERROR_RESULT);
      }
    })();
    return latestSync;
  };
  enqueue.getSnapshot = () => snapshot;
  enqueue.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  enqueue.waitForSettled = async () => {
    // Settings can change while the endpoint is pending. Follow the newest
    // reconciliation so OpenCode never starts between an obsolete result and
    // the current provider write.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
    while (true) {
      const pending = latestSync;
      await pending.catch(() => undefined);
      if (pending === latestSync) return snapshot;
    }
  };
  return enqueue;
}
