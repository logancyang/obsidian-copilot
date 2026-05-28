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
 * Skills show up in the tab automatically when they live inside the
 * canonical folder or any registered agent's project skills folder
 * (`.claude/skills/`, `.agents/skills/`, `.opencode/skills/`). Discovery
 * runs on open, so the user never has to trigger it by hand.
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
      <div className="tw-max-w-[420px] tw-text-center tw-text-ui-smaller tw-text-faint">
        Skills you create or save into your shared folder show up here. Skills under{" "}
        <code>.claude/skills/</code>, <code>.agents/skills/</code>, or{" "}
        <code>.opencode/skills/</code> show up here automatically too.
      </div>
      <div className="tw-mt-3.5 tw-font-mono tw-text-smallest tw-text-faint">
        shared home · <code>&lt;vault&gt;/{folder}/</code>
      </div>
    </div>
  );
};
