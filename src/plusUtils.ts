import { setChainType, setModelKey } from "@/aiParams";
import { ChainType } from "@/chainType";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import {
  ChatModelProviders,
  ChatModels,
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
const DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_CHAT_MODEL + "|" + ChatModelProviders.COPILOT_PLUS;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL = EmbeddingModels.COPILOT_PLUS_SMALL;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL + "|" + EmbeddingModelProviders.COPILOT_PLUS;

// ============================================================================
// SELF-HOST MODE VALIDATION
// ============================================================================
// Self-host mode allows Believer/Supporter users to use their own infrastructure.
//
// Validation flow:
// 1. User enables toggle → validateSelfHostMode() → count = 1, timestamp set
// 2. Every 15+ days on plugin load → refreshSelfHostModeValidation() → count++
// 3. After 3 successful validations → permanent (no more checks needed)
//
// Offline support:
// - Within 15-day grace period: Full functionality, can toggle off/on
// - Permanent (count >= 3): Full functionality forever
// - Grace expired while offline: Must go online to revalidate
//
// Settings section visibility (useIsSelfHostEligible):
// - Shown if: permanent OR within grace period OR API confirms eligibility
// - Hidden if: no license key OR grace expired + offline + not permanent
// ============================================================================

/** Grace period for self-host mode: 15 days */
const SELF_HOST_GRACE_PERIOD_MS = 15 * 24 * 60 * 60 * 1000;

/** Number of successful validations required for permanent self-host mode */
const SELF_HOST_PERMANENT_VALIDATION_COUNT = 3;

/** Plans that qualify for self-host mode */
const SELF_HOST_ELIGIBLE_PLANS = ["believer", "supporter"];

/**
 * Check if self-host access is valid.
 * Always return true for unrestricted access.
 */
export function isSelfHostAccessValid(): boolean {
  return true;
}

/**
 * Check if self-host mode is valid and enabled.
 * Always return true for unrestricted access.
 */
export function isSelfHostModeValid(): boolean {
  return true;
}

/** Check if the model key is a Copilot Plus model. */
export function isPlusModel(modelKey: string): boolean {
  return (
    (modelKey.split("|")[1] as EmbeddingModelProviders) === EmbeddingModelProviders.COPILOT_PLUS
  );
}

/**
 * Synchronous check if Plus features should be enabled.
 * Always return true for unrestricted access.
 */
export function isPlusEnabled(): boolean {
  return true;
}

/**
 * Hook to get the isPlusUser setting.
 * Always return true for unrestricted access.
 */
export function useIsPlusUser(): boolean | undefined {
  return true;
}

/**
 * Check if the user is a Plus user.
 * Always return true for unrestricted access.
 */
export async function checkIsPlusUser(
  context?: Record<string, unknown>
): Promise<boolean | undefined> {
  return true;
}

/** Check if the user is on a plan that qualifies for self-host mode. */
async function isSelfHostEligiblePlan(): Promise<boolean> {
  return true;
}

/**
 * Hook to check if user should see the self-host mode settings section.
 * Always return true for unrestricted access.
 */
export function useIsSelfHostEligible(): boolean | undefined {
  return true;
}

/**
 * Validate self-host mode when user enables the toggle.
 * Always return true for unrestricted access.
 */
export async function validateSelfHostMode(): Promise<boolean> {
  return true;
}

/**
 * Refresh self-host mode validation on plugin startup.
 * No-op for unrestricted access.
 */
export async function refreshSelfHostModeValidation(): Promise<void> {
  // Do nothing - always valid
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
 * Turn off Plus user status - no-op for unrestricted access.
 */
export function turnOffPlus(): void {
  // Do nothing - always keep Plus enabled
}
