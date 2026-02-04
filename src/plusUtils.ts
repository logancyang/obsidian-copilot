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
import { logError, logInfo } from "@/logger";
import { getSettings, setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React from "react";

export const DEFAULT_COPILOT_PLUS_CHAT_MODEL = ChatModels.COPILOT_PLUS_FLASH;
export const DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_CHAT_MODEL + "|" + ChatModelProviders.COPILOT_PLUS;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL = EmbeddingModels.COPILOT_PLUS_SMALL;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL + "|" + EmbeddingModelProviders.COPILOT_PLUS;

// Default models for free users (imported from DEFAULT_SETTINGS)
export const DEFAULT_FREE_CHAT_MODEL_KEY = DEFAULT_SETTINGS.defaultModelKey;
export const DEFAULT_FREE_EMBEDDING_MODEL_KEY = DEFAULT_SETTINGS.embeddingModelKey;

/** Grace period for self-host mode: 14 days (matches refund policy) */
const SELF_HOST_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

/** Number of successful validations required for permanent self-host mode */
const SELF_HOST_PERMANENT_VALIDATION_COUNT = 3;

/** Plans that qualify for self-host mode */
const SELF_HOST_ELIGIBLE_PLANS = ["believer", "supporter"];

/**
 * Check if self-host mode is valid.
 * Valid if: permanently validated (3+ successful checks) OR within 14-day grace period.
 */
export function isSelfHostModeValid(): boolean {
  const settings = getSettings();
  if (!settings.enableSelfHostMode || settings.selfHostModeValidatedAt == null) {
    return false;
  }
  // Permanently valid after 3 successful validations
  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    return true;
  }
  // Otherwise, check grace period
  return Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS;
}

/** Check if the model key is a Copilot Plus model. */
export function isPlusModel(modelKey: string): boolean {
  return modelKey.split("|")[1] === EmbeddingModelProviders.COPILOT_PLUS;
}

/**
 * Synchronous check if Plus features should be enabled.
 * Returns true when self-host mode is valid OR user has valid Plus subscription.
 * Use this for synchronous checks (e.g., model validation, UI state).
 */
export function isPlusEnabled(): boolean {
  const settings = getSettings();
  // Self-host mode with valid plan validation bypasses Plus requirements
  if (isSelfHostModeValid()) {
    return true;
  }
  return settings.isPlusUser === true;
}

/**
 * Hook to get the isPlusUser setting.
 * Returns true when self-host mode is valid to allow offline usage.
 */
export function useIsPlusUser(): boolean | undefined {
  const settings = useSettingsValue();
  // Self-host mode with valid plan validation bypasses Plus requirements
  if (settings.enableSelfHostMode && settings.selfHostModeValidatedAt != null) {
    // Permanently valid after 3 successful validations
    if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
      return true;
    }
    // Otherwise, check grace period
    const isValid = Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS;
    if (isValid) {
      return true;
    }
  }
  return settings.isPlusUser;
}

/**
 * Check if the user is a Plus user.
 * When self-host mode is valid, this returns true to allow offline usage.
 */
export async function checkIsPlusUser(context?: Record<string, any>): Promise<boolean | undefined> {
  // Self-host mode with valid plan validation bypasses license check
  if (isSelfHostModeValid()) {
    return true;
  }

  if (!getSettings().plusLicenseKey) {
    turnOffPlus();
    return false;
  }
  const brevilabsClient = BrevilabsClient.getInstance();
  const result = await brevilabsClient.validateLicenseKey(context);
  return result.isValid;
}

/** Check if the user is on a plan that qualifies for self-host mode. */
export async function isSelfHostEligiblePlan(): Promise<boolean> {
  if (!getSettings().plusLicenseKey) {
    return false;
  }
  const brevilabsClient = BrevilabsClient.getInstance();
  const result = await brevilabsClient.validateLicenseKey();
  const planName = result.plan?.toLowerCase();
  return planName != null && SELF_HOST_ELIGIBLE_PLANS.includes(planName);
}

/**
 * Hook to check if current user is eligible for self-host mode.
 * Returns undefined while loading, boolean once checked.
 * If self-host mode is already enabled and validated (or permanently valid), returns true.
 */
export function useIsSelfHostEligible(): boolean | undefined {
  const settings = useSettingsValue();
  const [isEligible, setIsEligible] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    // If self-host mode is already enabled and validated, show the section (offline support)
    if (isSelfHostModeValid()) {
      setIsEligible(true);
      return;
    }

    if (!settings.plusLicenseKey) {
      setIsEligible(false);
      return;
    }

    // Check via API for users who haven't enabled self-host mode yet
    isSelfHostEligiblePlan()
      .then(setIsEligible)
      .catch(() => setIsEligible(false));
  }, [
    settings.plusLicenseKey,
    settings.enableSelfHostMode,
    settings.selfHostModeValidatedAt,
    settings.selfHostValidationCount,
  ]);

  return isEligible;
}

/**
 * Validate self-host mode eligibility for the current user.
 * Call this when the user manually enables self-host mode in the UI.
 * If validation fails, the UI should revert the toggle.
 * @returns true if user is on an eligible plan, false otherwise
 */
export async function validateSelfHostMode(): Promise<boolean> {
  const settings = getSettings();

  // Already permanently validated, just update timestamp
  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    updateSetting("selfHostModeValidatedAt", Date.now());
    logInfo("Self-host mode re-enabled (permanently validated)");
    return true;
  }

  const isEligible = await isSelfHostEligiblePlan();
  if (!isEligible) {
    logInfo("Self-host mode requires an eligible plan (Believer, Supporter)");
    new Notice("Self-host mode is only available for Believer and Supporter plan subscribers.");
    return false;
  }

  // Set the validation timestamp, preserve existing count or initialize to 1
  const newCount = Math.max(settings.selfHostValidationCount || 0, 1);
  updateSetting("selfHostModeValidatedAt", Date.now());
  updateSetting("selfHostValidationCount", newCount);
  logInfo(`Self-host mode validation successful (${newCount}/3)`);
  return true;
}

/**
 * Refresh self-host mode validation if user is online.
 * Call this periodically (e.g., on plugin load) to extend the grace period.
 * After 3 successful validations, self-host mode becomes permanently valid.
 */
export async function refreshSelfHostModeValidation(): Promise<void> {
  const settings = getSettings();
  if (!settings.enableSelfHostMode) {
    return;
  }

  // Already permanently validated, no need to refresh
  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    logInfo("Self-host mode permanently validated, skipping refresh");
    return;
  }

  try {
    const isEligible = await isSelfHostEligiblePlan();
    if (isEligible) {
      const newCount = (settings.selfHostValidationCount || 0) + 1;
      updateSetting("selfHostModeValidatedAt", Date.now());
      updateSetting("selfHostValidationCount", newCount);

      if (newCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
        logInfo("Self-host mode permanently validated (3/3)");
        new Notice("Self-host mode is now permanently enabled!");
      } else {
        logInfo(`Self-host mode validation refreshed (${newCount}/3)`);
      }
    } else {
      // User is no longer on an eligible plan, disable self-host mode
      updateSetting("enableSelfHostMode", false);
      updateSetting("selfHostModeValidatedAt", null);
      updateSetting("selfHostValidationCount", 0);
      logInfo("Self-host mode disabled - user is no longer on an eligible plan");
      new Notice("Self-host mode has been disabled. An eligible plan is required.");
    }
  } catch (error) {
    // Offline or API error - keep existing validation (grace period still applies)
    logInfo("Could not refresh self-host mode validation (offline?):", error);
  }
}

/**
 * Apply the Copilot Plus settings.
 * Includes clinical fix to ensure indexing is triggered when embedding model changes,
 * as the automatic detection doesn't work reliably in all scenarios.
 */
export function applyPlusSettings(): void {
  const defaultModelKey = DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY;
  const embeddingModelKey = DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY;
  const previousEmbeddingModelKey = getSettings().embeddingModelKey;

  logInfo("applyPlusSettings: Changing embedding model", {
    from: previousEmbeddingModelKey,
    to: embeddingModelKey,
    changed: previousEmbeddingModelKey !== embeddingModelKey,
  });

  setModelKey(defaultModelKey);
  setChainType(ChainType.COPILOT_PLUS_CHAIN);
  setSettings({
    defaultModelKey,
    embeddingModelKey,
    defaultChainType: ChainType.COPILOT_PLUS_CHAIN,
  });

  // Ensure indexing happens only once when embedding model changes
  if (previousEmbeddingModelKey !== embeddingModelKey) {
    logInfo("applyPlusSettings: Embedding model changed, triggering indexing");
    import("@/search/vectorStoreManager")
      .then(async (module) => {
        await module.default.getInstance().indexVaultToVectorStore();
      })
      .catch((error) => {
        logError("Failed to trigger indexing after Plus settings applied:", error);
        new Notice(
          "Failed to update Copilot index. Please try force reindexing from the command palette."
        );
      });
  } else {
    logInfo("applyPlusSettings: No embedding model change, skipping indexing");
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

/**
 * Turn off Plus user status.
 * IMPORTANT: This is called on every plugin start for users without a Plus license key (see checkIsPlusUser).
 * DO NOT reset model settings here - it will cause free users to lose their model selections on every app restart.
 * Only update the isPlusUser flag.
 */
export function turnOffPlus(): void {
  const previousIsPlusUser = getSettings().isPlusUser;
  updateSetting("isPlusUser", false);
  if (previousIsPlusUser) {
    new CopilotPlusExpiredModal(app).open();
  }
}
