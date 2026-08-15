import { cn } from "@/lib/utils";
import { AlertTriangle, FolderSync } from "lucide-react";
import React from "react";

export interface CopilotFolderChangeNoticeProps {
  /** Current Copilot root that remains excluded after the change. */
  oldRoot: string;
  /** Candidate Copilot root where future data will be stored. */
  newRoot: string;
  /** Whether the candidate already contains Markdown files. */
  containsMarkdown: boolean;
}

/**
 * Explains the lasting search exclusions before a Copilot folder change is committed.
 */
export const CopilotFolderChangeNotice: React.FC<CopilotFolderChangeNoticeProps> = ({
  oldRoot,
  newRoot,
  containsMarkdown,
}) => {
  return (
    <div className={cn("tw-flex tw-flex-col tw-gap-4")}>
      <div className={cn("tw-flex tw-items-center tw-gap-3 tw-text-normal")}>
        <FolderSync className={cn("tw-size-6 tw-shrink-0 tw-text-accent")} aria-hidden="true" />
        <h2 className={cn("tw-m-0 tw-text-xl tw-font-bold")}>Change Copilot folder</h2>
      </div>
      <p className={cn("tw-m-0 tw-text-muted")}>
        Copilot will keep new chats and data under <code>{newRoot}/</code>. Your files aren&apos;t
        moved — your old data stays in <strong className={cn("tw-text-normal")}>{oldRoot}/</strong>,
        which stays permanently excluded from Copilot search. Move it over if you want; Obsidian
        updates the links.
      </p>
      {containsMarkdown && (
        <div
          className={cn(
            "tw-flex tw-items-start tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-warning/40",
            "tw-bg-secondary tw-px-3 tw-py-2.5 tw-text-xs tw-text-normal"
          )}
          role="alert"
        >
          <AlertTriangle
            className={cn("tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning")}
            aria-hidden="true"
          />
          <span>
            <strong>This folder already contains Markdown files.</strong> If you continue, every
            Markdown file under <code>{newRoot}/</code> — including regular notes — will be excluded
            from Copilot search. The folder stays excluded even if you change the Copilot folder
            later.
          </span>
        </div>
      )}
    </div>
  );
};
