import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import React, { memo } from "react";

interface AgentDataNoticeCardProps {
  backendName: string;
  modelName: string | null;
  destination: string;
  onContinue: () => void;
  onCancel: () => void;
}

// Shown once, before the first Agent send, so users know where their context goes.
// https://github.com/logancyang/obsidian-copilot/issues/2889
export const AgentDataNoticeCard = memo(
  ({
    backendName,
    modelName,
    destination,
    onContinue,
    onCancel,
  }: AgentDataNoticeCardProps): React.ReactElement => (
    <div className="tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-3">
      <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-ui-small tw-font-semibold tw-text-normal">
        <ShieldCheck className="tw-size-4 tw-shrink-0 tw-text-accent" />
        <span>Where your Agent context goes</span>
      </div>

      <dl className="tw-m-0 tw-grid tw-grid-cols-[auto_1fr] tw-gap-x-3 tw-gap-y-1 tw-text-ui-smaller">
        <dt className="tw-text-muted">Agent</dt>
        <dd className="tw-m-0 tw-text-normal">{backendName}</dd>
        <dt className="tw-text-muted">Model</dt>
        <dd className="tw-m-0 tw-text-normal">{modelName ?? "The agent's default"}</dd>
        <dt className="tw-text-muted">Sent to</dt>
        <dd className="tw-m-0 tw-break-words tw-text-normal">{destination}</dd>
      </dl>

      <div className="tw-text-ui-smaller tw-text-muted">
        <p className="tw-m-0">Each message may send:</p>
        <ul className="tw-my-1 tw-pl-5">
          <li>Your message</li>
          <li>Notes and files you attach or the agent reads</li>
          <li>Tool results</li>
          <li>The conversation so far</li>
        </ul>
        <p className="tw-m-0">
          Agents you @mention get the same context. Nothing is sent until you select Continue.
        </p>
      </div>

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" size="sm" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  )
);

AgentDataNoticeCard.displayName = "AgentDataNoticeCard";
