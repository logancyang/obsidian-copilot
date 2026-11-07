import { CONNECTOR_CATALOG, type ConnectorCatalogEntry } from "@/connectors/catalog";
import { ConnectorLogo } from "@/connectors/ui/ConnectorLogo";
import { NO_OBSIDIAN_TOOLTIP, TextButton } from "@/connectors/ui/ConnectorRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExternalLink, Lock } from "lucide-react";
import React, { useState } from "react";

const PREVIEW_SERVICE_IDS = ["notion", "linear", "atlassian", "todoist", "granola", "readwise"];

const PREVIEW_SERVICES: readonly ConnectorCatalogEntry[] = PREVIEW_SERVICE_IDS.flatMap((id) =>
  CONNECTOR_CATALOG.filter((service) => service.id === id)
);

export interface ConnectorsUpsellProps {
  onEnterLicenseKey: () => void;
  onSeePlans: () => void;
}

export function ConnectorsUpsell({
  onEnterLicenseKey,
  onSeePlans,
}: ConnectorsUpsellProps): React.ReactElement {
  const [showAll, setShowAll] = useState(false);
  const services = showAll ? CONNECTOR_CATALOG : PREVIEW_SERVICES;
  return (
    <div className="tw-flex tw-flex-col tw-gap-5">
      <section className="tw-flex tw-flex-col tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-interactive-accent tw-bg-primary tw-p-5 tw-text-sm">
        <div
          role="heading"
          aria-level={2}
          className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-text-lg tw-font-semibold"
        >
          <span className="tw-rounded-full tw-border tw-border-solid tw-border-interactive-accent tw-px-2 tw-text-ui-smaller tw-font-semibold tw-tracking-wide tw-text-accent">
            PREVIEW
          </span>
          Connectors is a preview for Supporters
        </div>
        <p className="tw-m-0">
          Connect Notion, Linear, Jira, Todoist and dozens more once, and every agent can read and
          update them from your chats.
        </p>
        <ul className="tw-m-0 tw-flex tw-flex-col tw-gap-1 tw-pl-5">
          <li>Log in on the service&apos;s own page. No config files, no terminal.</li>
          <li>Works with Claude, Codex and OpenCode.</li>
          <li>See which connectors need you, and fix them in one click.</li>
        </ul>
        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2 tw-pt-1">
          <Button
            variant="secondary"
            className="tw-h-auto tw-min-h-9 tw-whitespace-normal"
            onClick={onEnterLicenseKey}
          >
            Already a Supporter? Enter your license key
          </Button>
          <Button onClick={onSeePlans}>
            See plans <ExternalLink className="tw-size-4" />
          </Button>
        </div>
      </section>
      <section className="tw-flex tw-flex-col tw-gap-3 tw-@container/upsell-services">
        <div role="heading" aria-level={3} className="tw-text-sm tw-font-semibold tw-text-muted">
          {CONNECTOR_CATALOG.length} connectors available
        </div>
        <ul
          className={cn(
            "tw-m-0 tw-grid tw-list-none tw-grid-cols-1 tw-gap-2 tw-p-0 @md/upsell-services:tw-grid-cols-2",
            NO_OBSIDIAN_TOOLTIP
          )}
        >
          {services.map((service) => (
            <li
              key={service.id}
              aria-label={service.name}
              className="tw-flex tw-items-center tw-gap-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-3 tw-py-2"
            >
              <ConnectorLogo service={service} />
              <div className="tw-min-w-0 tw-flex-1">
                <div className="tw-truncate tw-text-ui-small tw-font-semibold">{service.name}</div>
                <div className="tw-truncate tw-text-ui-smaller tw-text-muted">
                  {service.description}
                </div>
              </div>
              <Lock aria-hidden="true" className="tw-size-3.5 tw-shrink-0 tw-text-faint" />
            </li>
          ))}
        </ul>
        {!showAll && (
          <TextButton className="tw-self-start" onClick={() => setShowAll(true)}>
            See all {CONNECTOR_CATALOG.length} connectors
          </TextButton>
        )}
      </section>
    </div>
  );
}
