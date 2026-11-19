import { joinNames } from "@/agents/agentReply";
import { isLicenseLapsed } from "@/agents/customAgentsGate";
import { type CustomAgent, customAgentsFolderPath } from "@/agents/CustomAgentStore";
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

export function lockedAgentsTitle(count: number, lapsed: boolean): string {
  return lapsed ? "Your agents are still here" : `This vault has ${countOf(count, "custom agent")}`;
}

export interface LockedAgentsUpsellContentProps {
  agents: readonly LockedAgent[];
  lapsed: boolean;
  onClose: () => void;
}

export function LockedAgentsUpsellContent({
  agents,
  lapsed,
  onClose,
}: LockedAgentsUpsellContentProps): React.ReactElement {
  const one = agents.length === 1;
  const plans = (medium: "custom_agent_renew" | "custom_agent_synced") => () => {
    navigateToPlusPage(medium);
    onClose();
  };
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
      {lapsed ? (
        <>
          <p className="tw-m-0">
            {`${joinNames(agents.map((agent) => agent.name))} still ${one ? "has" : "have"} their instructions and memory. Your Supporter plan ended, so you can read past chats but can't start new ones.`}
          </p>
          <p className="tw-m-0">{`Renew to talk to ${one ? agents[0].name : "them"} again.`}</p>
        </>
      ) : (
        <>
          <p className="tw-m-0">
            {`${one ? `${agents[0].name} was` : "They were"} set up with a Supporter license on another device. To talk to ${one ? agents[0].name : "them"} here, enter your license key on this device too.`}
          </p>
          <p className="tw-m-0">
            {one ? `${agents[0].name}'s` : "Their"} files in <code>{customAgentsFolderPath()}</code>{" "}
            stay as they are.
          </p>
        </>
      )}
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        {lapsed ? (
          <>
            <EnterLicenseKeyButton onOpenSettings={onClose}>
              Enter license key
            </EnterLicenseKeyButton>
            <Button onClick={plans("custom_agent_renew")}>
              Renew <ExternalLink className="tw-size-4" />
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={plans("custom_agent_synced")}>
              See plans <ExternalLink className="tw-size-4" />
            </Button>
            <EnterLicenseKeyButton primary onOpenSettings={onClose}>
              Enter license key
            </EnterLicenseKeyButton>
          </>
        )}
      </div>
    </div>
  );
}

export class LockedAgentsUpsellModal extends ReactModal {
  private readonly lapsed = isLicenseLapsed();

  constructor(
    app: App,
    private readonly agents: readonly LockedAgent[]
  ) {
    super(app);
    this.titleEl.setText(lockedAgentsTitle(agents.length, this.lapsed));
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <LockedAgentsUpsellContent agents={this.agents} lapsed={this.lapsed} onClose={close} />;
  }
}
