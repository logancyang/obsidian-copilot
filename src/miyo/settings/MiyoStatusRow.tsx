import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type CapabilityStatus } from "@/miyo/miyoStatusStore";
import { ArrowUpRight } from "lucide-react";
import React from "react";

const STATUS_TEXT_CLASS: Record<CapabilityStatus, string> = {
  available: "tw-text-success",
  unavailable: "tw-text-warning",
  unknown: "tw-text-faint",
  stale: "tw-text-faint",
  syncing: "tw-text-muted",
};

const STATUS_DOT_CLASS: Record<CapabilityStatus, string> = {
  available: "tw-bg-success",
  unavailable: "tw-bg-warning/80",
  unknown: "tw-bg-faint/40",
  stale: "tw-bg-faint/40",
  syncing: "tw-bg-interactive-accent tw-animate-pulse",
};

export interface MiyoStatusRowProps {
  title: React.ReactNode;
  description: React.ReactNode;
  status: CapabilityStatus;
  statusText: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  remoteInstruction?: string;
  disabled?: boolean;
}

export const MiyoStatusRow: React.FC<MiyoStatusRowProps> = ({
  title,
  description,
  status,
  statusText,
  actionLabel,
  onAction,
  remoteInstruction,
  disabled = false,
}) => (
  <div className="tw-flex tw-flex-col tw-items-start tw-justify-between tw-gap-4 tw-py-4 sm:tw-flex-row sm:tw-items-start">
    <div className="tw-w-full tw-space-y-1.5 sm:tw-w-[320px]">
      <div className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-medium tw-leading-none">
        {title}
      </div>
      <div className="tw-text-xs tw-text-muted">{description}</div>
      <div
        className={cn(
          "tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-font-medium",
          STATUS_TEXT_CLASS[status]
        )}
      >
        <span className={cn("tw-size-1.5 tw-shrink-0 tw-rounded-full", STATUS_DOT_CLASS[status])} />
        {statusText}
      </div>
    </div>
    <div className="tw-flex tw-w-full tw-flex-1 tw-items-center tw-gap-2 sm:tw-justify-end">
      {remoteInstruction ? (
        <span className="tw-text-xs tw-text-muted">{remoteInstruction}</span>
      ) : (
        <Button variant="secondary" size="sm" onClick={onAction} disabled={disabled}>
          {actionLabel} <ArrowUpRight className="tw-size-3.5" />
        </Button>
      )}
    </div>
  </div>
);
