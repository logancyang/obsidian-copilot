import { NEUTRAL_FACE_SRC } from "@/agents/customAgentFiles";
import { AgentFace } from "@/agents/ui/AgentFace";
import { Button } from "@/components/ui/button";
import { setSettings, useSettingsValue } from "@/settings/model";
import { X } from "lucide-react";
import React, { useEffect } from "react";

export interface FirstAgentBannerProps {
  onCreate: () => void;
  onDismiss: () => void;
}

export function useFirstAgentBannerVisible(agentCount: number): boolean {
  const dismissed = useSettingsValue().agentMode.firstAgentBannerDismissed === true;
  // Once the first agent exists, however it was made, deleting it later does not bring the banner back.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  useEffect(() => {
    if (agentCount > 0 && !dismissed) dismissFirstAgentBanner();
  }, [agentCount, dismissed]);
  return agentCount === 0 && !dismissed;
}

export function dismissFirstAgentBanner(): void {
  setSettings((cur) => ({ agentMode: { ...cur.agentMode, firstAgentBannerDismissed: true } }));
}

export function FirstAgentBanner({
  onCreate,
  onDismiss,
}: FirstAgentBannerProps): React.ReactElement {
  return (
    <div className="tw-relative tw-mt-3.5 tw-flex tw-items-start tw-gap-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-py-3 tw-pl-3 tw-pr-9">
      <div className="tw-flex tw-shrink-0 tw-pt-0.5" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <AgentFace
            key={index}
            src={NEUTRAL_FACE_SRC}
            size="m"
            className="tw-ring-2 tw-ring-[color:var(--background-primary)] [&:not(:first-child)]:-tw-ml-2.5"
          />
        ))}
      </div>
      <div className="tw-min-w-0 tw-flex-1">
        <div className="tw-text-ui-small tw-font-semibold tw-text-normal">
          Give each job its own agent
        </div>
        <div className="tw-mb-2.5 tw-mt-1 tw-text-ui-smaller tw-text-muted">
          An agent has its own instructions and remembers the rules you give it.
        </div>
        <Button size="sm" onClick={onCreate}>
          Create your first agent
        </Button>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="clickable-icon tw-absolute tw-right-1.5 tw-top-1.5 tw-size-6 tw-p-1"
      >
        <X className="tw-size-3.5" />
      </button>
    </div>
  );
}
