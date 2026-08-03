import { CopilotPlusWelcomeModal } from "@/components/modals/CopilotPlusWelcomeModal";
import { useApp } from "@/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { MIYO_HOMEPAGE_URL, PLUS_UTM_MEDIUMS } from "@/constants";
import { checkIsPaidUser, createPlusPageUrl, navigateToPlusPage, useIsPaidUser } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { ExternalLink, Loader2 } from "lucide-react";
import React, { useState } from "react";

/**
 * B3 placeholder: mock Plus usage data until the real API is available.
 * LicenseResponse currently only has {is_valid, plan}; usage percentages
 * will come from a future endpoint.
 */
function getPlusUsageMock(): { currentPct: number; weeklyPct: number } | null {
  return null;
}

export function PlusSettings() {
  const app = useApp();
  const settings = useSettingsValue();
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const isPaidUser = useIsPaidUser();
  const [localLicenseKey, setLocalLicenseKey] = useState(settings.plusLicenseKey);
  const usageData = getPlusUsageMock();

  return (
    <section className="tw-flex tw-flex-col tw-gap-4 tw-rounded-xl tw-border tw-border-solid tw-p-4 tw-shadow-sm tw-bg-interactive-accent/10 tw-border-interactive-accent/40">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-text-lg tw-font-semibold">
        <span>Copilot License</span>
        {isPaidUser && (
          <Badge className="tw-rounded-full tw-bg-success tw-text-success">Active</Badge>
        )}
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2 tw-text-sm tw-text-muted">
        <div>
          <a
            href={createPlusPageUrl(PLUS_UTM_MEDIUMS.SETTINGS)}
            target="_blank"
            rel="noopener noreferrer"
            className="tw-font-semibold tw-text-accent"
          >
            Copilot paid plans
          </a>{" "}
          add <strong className="tw-font-semibold tw-text-normal">premium chat models</strong>,{" "}
          <strong className="tw-font-semibold tw-text-normal">document understanding</strong>,{" "}
          <strong className="tw-font-semibold tw-text-normal">advanced web search</strong>, and{" "}
          <strong className="tw-font-semibold tw-text-normal">multi-agent capabilities</strong> to
          your Copilot agentic experience. Pair it with{" "}
          <a
            href={MIYO_HOMEPAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="tw-font-semibold tw-text-accent"
          >
            Miyo
          </a>{" "}
          and turn your vault into a centralized workspace for all your AI tools across devices.
        </div>
      </div>

      {/* Free-user value + upsell. Gated on `isPaidUser === false` (not
          `!isPaidUser`): the flag is `boolean | undefined`, defaulting to false
          and staying on a cached value through network errors, so `=== false`
          avoids flashing this block while the paid status is still resolving. */}
      {isPaidUser === false && (
        <div className="tw-flex tw-flex-col tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-bg-primary tw-p-3 tw-border-interactive-accent/30">
          <div className="tw-text-sm tw-text-normal">All of it for a few dollars a month.</div>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            <Button
              className="tw-text-xs md:tw-text-sm"
              onClick={() => navigateToPlusPage(PLUS_UTM_MEDIUMS.SETTINGS)}
            >
              See plans <ExternalLink className="tw-size-2 md:tw-size-4" />
            </Button>
            <a
              href={MIYO_HOMEPAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="tw-inline-flex tw-items-center tw-gap-0.5 tw-text-sm tw-text-accent"
            >
              New: pair Copilot with Miyo <ExternalLink className="tw-size-3.5" />
            </a>
          </div>
        </div>
      )}

      <div className="tw-flex tw-items-center tw-gap-2">
        <PasswordInput
          className="tw-w-full"
          placeholder="Enter your license key"
          value={localLicenseKey}
          onChange={(value) => {
            setLocalLicenseKey(value);
          }}
        />
        <Button
          disabled={isChecking}
          onClick={async () => {
            updateSetting("plusLicenseKey", localLicenseKey);
            setIsChecking(true);
            const result = await checkIsPaidUser(app);
            setIsChecking(false);
            if (!result) {
              setError("Invalid license key");
            } else {
              setError(null);
              new CopilotPlusWelcomeModal(app).open();
            }
          }}
          className="tw-min-w-10 tw-text-xs md:tw-text-sm"
        >
          {isChecking ? <Loader2 className="tw-size-2 tw-animate-spin md:tw-size-4" /> : "Apply"}
        </Button>
      </div>
      {error && <div className="tw-text-error">{error}</div>}

      {/* Usage line: hidden until the B3 usage API lands. `getPlusUsageMock`
          returns null today, so the whole footer stays out of the UI rather than
          showing an empty "—" and a dead Dashboard button; once the real endpoint
          returns data, the footer appears automatically with no further wiring. */}
      {isPaidUser && usageData && (
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4 tw-border-t tw-border-border tw-pt-4 tw-text-sm">
          <div className="tw-flex tw-items-center tw-gap-3 tw-text-muted">
            <span className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-text-accent">●</span>
              <span>
                Current 5h <strong className="tw-font-semibold">{usageData.currentPct}%</strong>{" "}
                used
              </span>
            </span>
            <span className="tw-text-faint">·</span>
            <span className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-text-accent">●</span>
              <span>
                Weekly <strong className="tw-font-semibold">{usageData.weeklyPct}%</strong> used
              </span>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="tw-gap-1 tw-text-sm tw-text-accent hover:tw-text-accent-hover"
            onClick={() => {
              window.open("https://obsidiancopilot.com/dashboard", "_blank");
            }}
          >
            Dashboard <ExternalLink className="tw-size-3.5" />
          </Button>
        </div>
      )}
    </section>
  );
}
