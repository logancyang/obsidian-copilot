import {
  ensureEntitlement,
  hasVerifiedFeature,
  isEntitlementExpired,
  navigateToPlusPage,
} from "@/plusUtils";
import { getSettings, useSettingsValue } from "@/settings/model";
import { App, Notice } from "obsidian";

export function isMultiAgentEnabled(): boolean {
  const settings = getSettings();
  if (settings.entitlementExpiresAt > 0) {
    return hasVerifiedFeature("multi_agent");
  }
  return settings.isPlusUser === true;
}

export function useCanUseMultiAgent(): boolean {
  const settings = useSettingsValue();
  return !isEntitlementExpired(settings) && settings.isPlusUser === true;
}

export function ensureMultiAgentEntitlement(app?: App): Promise<boolean> {
  return ensureEntitlement(app, "multi_agent", isMultiAgentEnabled);
}

export function showMultiAgentUpgradePrompt(): void {
  new Notice(
    "Multi-agent answers (@-mentioning more than one agent in a message) are a Copilot Plus feature. Opening the upgrade page…",
    8000
  );
  navigateToPlusPage("multi_agent");
}
