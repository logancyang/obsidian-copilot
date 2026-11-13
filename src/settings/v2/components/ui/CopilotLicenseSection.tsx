import type { UsageWindow } from "@/agentMode";
import { Badge } from "@/components/ui/badge";
import type { LicenseNotice } from "@/copilotAccount/copilotAccount";
import { signInFailureMessage } from "@/copilotAccount/signInMessages";
import {
  AccountControl,
  planName,
  type AccountControlProps,
} from "@/copilotAccount/ui/AccountControl";
import { Button } from "@/components/ui/button";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { DiscordLogo } from "@/components/ui/DiscordLogo";
import { COPILOT_DISCORD_INVITE_URL } from "@/constants";
import { PasswordInput } from "@/components/ui/password-input";
import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import { cn } from "@/lib/utils";
import type { LicenseState } from "@/plusUtils";
import { openLinkInSystemBrowser } from "@/utils/electronShell";
import { AlertCircle, Check, ExternalLink, Loader2, X } from "lucide-react";
import React from "react";

export interface CopilotLicenseSectionProps {
  license: LicenseState;
  licenseKey: string;
  onLicenseKeyChange: (value: string) => void;
  isApplying: boolean;
  onApply: () => void;
  applyError: string | null;
  onSeePlans: (win: Window) => void;
  usageWindows: readonly UsageWindow[] | null;
  onRemoveLicense: (() => void) | null;
  account: AccountControlProps | null;
  onDismissDiscordInvite: (() => void) | null;
}

const LIFETIME_PLAN = "believer";

interface ProductLinkProps {
  href: string;
  children: React.ReactNode;
}

function ProductLink({ href, children }: ProductLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="tw-font-semibold tw-text-accent"
    >
      {children}
    </a>
  );
}

interface FeatureProps {
  children: React.ReactNode;
}

function Feature({ children }: FeatureProps) {
  return <strong className="tw-font-semibold tw-text-normal">{children}</strong>;
}

interface LicenseNoticeLineProps {
  notice: LicenseNotice;
}

function LicenseNoticeLine({ notice }: LicenseNoticeLineProps) {
  const applied = notice.kind === "applied";
  const plan = notice.plan ? planName(notice.plan) : "paid";
  return (
    <div
      role="status"
      className={cn(
        "tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-px-2.5 tw-py-2 tw-text-sm tw-text-normal",
        applied ? "tw-bg-success" : "tw-bg-project-yellow"
      )}
    >
      {applied ? (
        <Check aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-success" />
      ) : (
        <AlertCircle aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-warning" />
      )}
      {applied
        ? `You're on ${plan}. Your license was applied from your account.`
        : `Your ${plan} plan has ended. You're still signed in, now on the free plan.`}
    </div>
  );
}

interface DiscordInviteProps {
  onDismiss: () => void;
}

function DiscordInvite({ onDismiss }: DiscordInviteProps) {
  return (
    <div className="tw-flex tw-items-center tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-border-discord/60 tw-bg-discord/20 tw-py-1.5 tw-pl-2 tw-pr-1.5">
      <span
        aria-hidden="true"
        className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-discord tw-text-white"
      >
        <DiscordLogo className="tw-size-4" />
      </span>
      <span className="tw-min-w-0 tw-flex-1 tw-text-sm tw-text-normal">
        You&apos;re invited to the Copilot Discord: help from the team and other users.
      </span>
      <a
        href={COPILOT_DISCORD_INVITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          openLinkInSystemBrowser(event);
          onDismiss();
        }}
        className="tw-flex tw-h-7 tw-shrink-0 tw-items-center tw-rounded-full tw-bg-discord tw-px-3 tw-text-ui-small tw-font-semibold tw-text-white tw-no-underline hover:tw-bg-discord/90 hover:tw-text-white"
      >
        Join Discord
      </a>
      <Button variant="ghost" size="icon" aria-label="Hide the Discord invite" onClick={onDismiss}>
        <X className="tw-size-3.5" />
      </Button>
    </div>
  );
}

export function CopilotLicenseSection({
  license,
  licenseKey,
  onLicenseKeyChange,
  isApplying,
  onApply,
  applyError,
  onSeePlans,
  usageWindows,
  onRemoveLicense,
  account,
  onDismissDiscordInvite,
}: CopilotLicenseSectionProps) {
  const status = isApplying ? "none" : license.status;
  // Once signed in, the account pill is the section's only plan label. https://github.com/Brevilabs/obsidian-copilot-private/issues/923
  const showsLicenseBadge = account?.state.status !== "signed-in";
  const signInFailure = account?.state.status === "signed-out" ? account.state.failure : null;
  const licenseNotice = account?.state.status === "signed-in" ? account.state.notice : null;

  return (
    <section className="copilot-license-surface tw-flex tw-flex-col tw-gap-3 tw-rounded-xl tw-border tw-border-solid tw-border-transparent tw-p-4 tw-shadow-[shadow:var(--shadow-s)]">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-2 tw-text-lg tw-font-semibold">
          <span className="tw-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary">
            <CopilotBrandIcon className="tw-size-5 tw-text-normal" />
          </span>
          Copilot license
        </div>
        <div className="tw-ml-auto tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
          {showsLicenseBadge && status === "active" && (
            <Badge className="tw-rounded-full tw-bg-success tw-capitalize tw-text-success">
              {license.plan === LIFETIME_PLAN ? "Lifetime" : (license.plan ?? "Active")}
            </Badge>
          )}
          {showsLicenseBadge && status === "inactive" && (
            <Badge className="tw-rounded-full tw-bg-error tw-text-error">Inactive</Badge>
          )}
          {account && <AccountControl {...account} />}
        </div>
      </div>

      {signInFailure && (
        <div role="alert" className="tw-text-sm tw-text-error">
          {signInFailureMessage(signInFailure)}
        </div>
      )}

      <div className="tw-text-sm tw-text-muted">
        <ProductLink href={createProductUrl(PRODUCT_URLS.COPILOT_PRICING, "settings")}>
          Copilot paid plans
        </ProductLink>{" "}
        add <Feature>premium chat models</Feature>, <Feature>advanced web search</Feature>,{" "}
        <Feature>multi-agent answers</Feature>, and{" "}
        <ProductLink href={createProductUrl(PRODUCT_URLS.OPENARTIFACTS, "license_settings")}>
          OpenArtifacts
        </ProductLink>{" "}
        doc sharing to your Copilot agentic experience. Pair it with{" "}
        <ProductLink href={createProductUrl(PRODUCT_URLS.MIYO, "license_settings")}>
          Miyo
        </ProductLink>{" "}
        and turn your vault into a centralized workspace for all your AI tools across devices.
      </div>

      {licenseNotice && <LicenseNoticeLine notice={licenseNotice} />}

      {/* Once the key is active its field is gone, so the key cannot be revealed or copied back out. https://github.com/Brevilabs/obsidian-copilot-private/issues/923 */}
      {status === "active" ? (
        // The account's license has no Remove license, so with no usage to show the row has nothing in it. https://github.com/Brevilabs/obsidian-copilot-private/issues/924
        (usageWindows || onRemoveLicense) && (
          <div className="tw-flex tw-items-center tw-gap-4 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-pt-3 tw-text-sm">
            {/* A failed or empty usage read shows no numbers rather than stale or empty ones. https://github.com/Brevilabs/obsidian-copilot-private/issues/923 */}
            {usageWindows && (
              <ul
                aria-label="Usage"
                className="tw-m-0 tw-flex tw-list-none tw-flex-wrap tw-items-center tw-gap-3 tw-p-0 tw-text-muted"
              >
                {usageWindows.map((window, index) => (
                  <React.Fragment key={window.id}>
                    {index > 0 && (
                      <li aria-hidden="true" className="tw-m-0">
                        ·
                      </li>
                    )}
                    <li className="tw-m-0 tw-flex tw-items-center tw-gap-1.5">
                      <span
                        aria-hidden="true"
                        className="tw-size-1.5 tw-rounded-full tw-bg-interactive-accent"
                      />
                      <span>
                        {window.label}{" "}
                        <strong className="tw-font-semibold tw-text-normal">
                          {Math.round(window.percent)}%
                        </strong>{" "}
                        used
                      </span>
                    </li>
                  </React.Fragment>
                ))}
              </ul>
            )}
            {onRemoveLicense && (
              <Button variant="ghost" size="sm" className="tw-ml-auto" onClick={onRemoveLicense}>
                Remove license
              </Button>
            )}
          </div>
        )
      ) : (
        <>
          <div className="tw-flex tw-items-center tw-gap-2">
            <PasswordInput
              className="tw-w-full"
              placeholder="Enter your license key"
              value={licenseKey}
              onChange={onLicenseKeyChange}
            />
            <Button
              variant="secondary"
              disabled={isApplying}
              onClick={onApply}
              className="tw-min-w-10 tw-text-xs md:tw-text-sm"
            >
              {isApplying ? (
                <Loader2 className="tw-size-2 tw-animate-spin md:tw-size-4" />
              ) : (
                "Apply"
              )}
            </Button>
            <Button
              variant="secondary"
              className="tw-text-xs md:tw-text-sm"
              onClick={(event) => onSeePlans(event.currentTarget.win)}
            >
              See plans <ExternalLink className="tw-size-2 md:tw-size-4" />
            </Button>
          </div>
          {applyError && <div className="tw-text-sm tw-text-error">{applyError}</div>}
        </>
      )}

      {/* Signing in earns the invite, and putting it away is for good. https://github.com/Brevilabs/obsidian-copilot-private/issues/925 */}
      {account?.state.status === "signed-in" && onDismissDiscordInvite && (
        <DiscordInvite onDismiss={onDismissDiscordInvite} />
      )}
    </section>
  );
}
