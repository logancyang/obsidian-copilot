import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { useTab } from "@/contexts/TabContext";
import { cn } from "@/lib/utils";
import { useIsSelfHostEligible } from "@/plusUtils";
import { updateSetting, useSettingsValue, type SelfHostSearchProvider } from "@/settings/model";
import { SelfHostWebSearchSettings } from "@/settings/v2/components/ui/SelfHostWebSearchSettings";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import React from "react";
import { t } from "@/i18n";

/** BYOK tab id in the settings tab strip (see SettingsMainV2 TAB_IDS). */
const BYOK_TAB_ID = "byok";

const SUPADATA_SIGNUP_URL = "https://supadata.ai/?ref=obcopilot";
const SEARCH_PROVIDER_KEY_FIELDS = {
  firecrawl: "firecrawlApiKey",
  perplexity: "perplexityApiKey",
  parallel: "parallelApiKey",
  exa: "exaApiKey",
} as const satisfies Record<SelfHostSearchProvider, keyof ReturnType<typeof useSettingsValue>>;

/** Small "Sign up ↗" affordance appended to a provider key description. */
const SignUpLink: React.FC<{ href: string }> = ({ href }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="tw-text-accent">
    {t("settings.actions.signUp")}{" "}
    <ArrowUpRight className="tw-inline tw-size-3 tw-align-text-bottom" />
  </a>
);

/**
 * Self-Host tab. The Enable toggle writes the persisted `enableSelfHostMode`
 * flag — the user-preference half of the gate that the cross-tab gating (Agents
 * / BYOK model enumeration, the agent spawn boundary) reads. The entitlement
 * half comes from the signed token's `self_host` feature, which also disables
 * the toggle for plans that don't grant it.
 *
 * The sub-sections below (web-search providers/keys, self-hosted endpoint) are
 * editable while Self-Host Mode is on and disabled while it's off — the ancestor
 * wrapper only dims/blocks the mouse, so each control carries its own
 * `disabled={!selfHostOn}` to also block keyboard editing when the mode is off.
 */
export const SelfHostSettings: React.FC = () => {
  const settings = useSettingsValue();
  const { setSelectedTab } = useTab();
  const isEligible = useIsSelfHostEligible();
  const selfHostOn = settings.enableSelfHostMode;

  return (
    <div className="tw-space-y-4">
      <div className="tw-flex tw-items-start tw-gap-2.5 tw-text-sm tw-text-muted">
        <span className="tw-max-w-[620px]">{t("settings.selfHost.intro")}</span>
        <span className="tw-shrink-0 tw-rounded tw-bg-callout-warning/20 tw-px-2 tw-py-0.5 tw-text-smallest tw-font-semibold tw-text-warning">
          {t("settings.selfHost.lifetimeLicense")}
        </span>
      </div>

      <SettingSection>
        <SettingItem
          type="switch"
          title={t("settings.selfHost.enable.title")}
          description={
            <span className="tw-inline-flex tw-items-center tw-gap-1.5">
              {t("settings.selfHost.enable.description")}
              <HelpTooltip content={t("settings.selfHost.enable.tooltip")} />
            </span>
          }
          checked={selfHostOn}
          onCheckedChange={(checked) => updateSetting("enableSelfHostMode", checked)}
          // Only an entitlement that grants self-host may flip this on; the
          // still-resolving `undefined` keeps it locked until the check settles.
          // Turning it OFF is always allowed — the preference is the user's to
          // withdraw, and gating that direction too would strand anyone whose
          // token stopped verifying with self-host stuck on and unreachable.
          disabled={isEligible !== true && !selfHostOn}
        />

        <div
          className={cn(
            "tw-flex tw-items-start tw-gap-2 tw-py-3 tw-text-xs tw-text-normal tw-bg-interactive-accent/10"
          )}
        >
          <ShieldCheck className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-accent" />
          <div className="tw-leading-relaxed">{t("settings.selfHost.privacyNotice")}</div>
        </div>
      </SettingSection>

      {/* Visual gate: dims the sub-sections while Self-Host Mode is off. Every
          row is independently disabled, so this wrapper is presentation; the
          cloud-egress marking of models/providers lives at the enumeration
          chokepoints keyed off the same persisted flag. */}
      <div className={cn("tw-space-y-4", !selfHostOn && "tw-pointer-events-none tw-opacity-40")}>
        <SettingSection label={t("settings.selfHost.webSearch.section")}>
          <SelfHostWebSearchSettings
            apiKeys={{
              firecrawl: settings.firecrawlApiKey,
              perplexity: settings.perplexityApiKey,
              parallel: settings.parallelApiKey,
              exa: settings.exaApiKey,
            }}
            disabled={!selfHostOn}
            provider={settings.selfHostSearchProvider}
            onProviderChange={(provider) => updateSetting("selfHostSearchProvider", provider)}
            onApiKeyChange={(provider, value) =>
              updateSetting(SEARCH_PROVIDER_KEY_FIELDS[provider], value)
            }
          />

          <SettingItem
            type="password"
            title="Supadata API Key"
            description={
              <span>
                {t("settings.selfHost.supadata.description")}{" "}
                <SignUpLink href={SUPADATA_SIGNUP_URL} />
              </span>
            }
            value={settings.supadataApiKey}
            onChange={(value) => updateSetting("supadataApiKey", value)}
            placeholder="sd-…"
            disabled={!selfHostOn}
          />
        </SettingSection>

        <SettingSection label={t("settings.selfHost.models.section")}>
          <SettingItem
            type="custom"
            title={t("settings.selfHost.models.title")}
            description={<span>{t("settings.selfHost.models.description")}</span>}
          >
            {/* Pure navigation, not a truth-source write. Still needs an explicit
                disabled: the wrapper's pointer-events-none doesn't block keyboard
                focus, so a gated nav button stays Tab-reachable without it. */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelectedTab(BYOK_TAB_ID)}
              disabled={!selfHostOn}
            >
              {t("settings.selfHost.models.openByok")}
            </Button>
          </SettingItem>
        </SettingSection>
      </div>
    </div>
  );
};
