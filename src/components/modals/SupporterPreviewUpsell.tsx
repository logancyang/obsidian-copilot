import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import type { ProductUtmMedium } from "@/lib/productLinks";
import { navigateToPlusPage } from "@/plusUtils";
import { openCopilotSettings } from "@/settings/openSettings";
import { ExternalLink } from "lucide-react";
import * as React from "react";

interface EnterLicenseKeyButtonProps {
  onOpenSettings?: () => void;
  primary?: boolean;
  children?: React.ReactNode;
}

export function EnterLicenseKeyButton({
  onOpenSettings,
  primary,
  children = "Already a Supporter? Enter your license key",
}: EnterLicenseKeyButtonProps): React.ReactElement {
  const app = useApp();
  return (
    <Button
      variant={primary ? "default" : "secondary"}
      className="tw-h-auto tw-min-h-9 tw-whitespace-normal"
      onClick={(event) => {
        const ownerWindow = event.currentTarget.win;
        onOpenSettings?.();
        openCopilotSettings(app, ownerWindow, "basic");
      }}
    >
      {children}
    </Button>
  );
}

export interface SupporterPreviewUpsellProps {
  description: string;
  points: readonly string[];
  media?: React.ReactNode;
  medium: ProductUtmMedium;
  onClose: () => void;
}

export function SupporterPreviewUpsell({
  description,
  points,
  media,
  medium,
  onClose,
}: SupporterPreviewUpsellProps): React.ReactElement {
  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-text-sm">
      <p className="tw-m-0">{description}</p>
      <ul className="tw-m-0 tw-flex tw-flex-col tw-gap-1 tw-pl-5">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {media}
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <EnterLicenseKeyButton onOpenSettings={onClose} />
        <Button
          onClick={() => {
            navigateToPlusPage(medium);
            onClose();
          }}
        >
          See plans <ExternalLink className="tw-size-4" />
        </Button>
      </div>
    </div>
  );
}
