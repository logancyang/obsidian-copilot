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
      {containsMarkdown && (
        <div
          className={cn(
            "tw-flex tw-items-start tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-warning/40",
            "tw-bg-secondary tw-px-3 tw-py-2.5 tw-text-sm tw-text-normal"
          )}
          role="alert"
        >
          <AlertTriangle
            className={cn("tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning")}
            aria-hidden="true"
          />
          <span>
            <strong>Markdown files in this folder will be excluded from Copilot search.</strong>{" "}
            This includes regular notes. The exclusion is permanent, even if you change the Copilot
            folder later.
          </span>
        </div>
      )}
      <dl className={cn("tw-m-0 tw-flex tw-min-w-0 tw-flex-col tw-gap-3 tw-text-sm")}>
        <div>
          <dt className={cn("tw-font-medium tw-text-normal")}>New Copilot folder</dt>
          <dd className={cn("tw-m-0 [overflow-wrap:anywhere]")}>
            <code className={cn("tw-whitespace-pre-wrap")}>{newRoot}/</code>
          </dd>
        </div>
        <div>
          <dt className={cn("tw-font-medium tw-text-normal")}>Existing data</dt>
          <dd className={cn("tw-m-0 [overflow-wrap:anywhere]")}>
            <code className={cn("tw-whitespace-pre-wrap")}>{oldRoot}/</code>
          </dd>
        </div>
      </dl>
      <p className={cn("tw-m-0 tw-text-sm tw-text-muted")}>
        <strong className={cn("tw-text-normal")}>Files are not moved automatically.</strong> New
        chats and data will use the new folder. You can move existing files yourself; Obsidian
        updates the links.
      </p>
      <p className={cn("tw-m-0 tw-text-sm tw-text-muted")}>
        The existing data folder stays permanently excluded from Copilot search.
      </p>
    </div>
  );
};
