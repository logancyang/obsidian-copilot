import type { TurnFileChange } from "@/agentMode/session/types";
import { FileChangeCounts, FileChangeStatusBadge } from "@/agentMode/ui/FileChangeSummary";
import type { ChangeStep } from "@/agentMode/ui/renderedDiff/ChangeScroller";
import { Button } from "@/components/ui/button";
import { openLinkClickProps, type OpenPane } from "@/utils/openVaultPath";
import { ChevronDown, ChevronUp } from "lucide-react";
import React from "react";

export interface ChangeStepperProps {
  current: number;
  total: number;
  onStep: (direction: ChangeStep) => void;
}

export interface TurnDiffHeaderProps {
  path: string;
  status: TurnFileChange["status"];
  additions: number;
  deletions: number;
  changes?: ChangeStepperProps;
  onOpenNote?: (pane: OpenPane) => void;
}

export const TurnDiffHeader: React.FC<TurnDiffHeaderProps> = ({
  path,
  status,
  additions,
  deletions,
  changes,
  onOpenNote,
}) => (
  <div className="copilot-divider-b tw-px-[var(--file-margins)] tw-py-2">
    <div className="tw-mx-auto tw-flex tw-max-w-[var(--file-line-width)] tw-items-center tw-gap-2">
      <span title={path} className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-text-muted">
        {path}
      </span>
      <FileChangeStatusBadge status={status} />
      <FileChangeCounts additions={additions} deletions={deletions} />
      {changes && changes.total > 0 ? <ChangeStepper {...changes} /> : null}
      {onOpenNote ? (
        <Button
          variant="link"
          size="sm"
          className="tw-ml-2 !tw-h-auto tw-shrink-0 !tw-border-0 !tw-bg-transparent !tw-px-0 !tw-text-accent !tw-shadow-none"
          {...openLinkClickProps(onOpenNote)}
        >
          Open note
        </Button>
      ) : null}
    </div>
  </div>
);

const ChangeStepper: React.FC<ChangeStepperProps> = ({ current, total, onStep }) => (
  <span className="tw-ml-1 tw-flex tw-shrink-0 tw-items-center">
    <Button variant="ghost2" size="icon" aria-label="Previous change" onClick={() => onStep(-1)}>
      <ChevronUp className="tw-size-4" />
    </Button>
    <span className="tw-min-w-[6ch] tw-text-center tw-text-xs tw-tabular-nums tw-text-muted">
      {current + 1} of {total}
    </span>
    <Button variant="ghost2" size="icon" aria-label="Next change" onClick={() => onStep(1)}>
      <ChevronDown className="tw-size-4" />
    </Button>
  </span>
);
