import { joinNames } from "@/agents/agentReply";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import { countOf } from "@/agents/ui/AgentProfileView";
import { ReactModal } from "@/components/modals/ReactModal";
import { EnterLicenseKeyButton } from "@/components/modals/SupporterPreviewUpsell";
import { Button } from "@/components/ui/button";
import { navigateToPlusPage } from "@/plusUtils";
import { ExternalLink } from "lucide-react";
import type { App } from "obsidian";
import React from "react";

export type LockedAgent = Pick<CustomAgent, "slug" | "name" | "faceSrc">;

export interface LockedAgentsUpsellContentProps {
  agents: readonly LockedAgent[];
  onClose: () => void;
}

export function LockedAgentsUpsellContent({
  agents,
  onClose,
}: LockedAgentsUpsellContentProps): React.ReactElement {
  const one = agents.length === 1;
  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-text-sm">
      <div className="tw-flex tw-flex-wrap tw-justify-center tw-gap-3.5">
        {agents.map((agent) => (
          <span
            key={agent.slug}
            className="tw-flex tw-w-12 tw-flex-col tw-items-center tw-gap-1 tw-text-ui-smaller tw-text-muted"
          >
            <AgentFace src={agent.faceSrc} size="l" />
            <span className="tw-max-w-full tw-truncate">{agent.name}</span>
          </span>
        ))}
      </div>
      <p className="tw-m-0">
        {`${joinNames(agents.map((agent) => agent.name))} ${one ? "keeps its" : "keep their"} instructions and memory. You need a valid Supporter license to activate ${one ? "it" : "them"} again.`}
      </p>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            navigateToPlusPage("custom_agent_synced");
            onClose();
          }}
        >
          See plans <ExternalLink className="tw-size-4" />
        </Button>
        <EnterLicenseKeyButton primary onOpenSettings={onClose}>
          Enter license key
        </EnterLicenseKeyButton>
      </div>
    </div>
  );
}

export class LockedAgentsUpsellModal extends ReactModal {
  constructor(
    app: App,
    private readonly agents: readonly LockedAgent[]
  ) {
    super(app);
    this.titleEl.setText(`This vault has ${countOf(agents.length, "teammate")}`);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <LockedAgentsUpsellContent agents={this.agents} onClose={close} />;
  }
}
