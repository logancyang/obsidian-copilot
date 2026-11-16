import type { UsageWindow } from "@/agentMode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { PasswordInput } from "@/components/ui/password-input";
import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import type { LicenseState } from "@/plusUtils";
import { ExternalLink, Loader2 } from "lucide-react";
import React from "react";

export interface CopilotLicenseSectionProps {
  license: LicenseState;
  licenseKey: string;
  onLicenseKeyChange: (value: string) => void;
  isApplying: boolean;
  onApply: () => void;
  applyError: string | null;
  onSeePlans: () => void;
  usageWindows: readonly UsageWindow[] | null;
  onRemoveLicense: () => void;
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
}: CopilotLicenseSectionProps) {
  const status = isApplying ? "none" : license.status;

  return (
    <section className="copilot-license-surface tw-flex tw-flex-col tw-gap-3 tw-rounded-xl tw-border tw-border-solid tw-border-transparent tw-p-4 tw-shadow-[shadow:var(--shadow-s)]">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-2 tw-text-lg tw-font-semibold">
          <span className="tw-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary">
            <CopilotBrandIcon className="tw-size-5 tw-text-normal" />
          </span>
          Copilot license
        </div>
        <div className="tw-flex tw-items-center tw-gap-2">
          {status === "active" && (
            <Badge className="tw-rounded-full tw-bg-success tw-capitalize tw-text-success">
              {license.plan === LIFETIME_PLAN ? "Lifetime" : (license.plan ?? "Active")}
            </Badge>
          )}
          {status === "inactive" && (
            <Badge className="tw-rounded-full tw-bg-error tw-text-error">Inactive</Badge>
          )}
        </div>
      </div>

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

      {/* Once the key is active its field is gone, so the key cannot be revealed or copied back out. https://github.com/Brevilabs/obsidian-copilot-private/issues/923 */}
      {status === "active" ? (
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
          <Button variant="ghost" size="sm" className="tw-ml-auto" onClick={onRemoveLicense}>
            Remove license
          </Button>
        </div>
      ) : (
        <>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            <PasswordInput
              className="tw-flex-1 tw-basis-48"
              placeholder="Enter your license key"
              value={licenseKey}
              onChange={onLicenseKeyChange}
            />
            <div className="tw-flex tw-flex-wrap tw-gap-2">
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
              <Button variant="secondary" className="tw-text-xs md:tw-text-sm" onClick={onSeePlans}>
                See plans <ExternalLink className="tw-size-2 md:tw-size-4" />
              </Button>
            </div>
          </div>
          {applyError && <div className="tw-text-sm tw-text-error">{applyError}</div>}
        </>
      )}
    </section>
  );
}
