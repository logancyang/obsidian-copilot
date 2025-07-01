import { setChainType, setModelKey } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import {
  ChatModelProviders,
  ChatModels,
  DEFAULT_SETTINGS,
  EmbeddingModelProviders,
  EmbeddingModels,
  PlusUtmMedium,
} from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import VectorStoreManager from "@/search/vectorStoreManager";
import { getSettings, setSettings, updateSetting, useSettingsValue } from "@/settings/model";

export const DEFAULT_COPILOT_PLUS_CHAT_MODEL = ChatModels.COPILOT_PLUS_FLASH;
export const DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_CHAT_MODEL + "|" + ChatModelProviders.COPILOT_PLUS;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL = EmbeddingModels.COPILOT_PLUS_SMALL;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL + "|" + EmbeddingModelProviders.COPILOT_PLUS;

// Default models for free users (imported from DEFAULT_SETTINGS)
export const DEFAULT_FREE_CHAT_MODEL_KEY = DEFAULT_SETTINGS.defaultModelKey;
export const DEFAULT_FREE_EMBEDDING_MODEL_KEY = DEFAULT_SETTINGS.embeddingModelKey;

/** Check if the model key is a Copilot Plus model. */
export function isPlusModel(modelKey: string): boolean {
  return modelKey.split("|")[1] === EmbeddingModelProviders.COPILOT_PLUS;
}

/** Hook to get the isPlusUser setting. */
export function useIsPlusUser(): boolean | undefined {
  const settings = useSettingsValue();
  return settings.isPlusUser;
}

/** Check if the user is a Plus user. */
export async function checkIsPlusUser(): Promise<boolean | undefined> {
  if (!getSettings().plusLicenseKey) {
    turnOffPlus();
    return false;
  }
  const brevilabsClient = BrevilabsClient.getInstance();
  const result = await brevilabsClient.validateLicenseKey();
  return result.isValid;
}

/** Check if the user is on the believer plan. */
export async function isBelieverPlan(): Promise<boolean> {
  if (!getSettings().plusLicenseKey) {
    return false;
  }
  const brevilabsClient = BrevilabsClient.getInstance();
  const result = await brevilabsClient.validateLicenseKey();
  return result.plan?.toLowerCase() === "believer";
}

/**
 * Apply the Copilot Plus settings.
 * Note: The indexVaultToVectorStore method will automatically detect embedding
 * model changes and trigger reindexing if needed, so we don't need to check
 * for model changes here to avoid duplicate indexing operations.
 */
export function applyPlusSettings(): void {
  const defaultModelKey = DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY;
  const embeddingModelKey = DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY;

  console.log("Applying Plus settings:", {
    previousEmbeddingModelKey: getSettings().embeddingModelKey,
    newEmbeddingModelKey: embeddingModelKey,
    defaultModelKey,
  });

  setModelKey(defaultModelKey);
  setChainType(ChainType.COPILOT_PLUS_CHAIN);
  setSettings({
    defaultModelKey,
    embeddingModelKey,
    defaultChainType: ChainType.COPILOT_PLUS_CHAIN,
  });

  // Always trigger indexing when applying Plus settings since the embedding model
  // has likely changed. The indexVaultToVectorStore method will handle model
  // change detection internally and show appropriate notices.
  VectorStoreManager.getInstance().indexVaultToVectorStore();
}

export function createPlusPageUrl(medium: PlusUtmMedium): string {
  return `https://www.obsidiancopilot.com?utm_source=obsidian&utm_medium=${medium}`;
}

export function navigateToPlusPage(medium: PlusUtmMedium): void {
  window.open(createPlusPageUrl(medium), "_blank");
}

export function turnOnPlus(): void {
  updateSetting("isPlusUser", true);
}

export function turnOffPlus(): void {
  const previousIsPlusUser = getSettings().isPlusUser;

  // Reset models to default free user models
  setModelKey(DEFAULT_FREE_CHAT_MODEL_KEY);
  setChainType(DEFAULT_SETTINGS.defaultChainType);
  setSettings({
    isPlusUser: false,
    defaultModelKey: DEFAULT_FREE_CHAT_MODEL_KEY,
    embeddingModelKey: DEFAULT_FREE_EMBEDDING_MODEL_KEY,
    defaultChainType: DEFAULT_SETTINGS.defaultChainType,
  });

  // Note: Reindexing will be handled automatically by the model change detection system
  // when the embedding model change is detected elsewhere in the application

  if (previousIsPlusUser) {
    new CopilotPlusExpiredModal(app).open();
  }
}
