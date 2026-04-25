/**
 * InlineDiffCard - the React component rendered inline (as a CM6 widget) in
 * place of a comment's highlighted passage when a suggested edit is being
 * reviewed.
 *
 * Compact word-diff with Accept / Reject buttons. Reuses `buildDiffRows` +
 * `DiffCell` from the shared `diffRendering` module.
 */

import React, { useMemo } from "react";
import { Check, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildDiffRows, DiffCell } from "@/components/composer/diffRendering";
import { diffArrays } from "diff";
import { cn } from "@/lib/utils";

export interface InlineDiffCallbacks {
  onAccept: () => void;
  onReject: () => void;
}

interface InlineDiffCardProps {
  commentId: string;
  originalText: string;
  proposedText: string;
  callbacks: InlineDiffCallbacks;
}

export function InlineDiffCard(props: InlineDiffCardProps) {
  const { originalText, proposedText, callbacks } = props;

  const rows = useMemo(() => {
    const tokenize = (str: string): string[] => str.split(/(\s+)/).filter(Boolean);
    const changes = diffArrays(tokenize(originalText), tokenize(proposedText)).map((c) => ({
      ...c,
      value: c.value.join(""),
    }));
    // `buildDiffRows` expects single-string `value` on each Change; the
    // library returns string[] but our tokenized variant collapses back.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return buildDiffRows(changes as any);
  }, [originalText, proposedText]);

  return (
    <span
      className={cn(
        "tw-inline-flex tw-flex-col tw-gap-1 tw-rounded tw-border tw-border-border",
        "tw-bg-primary tw-px-2 tw-py-1.5 tw-align-baseline tw-shadow-sm"
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="tw-flex tw-flex-col tw-gap-0.5 tw-text-sm tw-font-normal">
        {rows.map((row, idx) => (
          <div key={idx} className="tw-grid tw-grid-cols-2 tw-gap-2">
            <div className="tw-whitespace-pre-wrap tw-text-xs">
              <DiffCell row={row} side="original" />
            </div>
            <div className="tw-whitespace-pre-wrap tw-text-xs">
              <DiffCell row={row} side="modified" />
            </div>
          </div>
        ))}
      </div>
      <div className="tw-flex tw-justify-end tw-gap-1">
        <Button size="sm" variant="success" onClick={callbacks.onAccept} title="Accept">
          <Check className="tw-size-3" />
          Accept
        </Button>
        <Button size="sm" variant="destructive" onClick={callbacks.onReject} title="Reject">
          <XIcon className="tw-size-3" />
          Reject
        </Button>
      </div>
    </span>
  );
}
