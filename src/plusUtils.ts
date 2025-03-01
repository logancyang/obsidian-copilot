import { ChainType } from "@/chainFactory";
import {
  ChatModelProviders,
  ChatModels,
  EmbeddingModelProviders,
  EmbeddingModels,
  PlusUtmMedium,
} from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import {
  getSettings,
  getSystemPrompt,
  setSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { setChainType, setModelKey } from "@/aiParams";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import VectorStoreManager from "@/search/vectorStoreManager";

export const DEFAULT_COPILOT_PLUS_CHAT_MODEL = ChatModels.COPILOT_PLUS_FLASH;
export const DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_CHAT_MODEL + "|" + ChatModelProviders.COPILOT_PLUS;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL = EmbeddingModels.COPILOT_PLUS_SMALL;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL + "|" + EmbeddingModelProviders.COPILOT_PLUS;

// Cache for the composer prompt
let cachedComposerPrompt: string | null = null;

export function resetComposerPromptCache(): void {
  cachedComposerPrompt = null;
}

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

export async function getComposerSystemPrompt(): Promise<string> {
  // Get the current system prompt
  const currentSystemPrompt = getSystemPrompt();

  // If we already have a cached composer prompt, use it
  if (cachedComposerPrompt) {
    return `${currentSystemPrompt}\n${cachedComposerPrompt}`;
  }

  // Otherwise, fetch it from the API
  const brevilabsClient = BrevilabsClient.getInstance();
  try {
    // Get the composer prompt from the API
    const composerPromptResponse = await brevilabsClient.composerPrompt();
    cachedComposerPrompt = composerPromptResponse.prompt;

    // Combine the prompts
    return `${currentSystemPrompt}\n${cachedComposerPrompt}`;
  } catch (error) {
    console.error("Failed to fetch composer prompt:", error);
    // Fallback to just the system prompt if API call fails
    return currentSystemPrompt;
  }
}
