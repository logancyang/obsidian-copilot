import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { useTab } from "@/contexts/TabContext";
import { cn } from "@/lib/utils";
import { useIsSelfHostEligible } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import React from "react";

/** BYOK tab id in the settings tab strip (see SettingsMainV2 TAB_IDS). */
const BYOK_TAB_ID = "byok";

const FIRECRAWL_SIGNUP_URL = "https://firecrawl.link/logan-yang";
const SUPADATA_SIGNUP_URL = "https://supadata.ai/?ref=obcopilot";
const PERPLEXITY_API_KEY_URL = "https://docs.perplexity.ai";

/** Small "Sign up ↗" affordance appended to a provider key description. */
const SignUpLink: React.FC<{ href: string }> = ({ href }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="tw-text-accent">
    Sign up <ArrowUpRight className="tw-inline tw-size-3 tw-align-text-bottom" />
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
          <div className="tw-leading-relaxed">
            <span className="tw-font-semibold">Privacy-first.</span> While Self-Host is on, cloud
            options (Claude, Codex, and BYOK cloud providers) are flagged with a warning and sorted
            below your local / self-hosted models. They stay selectable — you decide whether to use
            them.
          </div>
        </div>
      </SettingSection>

      {/* Visual gate: dims the sub-sections while Self-Host Mode is off. Every
          row is independently disabled, so this wrapper is presentation; the
          cloud-egress marking of models/providers lives at the enumeration
          chokepoints keyed off the same persisted flag. */}
      <div className={cn("tw-space-y-4", !selfHostOn && "tw-pointer-events-none tw-opacity-40")}>
        <SettingSection label="Web search providers">
          <SettingItem
            type="select"
            title="Web Search Provider"
            description="Your key turns this into an agent skill parameter."
            value={settings.selfHostSearchProvider}
            onChange={(value) =>
              updateSetting("selfHostSearchProvider", value as "firecrawl" | "perplexity")
            }
            options={[
              { label: "Firecrawl", value: "firecrawl" },
              { label: "Perplexity Sonar", value: "perplexity" },
            ]}
            disabled={!selfHostOn}
          />

          {settings.selfHostSearchProvider === "firecrawl" && (
            <SettingItem
              type="password"
              title="Firecrawl API Key"
              description={
                <span>
                  Web search &amp; fetch via Firecrawl. <SignUpLink href={FIRECRAWL_SIGNUP_URL} />
                </span>
              }
              value={settings.firecrawlApiKey}
              onChange={(value) => updateSetting("firecrawlApiKey", value)}
              placeholder="fc-…"
              disabled={!selfHostOn}
            />
          )}

          {settings.selfHostSearchProvider === "perplexity" && (
            <SettingItem
              type="password"
              title="Perplexity API Key"
              description={
                <span>
                  Web search via Perplexity Sonar. <SignUpLink href={PERPLEXITY_API_KEY_URL} />
                </span>
              }
              value={settings.perplexityApiKey}
              onChange={(value) => updateSetting("perplexityApiKey", value)}
              placeholder="pplx-…"
              disabled={!selfHostOn}
            />
          )}

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
            {/* Pure navigation, not a truth-source write. Still needs an explicit
                disabled: the wrapper's pointer-events-none doesn't block keyboard
                focus, so a gated nav button stays Tab-reachable without it. */}
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
