/**
 * SuggestedEditCard - the in-thread card shown when the assistant has proposed
 * an edit. Offers "Review changes" (opens the inline diff widget) or shows the
 * accepted/rejected state.
 */

import React from "react";
import { Check, Eye, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SuggestedEdit } from "@/comments/types";

interface SuggestedEditCardProps {
  edit: SuggestedEdit;
  disabled?: boolean;
  onReview: () => void;
}

export function SuggestedEditCard(props: SuggestedEditCardProps) {
  const { edit, disabled, onReview } = props;
  const { status, proposedText } = edit;

  return (
    <div
      className={cn(
        "tw-flex tw-flex-col tw-gap-1 tw-rounded-md tw-border tw-border-border",
        "tw-bg-secondary-alt tw-px-2 tw-py-1.5 tw-text-sm"
      )}
    >
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <span className="tw-text-xs tw-font-medium tw-text-muted">Suggested edit</span>
        {status === "accepted" && (
          <span className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-success">
            <Check className="tw-size-3" /> Accepted
          </span>
        )}
        {status === "rejected" && (
          <span className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-error">
            <XIcon className="tw-size-3" /> Rejected
          </span>
        )}
      </div>
      <div className="tw-whitespace-pre-wrap tw-rounded tw-bg-primary tw-px-2 tw-py-1 tw-text-xs">
        {proposedText}
      </div>
      {status === "pending" && (
        <div className="tw-flex tw-justify-end">
          <Button size="sm" onClick={onReview} disabled={disabled} title="Review changes inline">
            <Eye className="tw-size-3" /> Review changes
          </Button>
        </div>
      )}
    </div>
  );
}
