import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import { cn } from "@/lib/utils";
import React, { useState } from "react";

export interface ConnectorLogoProps {
  service: ConnectorCatalogEntry;
  className?: string;
}

export function ConnectorLogo({ service, className }: ConnectorLogoProps): React.ReactElement {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string>();
  const logoUrl = service.logoUrl === failedLogoUrl ? undefined : service.logoUrl;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "tw-flex tw-size-8 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md",
        logoUrl
          ? "tw-bg-white [.theme-dark_&]:tw-border [.theme-dark_&]:tw-border-solid [.theme-dark_&]:tw-border-border"
          : "tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-text-ui-small tw-font-semibold tw-text-normal",
        className
      )}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className="tw-size-5 tw-object-contain"
          // A logo that can't load (offline, blocked, gone from the CDN) shows the letter tile instead: https://github.com/Brevilabs/obsidian-copilot-private/issues/855
          onError={() => setFailedLogoUrl(logoUrl)}
        />
      ) : (
        service.name.charAt(0).toUpperCase()
      )}
    </div>
  );
}
