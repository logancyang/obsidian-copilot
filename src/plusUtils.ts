import { setModelKey } from "@/aiParams";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import { ChatModelProviders, ChatModels } from "@/constants";
import { EntitlementFeature, verifyEntitlement } from "@/entitlement";
import { BrevilabsClient, LicenseCheckContext } from "@/LLMProviders/brevilabsClient";
import { createProductUrl, PRODUCT_URLS, ProductUtmMedium } from "@/lib/productLinks";
import { logError, logInfo, logWarn } from "@/logger";
import {
  CopilotSettings,
  getSettings,
  setSettings,
  subscribeToSettingsChange,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { App, Notice } from "obsidian";
import React from "react";

export const DEFAULT_COPILOT_PLUS_CHAT_MODEL = ChatModels.COPILOT_PLUS_FLASH;

export const ENTITLEMENT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isSelfHostModeValid(): boolean {
  return getSettings().enableSelfHostMode === true && hasVerifiedFeature("self_host");
}

let previewFailedThisSession = false;

export function isPreviewEnabled(): boolean {
  return (
    !previewFailedThisSession &&
    getSettings().previewEnabled === true &&
    hasVerifiedFeature("preview")
  );
}

export function disablePreviewForSession(): void {
  previewFailedThisSession = true;
}

function isPlusModel(modelKey: string): boolean {
  const settings = getSettings();
  const configuredModel = settings.configuredModels.find(
    (model) => model.configuredModelId === modelKey
  );
  if (configuredModel) {
    return settings.providers[configuredModel.providerId]?.origin.kind === "copilot-plus";
  }
  return modelKey.split("|")[1] === String(ChatModelProviders.COPILOT_PLUS);
}

const LICENSED_DEFAULT_WIRE_IDS: ReadonlySet<string> = Object.freeze(
  new Set([
    DEFAULT_COPILOT_PLUS_CHAT_MODEL as string,
    `${ChatModelProviders.COPILOT_PLUS}/${DEFAULT_COPILOT_PLUS_CHAT_MODEL}`,
  ])
);

export function isUsingLicensedModels(settings: CopilotSettings): boolean {
  if (isPlusModel(settings.defaultModelKey)) return true;
  return Object.values(settings.agentMode?.backends ?? {}).some((backend) => {
    const baseModelId = backend?.defaultModel?.baseModelId;
    return baseModelId !== undefined && LICENSED_DEFAULT_WIRE_IDS.has(baseModelId);
  });
}

function isEntitlementExpired(settings: CopilotSettings): boolean {
  return settings.entitlementExpiresAt > 0 && Date.now() >= settings.entitlementExpiresAt;
}

interface VerifiedEntitlement {
  token: string;
  /**
   * The license key this entitlement was issued for. Without it, a different key that gets
   * anything short of an authoritative refusal (offline, 5xx) would inherit the old plan.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/307
   */
  licenseKey: string;
  features: ReadonlySet<EntitlementFeature>;
  plan: string;
  expiresAt: number;
  paid: boolean;
}

const NO_VERIFIED_ENTITLEMENT: VerifiedEntitlement = Object.freeze({
  token: "",
  licenseKey: "",
  features: Object.freeze(new Set<EntitlementFeature>()),
  plan: "",
  expiresAt: 0,
  paid: false,
});

let verified: VerifiedEntitlement = NO_VERIFIED_ENTITLEMENT;

function hasLiveEntitlement(): boolean {
  const settings = getSettings();
  return (
    verified.token === settings.entitlementToken &&
    verified.licenseKey === settings.plusLicenseKey &&
    Date.now() < verified.expiresAt
  );
}

function hasVerifiedFeature(feature: EntitlementFeature): boolean {
  return hasLiveEntitlement() && verified.features.has(feature);
}

export function isPlusEnabled(): boolean {
  const settings = getSettings();
  if (settings.entitlementExpiresAt > 0) {
    return hasVerifiedFeature("multi_agent");
  }
  return settings.isPlusUser === true;
}

export function useIsPaidUser(): boolean | undefined {
  return useSettingsValue().isPaidUser;
}

function useIsPlusUser(): boolean | undefined {
  const settings = useSettingsValue();
  if (isEntitlementExpired(settings)) {
    return false;
  }
  return settings.isPlusUser;
}

export async function ensureMultiAgentEntitlement(app?: App): Promise<boolean> {
  if (isPlusEnabled()) {
    return true;
  }
  await BrevilabsClient.getInstance().validateLicenseKey(app, {
    trigger: "multi_agent_per_turn",
  });
  return isPlusEnabled();
}

export function showMultiAgentUpgradePrompt(): void {
  new Notice(
    "Multi-agent QA (@-mentioning more than one agent in a turn) is a Copilot Plus feature. Opening the upgrade page…",
    8000
  );
  navigateToPlusPage("multi_agent");
}

export function useCanUseMultiAgent(): boolean {
  return useIsPlusUser() === true;
}

export async function checkIsPaidUser(
  app: App | undefined,
  context: LicenseCheckContext
): Promise<boolean | undefined> {
  if (!getSettings().plusLicenseKey) {
    turnOffPaid(app);
    return false;
  }
  const brevilabsClient = BrevilabsClient.getInstance();
  const result = await brevilabsClient.validateLicenseKey(app, context).catch((error) => {
    logInfo("License validation unreachable; falling back to the cached entitlement:", error);
    return { isValid: undefined };
  });
  return result.isValid ?? (hasLiveEntitlement() && verified.paid);
}

export type LicenseStatus = "none" | "active" | "inactive";

export interface LicenseState {
  status: LicenseStatus;
  plan?: string;
}

const NO_LICENSE: LicenseState = Object.freeze({ status: "none" });
const INACTIVE_LICENSE: LicenseState = Object.freeze({ status: "inactive" });
const UNNAMED_ACTIVE_LICENSE: LicenseState = Object.freeze({ status: "active" });

export function useLicenseState(): LicenseState {
  const settings = useSettingsValue();
  const namedActive = React.useRef<LicenseState | null>(null);
  if (!settings.plusLicenseKey) {
    return NO_LICENSE;
  }
  if (hasLiveEntitlement()) {
    if (!verified.paid) {
      return INACTIVE_LICENSE;
    }
    if (namedActive.current?.plan !== verified.plan) {
      namedActive.current = { status: "active", plan: verified.plan };
    }
    return namedActive.current;
  }
  return settings.isPaidUser === true && !isEntitlementExpired(settings)
    ? UNNAMED_ACTIVE_LICENSE
    : INACTIVE_LICENSE;
}

export function useIsPreviewAvailable(): boolean {
  useSettingsValue();
  return hasVerifiedFeature("preview");
}

export function useIsPreviewEnabled(): boolean {
  useSettingsValue();
  return isPreviewEnabled();
}

export function useIsSelfHostEligible(): boolean | undefined {
  const settings = useSettingsValue();
  const [isEligible, setIsEligible] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    void verifyEntitlement(settings.entitlementToken, {
      expectedUserId: settings.userId,
    }).then((claims) => {
      if (cancelled) {
        return;
      }
      const eligible = claims?.features.includes("self_host") === true;
      if (claims && !eligible && settings.enableSelfHostMode) {
        updateSetting("enableSelfHostMode", false);
      }
      setIsEligible(eligible);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.entitlementToken, settings.userId, settings.enableSelfHostMode]);

  return isEligible;
}

const CONFIGURED_MODEL_WAIT_MS = 15_000;

function findLicensedChatModelId(settings: CopilotSettings): string | undefined {
  const plusProviderIds = new Set(
    Object.values(settings.providers)
      .filter((provider) => provider.origin.kind === "copilot-plus")
      .map((provider) => provider.providerId)
  );
  return settings.configuredModels.find(
    (model) =>
      plusProviderIds.has(model.providerId) &&
      model.info.id === (DEFAULT_COPILOT_PLUS_CHAT_MODEL as string)
  )?.configuredModelId;
}

function waitForLicensedChatModelId(): Promise<string | undefined> {
  const present = findLicensedChatModelId(getSettings());
  if (present) return Promise.resolve(present);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (id: string | undefined): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(id);
    };
    const unsubscribe = subscribeToSettingsChange((_prev, next) => {
      const id = findLicensedChatModelId(next);
      if (id) settle(id);
    });
    const timer = window.setTimeout(() => settle(undefined), CONFIGURED_MODEL_WAIT_MS);
    const raced = findLicensedChatModelId(getSettings());
    if (raced) settle(raced);
  });
}

export async function applyLicenseSettings(): Promise<void> {
  const configuredModelId = await waitForLicensedChatModelId();
  if (!configuredModelId) {
    logWarn(
      `applyLicenseSettings: ${DEFAULT_COPILOT_PLUS_CHAT_MODEL} was never configured, nothing to apply`
    );
    new Notice(
      "Copilot could not set a default model. Pick one under Settings → Basic → Agents once your license is active."
    );
    return;
  }

  setModelKey(configuredModelId);
  setSettings({ defaultModelKey: configuredModelId });

  if (!isDesktopRuntime()) return;
  try {
    const { applyCopilotDefaultModel } = await import("@/agentMode");
    const seeded = applyCopilotDefaultModel(configuredModelId);
    logInfo("applyLicenseSettings: seeded the agent default model", { backends: seeded });
  } catch (error) {
    logError("applyLicenseSettings: seeding the agent default model failed", error);
  }
}

export function navigateToPlusPage(medium: ProductUtmMedium): void {
  window.open(createProductUrl(PRODUCT_URLS.COPILOT_PRICING, medium), "_blank");
}

export function markPaidPendingEntitlement(): void {
  setSettings({
    isPaidUser: true,
    isPlusUser: false,
    entitlementToken: "",
    entitlementExpiresAt: 0,
  });
}

function clearEntitlement(): void {
  setSettings({
    isPaidUser: false,
    isPlusUser: false,
    entitlementToken: "",
    entitlementExpiresAt: 0,
  });
}

export function turnOffPaid(app?: App): void {
  const previousIsPaidUser = getSettings().isPaidUser;
  clearEntitlement();
  if (previousIsPaidUser && app) {
    new CopilotPlusExpiredModal(app).open();
  }
}

export async function applyEntitlement(token: string): Promise<boolean> {
  const { userId, plusLicenseKey } = getSettings();
  const claims = await verifyEntitlement(token, { expectedUserId: userId });
  if (!claims) {
    return false;
  }
  verified = {
    token,
    licenseKey: plusLicenseKey,
    features: new Set(claims.features),
    plan: claims.plan,
    expiresAt: claims.exp * 1000,
    paid: claims.tier !== "free",
  };
  setSettings({
    entitlementToken: token,
    entitlementExpiresAt: verified.expiresAt,
    isPaidUser: verified.paid,
    isPlusUser: verified.features.has("multi_agent"),
  });
  return true;
}

export async function verifyCachedEntitlement(): Promise<void> {
  const { entitlementToken, userId, plusLicenseKey } = getSettings();
  const claims = entitlementToken
    ? await verifyEntitlement(entitlementToken, { expectedUserId: userId })
    : null;
  if (getSettings().entitlementToken !== entitlementToken) {
    return;
  }
  verified = {
    token: entitlementToken,
    licenseKey: plusLicenseKey,
    features: new Set(claims?.features),
    plan: claims?.plan ?? "",
    expiresAt: (claims?.exp ?? 0) * 1000,
    paid: claims ? claims.tier !== "free" : false,
  };
}
