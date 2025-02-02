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

export function switchToPlusModels(): void {
  const defaultModelKey = ChatModels.COPILOT_PLUS_FLASH + "|" + ChatModelProviders.COPILOT_PLUS;
  const embeddingModelKey =
    EmbeddingModels.COPILOT_PLUS_SMALL + "|" + EmbeddingModelProviders.COPILOT_PLUS;
  setModelKey(defaultModelKey);
  setSettings({
    defaultModelKey,
    embeddingModelKey,
  });
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
    setModelKey(DEFAULT_SETTINGS.defaultModelKey);
    setChainType(DEFAULT_SETTINGS.defaultChainType);
    setSettings({
      defaultChainType: DEFAULT_SETTINGS.defaultChainType,
      defaultModelKey: DEFAULT_SETTINGS.defaultModelKey,
    });
  }
}

export function turnOnPlus(): void {
  const isPlusUser = getSettings().isPlusUser;
  updatePlusUserSettings(true);
  // Do not show the welcome modal if the user is already a plus user before
  // 2024/02/04 (isPlusUser === undefined)
  if (isPlusUser === false) {
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
