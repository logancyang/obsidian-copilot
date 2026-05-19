import { cn } from "@/lib/utils";
import { LayoutGrid } from "lucide-react";
import React from "react";

interface EmptyPlaceholderProps {
  /**
   * The currently configured skills folder, vault-relative. Rendered in
   * the hint line so the user can verify exactly where Copilot is looking.
   */
  folder: string;
}

/**
 * The empty state for the Skills tab — shown when discovery returns zero
 * managed skills. Mirrors §A of `Skills Tab Flows.html`.
 *
 * There is no "New skill" CTA on purpose; users hand-author skills or import
 * them via the consent card.
 */
export const EmptyPlaceholder: React.FC<EmptyPlaceholderProps> = ({ folder }) => {
  return (
    <div
      className={cn(
        "tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-2",
        "tw-min-h-[320px] tw-rounded-md tw-border tw-border-dashed tw-border-border",
        "tw-p-12 tw-text-faint"
      )}
    >
      <div
        className={cn(
          "tw-flex tw-items-center tw-justify-center",
          "tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-3"
        )}
      >
        <LayoutGrid className="tw-size-6 tw-text-faint" aria-hidden="true" />
      </div>
      <div className="tw-text-smaller tw-font-medium tw-text-muted">No skills yet</div>
      <div className="tw-max-w-[380px] tw-text-center tw-text-ui-smaller tw-text-faint">
        Skills you create or import will show up here.
      </div>
      <div className="tw-mt-3.5 tw-font-mono tw-text-smallest tw-text-faint">
        canonical home · <code>&lt;vault&gt;/{folder}/</code>
      </div>
    </div>
  );
};
