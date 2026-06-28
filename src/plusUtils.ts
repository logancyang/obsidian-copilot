import { setChainType, setModelKey } from "@/aiParams";
import { ChainType } from "@/chainType";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import {
  ChatModelProviders,
  ChatModels,
  EmbeddingModelProviders,
  EmbeddingModels,
  PLUS_UTM_MEDIUMS,
  PlusUtmMedium,
} from "@/constants";
import { verifyEntitlement } from "@/entitlement";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logError, logInfo } from "@/logger";
import {
  CopilotSettings,
  getSettings,
  setSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { App, Notice } from "obsidian";
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
 * Valid if: permanently validated (3+ successful checks) OR within 15-day grace period.
 */
export function isSelfHostAccessValid(): boolean {
  const settings = getSettings();
  if (settings.selfHostModeValidatedAt == null) {
    return false;
  }
  // Permanently valid after 3 successful validations
  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    return true;
  }
  // Otherwise, check grace period
  return Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS;
}

/**
 * Check if self-host mode is valid and enabled.
 * Gates on the toggle alone: an eligible user who turned self-host mode on may
 * use their own self-host tools (web search, YouTube) without a validation
 * receipt. The startup refreshSelfHostModeValidation() disables the toggle for
 * genuinely ineligible plans, so the toggle is a sufficient gate.
 */
export function isSelfHostModeValid(): boolean {
  return getSettings().enableSelfHostMode === true;
}

/** Check if the model key is a Copilot Plus model. */
export function isPlusModel(modelKey: string): boolean {
  const settings = getSettings();
  const configuredModel = settings.configuredModels.find(
    (model) => model.configuredModelId === modelKey
  );
  if (configuredModel) {
    return settings.providers[configuredModel.providerId]?.origin.kind === "copilot-plus";
  }
  return (
    (modelKey.split("|")[1] as EmbeddingModelProviders) === EmbeddingModelProviders.COPILOT_PLUS
  );
}

/**
 * Synchronous check for paid (any valid license, incl. Lite) feature access.
 * Returns true when self-host mode is valid OR the user has any valid paid
 * subscription. Use this for the broad Plus-feature gates (model validation, UI
 * state) that should remain available to every paying user.
 */
export function isPaidEnabled(): boolean {
  const settings = getSettings();
  // Self-host mode with valid plan validation bypasses subscription requirements
  if (isSelfHostModeValid()) {
    return true;
  }
  return settings.isPaidUser === true;
}

/**
 * True once the entitlement token's expiry has passed. Only token-derived state
 * carries an expiry (tokenless fallback leaves it 0), so this honors the JWS
 * `exp` for the strict gate even offline, without affecting the broad paid gate.
 */
function isEntitlementExpired(settings: CopilotSettings): boolean {
  return settings.entitlementExpiresAt > 0 && Date.now() >= settings.entitlementExpiresAt;
}

/**
 * Synchronous check for tier >= Plus (excludes Lite) — the gate for
 * Plus-and-above features such as multi-agent fan-out. Self-host plans
 * (Believer/Supporter) are >= Plus, so a valid self-host bypass grants this too.
 * Backed by the signed entitlement token via `settings.isPlusUser`, and locks
 * once the token's `exp` passes (even offline).
 */
export function isPlusEnabled(): boolean {
  const settings = getSettings();
  if (isSelfHostModeValid()) {
    return true;
  }
  return settings.isPlusUser === true && !isEntitlementExpired(settings);
}

/**
 * Self-host bypass for the reactive hooks: a license-keyed self-host user with a
 * still-valid validation receipt (permanent or within grace) is treated as
 * entitled offline. Mirrors the offline allowance in `useIsSelfHostEligible`.
 */
function hasSelfHostHookBypass(settings: CopilotSettings): boolean {
  if (
    !settings.plusLicenseKey ||
    !settings.enableSelfHostMode ||
    settings.selfHostModeValidatedAt == null
  ) {
    return false;
  }
  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    return true;
  }
  return Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS;
}

/**
 * Hook for paid status (any valid license, incl. Lite). Returns true when
 * self-host mode is valid to allow offline usage.
 */
export function useIsPaidUser(): boolean | undefined {
  const settings = useSettingsValue();
  if (hasSelfHostHookBypass(settings)) {
    return true;
  }
  return settings.isPaidUser;
}

/**
 * Hook for tier >= Plus (excludes Lite) — the reactive gate for Plus-and-above
 * features. Self-host plans are >= Plus, so the self-host bypass grants this too.
 */
export function useIsPlusUser(): boolean | undefined {
  const settings = useSettingsValue();
  if (hasSelfHostHookBypass(settings)) {
    return true;
  }
  if (isEntitlementExpired(settings)) {
    return false;
  }
  return settings.isPlusUser;
}

/**
 * Synchronous entitlement check for the multi-agent fan-out feature. Gated on
 * tier >= Plus (not merely "paid"), so Lite users are excluded.
 */
export function canUseMultiAgent(): boolean {
  return isPlusEnabled();
}

/**
 * Authoritative send-boundary entitlement check for the fan-out feature — the
 * single source of truth the non-React session calls before dispatching, so a UI
 * bypass can't evade the paywall.
 *
 * Fast path: a Plus-tier user (cached `isPlusEnabled()`) is allowed with no
 * network call. Slow path: re-verify against `/license` so a stale-false cache
 * still gets through; we then re-read the freshly-applied entitlement (never the
 * broad `isValid`) so Lite stays blocked. Anything not confirmed >= Plus is a
 * HARD block (no single-agent fallback).
 */
export async function ensureMultiAgentEntitlement(
  app?: App,
  context?: Record<string, unknown>
): Promise<boolean> {
  if (isPlusEnabled()) {
    return true;
  }
  // Re-verify so a stale-false cache for a real Plus user still gets through;
  // `validateLicenseKey` applies the signed entitlement (or fallback) to settings.
  await BrevilabsClient.getInstance().validateLicenseKey(app, {
    feature: "multi_agent_per_turn",
    ...context,
  });
  return isPlusEnabled();
}

/**
 * Surface the multi-agent-is-Plus upgrade prompt, reusing the shared Plus CTA
 * (`navigateToPlusPage`) so callers and tests share one copy + action.
 */
export function showMultiAgentUpgradePrompt(): void {
  new Notice(
    "Multi-agent QA (@-mentioning more than one agent in a turn) is a Copilot Plus feature. Opening the upgrade page…",
    8000
  );
  navigateToPlusPage(PLUS_UTM_MEDIUMS.MULTI_AGENT);
}

/**
 * Reactive form of {@link canUseMultiAgent} for React render gates; subscribes to
 * settings so the gate flips live. Mirrors `useIsPlusUser` (not `isPlusEnabled`),
 * so it can differ from the sync form for a self-host user with the toggle on but
 * no license receipt yet. `undefined` (still resolving) reads as not entitled.
 */
export function useCanUseMultiAgent(): boolean {
  return useIsPlusUser() === true;
}

/**
 * Check if the user has a valid paid license (any tier, incl. Lite).
 * When self-host mode is valid, this returns true to allow offline usage.
 */
export async function checkIsPaidUser(
  app?: App,
  context?: Record<string, unknown>
): Promise<boolean | undefined> {
  // Self-host mode with valid plan validation bypasses license check
  if (isSelfHostModeValid()) {
    return true;
  }

  if (!getSettings().plusLicenseKey) {
    turnOffPaid(app);
    return false;
  }
  const brevilabsClient = BrevilabsClient.getInstance();
  const result = await brevilabsClient.validateLicenseKey(app, context);
  return result.isValid;
}

/** Check if the user is on a plan that qualifies for self-host mode. */
async function isSelfHostEligiblePlan(): Promise<boolean> {
  if (!getSettings().plusLicenseKey) {
    return false;
  }
  const brevilabsClient = BrevilabsClient.getInstance();
  const result = await brevilabsClient.validateLicenseKey();
  const planName = result.plan?.toLowerCase();
  return planName != null && SELF_HOST_ELIGIBLE_PLANS.includes(planName);
}

/**
 * Hook to check if user should see the self-host mode settings section.
 * Returns undefined while loading, boolean once checked.
 *
 * Eligibility rules:
 * 1. No license key: Not eligible (immediately revokes access)
 * 2. Has license key: Verify via API (handles key changes, e.g. believer → plus)
 *    - API success: Use result (revoke self-host mode if not eligible)
 *    - API failure (offline): Fall back to cached validation
 *      (permanent count >= 3 OR within 15-day grace period)
 */
export function useIsSelfHostEligible(): boolean | undefined {
  const settings = useSettingsValue();
  const [isEligible, setIsEligible] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    // No license key = not eligible, regardless of cached validation state.
    // Also force self-host mode OFF so the toggle reflects the revoked state.
    if (!settings.plusLicenseKey) {
      if (settings.enableSelfHostMode) {
        updateSetting("enableSelfHostMode", false);
      }
      setIsEligible(false);
      return;
    }

    // Has license key - always verify via API to handle key changes (e.g. believer → plus).
    // Fall back to cached validation only when offline.
    isSelfHostEligiblePlan()
      .then((eligible) => {
        if (!eligible && settings.enableSelfHostMode) {
          updateSetting("enableSelfHostMode", false);
        }
        setIsEligible(eligible);
      })
      .catch(() => {
        // Offline fallback: trust cached validation state
        if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
          setIsEligible(true);
          return;
        }
        if (
          settings.selfHostModeValidatedAt != null &&
          Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS
        ) {
          setIsEligible(true);
          return;
        }
        setIsEligible(false);
      });
  }, [
    settings.plusLicenseKey,
    settings.enableSelfHostMode,
    settings.selfHostModeValidatedAt,
    settings.selfHostValidationCount,
  ]);

  return isEligible;
}

/**
 * Validate self-host mode when user enables the toggle.
 * Called from UI when toggle is switched ON.
 *
 * Flow:
 * 1. If permanently validated (count >= 3): Allow immediately (offline-safe)
 * 2. If within grace period: Allow immediately (offline-safe)
 * 3. Otherwise: Require API validation (online only)
 *    - Success: Set count = max(current, 1), update timestamp
 *    - Failure: Return false, UI should revert toggle
 *
 * @returns true if validation passed, false if user should not enable
 */
export async function validateSelfHostMode(): Promise<boolean> {
  const settings = getSettings();

  // Already permanently validated - allow re-enable (offline-safe)
  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    updateSetting("selfHostModeValidatedAt", Date.now());
    logInfo("Self-host mode re-enabled (permanently validated)");
    return true;
  }

  // Within grace period - allow re-enable (offline-safe)
  if (
    settings.selfHostModeValidatedAt != null &&
    Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS
  ) {
    logInfo("Self-host mode re-enabled (within grace period)");
    return true;
  }

  // Not in grace period - require API validation (online only)
  const isEligible = await isSelfHostEligiblePlan();
  if (!isEligible) {
    logInfo("Self-host mode requires an eligible plan (Believer, Supporter)");
    new Notice("Self-host mode is only available for Believer and Supporter plan subscribers.");
    return false;
  }

  // First-time or expired - set timestamp and initialize count
  const newCount = Math.max(settings.selfHostValidationCount || 0, 1);
  updateSetting("selfHostModeValidatedAt", Date.now());
  updateSetting("selfHostValidationCount", newCount);
  logInfo(`Self-host mode validation successful (${newCount}/3)`);
  return true;
}

/**
 * Refresh self-host mode validation on plugin startup.
 * Called from main.ts on plugin load.
 *
 * Flow:
 * 1. If toggle OFF or permanently validated: No-op
 * 2. API check:
 *    - Eligible + 15+ days since last: Increment count, update timestamp
 *    - Eligible + <15 days: Log only (preserve countdown)
 *    - Not eligible: Disable toggle, reset count to 0
 *    - Offline/error: No-op (grace period continues)
 *
 * Count progression: 1 → 2 → 3 (permanent) over minimum 28 days.
 */
export async function refreshSelfHostModeValidation(): Promise<void> {
  const settings = getSettings();
  if (!settings.enableSelfHostMode && !settings.enableMiyo) {
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
      const now = Date.now();
      const timeSinceLastValidation = now - (settings.selfHostModeValidatedAt || 0);
      const shouldIncrementCount = timeSinceLastValidation >= SELF_HOST_GRACE_PERIOD_MS;

      if (shouldIncrementCount) {
        // 15+ days since last validation - increment count and update timestamp
        const newCount = (settings.selfHostValidationCount || 0) + 1;
        updateSetting("selfHostModeValidatedAt", now);
        updateSetting("selfHostValidationCount", newCount);

        if (newCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
          logInfo("Self-host mode permanently validated (3/3)");
          new Notice("Self-host mode is now permanently enabled!");
        } else {
          logInfo(`Self-host mode validation refreshed (${newCount}/3)`);
        }
      } else {
        // Less than 15 days - don't update timestamp (preserve interval countdown)
        logInfo("Self-host mode validated (waiting for 15-day interval to increment count)");
      }
    } else {
      // User is no longer on an eligible plan, disable self-host mode
      updateSetting("enableSelfHostMode", false);
      updateSetting("enableMiyo", false);
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
  const settings = getSettings();
  const plusProviderIds = new Set(
    Object.values(settings.providers)
      .filter((provider) => provider.origin.kind === "copilot-plus")
      .map((provider) => provider.providerId)
  );
  const defaultModelKey =
    settings.configuredModels.find(
      (model) =>
        plusProviderIds.has(model.providerId) &&
        model.info.id === (DEFAULT_COPILOT_PLUS_CHAT_MODEL as string)
    )?.configuredModelId ?? DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY;
  const embeddingModelKey = DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY;
  const previousEmbeddingModelKey = settings.embeddingModelKey;

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

/**
 * Mark the user as paid via the no-token fallback path (valid license, but the
 * server didn't issue a signed entitlement yet). Sets both flags true and clears
 * any stale token. `isPlusUser` mirrors `isPaidUser` here because no sub-Plus
 * paid tier exists until the server ships tokens + Lite/Pro together — so this is
 * safe and preserves today's behavior. See "Copilot Entitlement Token Design".
 */
export function turnOnPaid(): void {
  setSettings({
    isPaidUser: true,
    isPlusUser: true,
    entitlementToken: "",
    entitlementExpiresAt: 0,
  });
}

/**
 * Paid license confirmed by the server, but its entitlement token could not be
 * verified (verifying key not shipped yet / kid rotation). Grant paid so general
 * Plus features keep working, but WITHHOLD the strict gate — otherwise an
 * unverifiable Lite token would bypass the multi-agent gate. Fails closed for
 * multi-agent until the matching public key ships.
 */
export function markPaidPendingEntitlement(): void {
  setSettings({
    isPaidUser: true,
    isPlusUser: false,
    entitlementToken: "",
    entitlementExpiresAt: 0,
  });
}

/**
 * Clear all entitlement state silently (no modal). Only invoked on an
 * authoritative negative (invalid license / no license key) via turnOffPaid.
 */
function clearEntitlement(): void {
  setSettings({
    isPaidUser: false,
    isPlusUser: false,
    entitlementToken: "",
    entitlementExpiresAt: 0,
  });
}

/**
 * Turn off paid status.
 * IMPORTANT: This is called on every plugin start for users without a license key (see checkIsPaidUser).
 * DO NOT reset model settings here - it will cause free users to lose their model selections on every app restart.
 * Only update the entitlement flags.
 */
export function turnOffPaid(app?: App): void {
  const previousIsPaidUser = getSettings().isPaidUser;
  clearEntitlement();
  // The expiry modal needs `app`; interactive callers (load, settings, chat)
  // pass it. Rare background paths flip the flag without a modal — they surface
  // their own Notice instead.
  if (previousIsPaidUser && app) {
    new CopilotPlusExpiredModal(app).open();
  }
}

/**
 * Verify a signed entitlement token and, when valid, apply its claims to
 * settings: `isPaidUser` = tier is not free, `isPlusUser` = the `multi_agent`
 * capability is granted (tier >= Plus).
 *
 * Returns true when the token verified and was applied, false when it could NOT
 * be verified (bad signature, expired, unknown `kid`, or — during rollout — an
 * empty public-key set). An unverifiable token is NOT an authoritative "not
 * entitled" signal, so this never clears flags; the caller decides the fallback
 * (e.g. a license the server already confirmed valid stays paid). Only an
 * authoritative negative (invalid license / no key) downgrades, via turnOffPaid.
 */
export async function applyEntitlement(token: string): Promise<boolean> {
  const claims = await verifyEntitlement(token, { expectedUserId: getSettings().userId });
  if (!claims) {
    return false;
  }
  setSettings({
    entitlementToken: token,
    entitlementExpiresAt: claims.exp * 1000,
    isPaidUser: claims.tier !== "free",
    isPlusUser: claims.features.includes("multi_agent"),
  });
  return true;
}
