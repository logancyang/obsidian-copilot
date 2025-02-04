import { ChainType } from "@/chainFactory";
import {
  ChatModelProviders,
  ChatModels,
  DEFAULT_SETTINGS,
  EmbeddingModelProviders,
  EmbeddingModels,
  PlusUtmMedium,
} from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { getSettings, setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { setChainType, setModelKey } from "@/aiParams";
import { CopilotPlusWelcomeModal } from "@/components/modals/CopilotPlusWelcomeModal";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import VectorStoreManager from "@/search/vectorStoreManager";

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
  return await brevilabsClient.validateLicenseKey();
}

/**
 * Switch to the Copilot Plus chat and embedding models.
 * WARNING! If the embedding model is changed, the vault will be indexed. Use it
 * with caution.
 */
export function switchToPlusModels(): void {
  const defaultModelKey = DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY;
  const embeddingModelKey = DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY;
  const previousEmbeddingModelKey = getSettings().embeddingModelKey;
  setModelKey(defaultModelKey);
  setSettings({
    defaultModelKey,
    embeddingModelKey,
  });
  if (previousEmbeddingModelKey !== embeddingModelKey) {
    VectorStoreManager.getInstance().indexVaultToVectorStore(true);
  }
}

export function createPlusPageUrl(medium: PlusUtmMedium): string {
  return `https://www.obsidiancopilot.com?utm_source=obsidian&utm_medium=${medium}`;
}

export function navigateToPlusPage(medium: PlusUtmMedium): void {
  window.open(createPlusPageUrl(medium), "_blank");
}

export function updatePlusUserSettings(isPlusUser: boolean): void {
  updateSetting("isPlusUser", isPlusUser);
  if (isPlusUser) {
    setChainType(ChainType.COPILOT_PLUS_CHAIN);
    setSettings({
      defaultChainType: ChainType.COPILOT_PLUS_CHAIN,
    });
    // Do not set models here because it needs user confirmation.
  } else {
    setChainType(DEFAULT_SETTINGS.defaultChainType);
  }
}

export function turnOnPlus(): void {
  const isPlusUser = getSettings().isPlusUser;
  updatePlusUserSettings(true);
  if (!isPlusUser) {
    new CopilotPlusWelcomeModal(app).open();
  }
}

export function turnOffPlus(): void {
  const isPlusUser = getSettings().isPlusUser;
  updatePlusUserSettings(false);
  if (isPlusUser) {
    new CopilotPlusExpiredModal(app).open();
  }
}
