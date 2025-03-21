import { setChainType, setModelKey } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import {
  ChatModelProviders,
  ChatModels,
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
 * WARNING! If the embedding model is changed, the vault will be indexed. Use it
 * with caution.
 */
export function applyPlusSettings(): void {
  const defaultModelKey = DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY;
  const embeddingModelKey = DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY;
  const previousEmbeddingModelKey = getSettings().embeddingModelKey;
  setModelKey(defaultModelKey);
  setChainType(ChainType.COPILOT_PLUS_CHAIN);
  setSettings({
    defaultModelKey,
    embeddingModelKey,
    defaultChainType: ChainType.COPILOT_PLUS_CHAIN,
  });
  if (previousEmbeddingModelKey !== embeddingModelKey) {
    VectorStoreManager.getInstance().indexVaultToVectorStore();
  }
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
  updateSetting("isPlusUser", false);
  if (previousIsPlusUser) {
    new CopilotPlusExpiredModal(app).open();
  }
}
