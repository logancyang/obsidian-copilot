// import { setChainType, setModelKey } from "@/aiParams"; // Plus features disabled
// import { ChainType } from "@/chainFactory"; // Plus features disabled
// import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal"; // Plus features disabled
// import { // Plus features disabled
//   ChatModelProviders, // Plus features disabled
//   ChatModels, // Plus features disabled
//   EmbeddingModelProviders, // Plus features disabled
//   EmbeddingModels, // Plus features disabled
//   PlusUtmMedium, // Plus features disabled
// } from "@/constants"; // Plus features disabled
// import { BrevilabsClient } from "@/LLMProviders/brevilabsClient"; // BrevilabsClient disabled
// import VectorStoreManager from "@/search/vectorStoreManager"; // Plus features disabled
// import { getSettings, setSettings, updateSetting, useSettingsValue } from "@/settings/model"; // Plus features disabled
import { PlusUtmMedium } from "@/constants"; // Keep for navigateToPlusPage

// All Plus related constants and functions are removed or commented out.
// License checks, Plus status, and Plus-specific settings applications are disabled.

export function createPlusPageUrl(medium: PlusUtmMedium): string {
  return `https://www.obsidiancopilot.com?utm_source=obsidian&utm_medium=${medium}`;
}

export function navigateToPlusPage(medium: PlusUtmMedium): void {
  window.open(createPlusPageUrl(medium), "_blank");
}
