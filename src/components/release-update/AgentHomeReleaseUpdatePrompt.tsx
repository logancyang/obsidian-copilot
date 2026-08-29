import { Button } from "@/components/ui/button";
import { ArrowUpCircle, XIcon } from "lucide-react";
import * as React from "react";

export interface AgentHomeReleaseUpdatePromptProps {
  onDismiss: () => void;
  onOpen: () => void;
  version: string;
}

/** Presents the selected release update treatment inside the empty Agent Home. */
export function AgentHomeReleaseUpdatePrompt({
  onDismiss,
  onOpen,
  version,
}: AgentHomeReleaseUpdatePromptProps): React.ReactElement {
  return (
    <section
      aria-label={`Copilot ${version} update available`}
      className="copilot-divider-t tw-absolute tw-inset-x-0 tw-bottom-0 tw-z-popover tw-bg-secondary tw-p-4 tw-text-normal tw-shadow-lg"
      data-agent-home-release-update="bottom-banner"
      role="status"
    >
      <Button
        aria-label="Dismiss release update"
        className="tw-absolute tw-right-2 tw-top-2"
        onClick={onDismiss}
        size="icon"
        type="button"
        variant="ghost2"
      >
        <XIcon aria-hidden="true" className="tw-size-4" />
      </Button>
      <div className="tw-flex tw-items-start tw-gap-3 tw-pr-7">
        <span className="tw-flex tw-size-8 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-interactive-accent tw-text-on-accent">
          <ArrowUpCircle aria-hidden="true" className="tw-size-4" />
        </span>
        <div className="tw-min-w-0">
          <div className="tw-text-ui-medium tw-font-semibold">Copilot {version} is ready</div>
          <p className="tw-mb-0 tw-mt-1 tw-text-ui-smaller tw-text-muted">
            Review what changed before updating Copilot in this vault.
          </p>
        </div>
      </div>
      <Button className="tw-mt-3 tw-w-full" onClick={onOpen} size="sm" type="button">
        See what’s new
      </Button>
    </section>
  );
}
