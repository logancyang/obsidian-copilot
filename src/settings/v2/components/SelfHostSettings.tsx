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

const BYOK_TAB_ID = "byok";

const SUPADATA_SIGNUP_URL = "https://supadata.ai/?ref=obcopilot";
const SEARCH_PROVIDER_KEY_FIELDS = {
  firecrawl: "firecrawlApiKey",
  perplexity: "perplexityApiKey",
  parallel: "parallelApiKey",
  exa: "exaApiKey",
} as const satisfies Record<SelfHostSearchProvider, keyof ReturnType<typeof useSettingsValue>>;

const SignUpLink: React.FC<{ href: string }> = ({ href }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="tw-text-accent">
    Sign up <ArrowUpRight className="tw-inline tw-size-3 tw-align-text-bottom" />
  </a>
);

export const SelfHostSettings: React.FC = () => {
  const settings = useSettingsValue();
  const { setSelectedTab } = useTab();
  const isEligible = useIsSelfHostEligible();
  const selfHostOn = settings.enableSelfHostMode;

  return (
    <div className="tw-space-y-4">
      <div className="tw-flex tw-items-start tw-gap-2.5 tw-text-sm tw-text-muted">
        <span className="tw-max-w-[620px]">
          Bring your own infrastructure — self-hosted search, web-search providers, and models.
        </span>
        <span className="tw-shrink-0 tw-rounded tw-bg-callout-warning/20 tw-px-2 tw-py-0.5 tw-text-smallest tw-font-semibold tw-text-warning">
          Lifetime license
        </span>
      </div>

      <SettingSection>
        <SettingItem
          type="switch"
          title="Enable Self-Host Mode"
          description={
            <span className="tw-inline-flex tw-items-center tw-gap-1.5">
              Route LLMs, embeddings and document understanding through your own endpoints.
              <HelpTooltip content="Believer / Supporter only. Use your own infrastructure for full control and offline use. Stays available offline until your entitlement expires." />
            </span>
          }
          checked={selfHostOn}
          onCheckedChange={(checked) => updateSetting("enableSelfHostMode", checked)}
          disabled={isEligible !== true && !selfHostOn}
        />

        <div
          className={cn(
            "tw-flex tw-items-start tw-gap-2 tw-py-3 tw-text-xs tw-text-normal tw-bg-interactive-accent/10"
          )}
        >
          <ShieldCheck className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-accent" />
          <div className="tw-leading-relaxed">
            <span className="tw-font-semibold">Privacy-first.</span> While Self-Host is on, cloud
            options (Claude, Codex, and BYOK cloud providers) are flagged with a warning and sorted
            below your local / self-hosted models. They stay selectable — you decide whether to use
            them.
          </div>
        </div>
      </SettingSection>

      <div className={cn("tw-space-y-4", !selfHostOn && "tw-pointer-events-none tw-opacity-40")}>
        <SettingSection label="Web search providers">
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
                YouTube transcripts via Supadata. <SignUpLink href={SUPADATA_SIGNUP_URL} />
              </span>
            }
            value={settings.supadataApiKey}
            onChange={(value) => updateSetting("supadataApiKey", value)}
            placeholder="sd-…"
            disabled={!selfHostOn}
          />
        </SettingSection>

        <SettingSection label="Self-hosted models">
          <SettingItem
            type="custom"
            title="LLM & embedding models"
            description={
              <span>Add local / self-hosted models as an OpenAI-compatible endpoint in BYOK.</span>
            }
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelectedTab(BYOK_TAB_ID)}
              disabled={!selfHostOn}
            >
              Open BYOK
            </Button>
          </SettingItem>
        </SettingSection>
      </div>
    </div>
  );
};
