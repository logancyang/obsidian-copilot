import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import { Notice } from "obsidian";
import React from "react";

interface Props {
  /** Shell command to display and copy. */
  command: string;
  /** Label above the command block. Defaults to "Install command". */
  label?: string;
}

/**
 * A copy-able shell command block (install instructions) with a Copy button.
 * Shared by the Claude and Codex Configure dialogs.
 */
export const InstallCommandRow: React.FC<Props> = ({ command, label = "Install command" }) => {
  const copy = React.useCallback((): void => {
    navigator.clipboard.writeText(command).catch((e) => {
      logError("[AgentMode] copy install command failed", e);
    });
    new Notice("Copied to clipboard.");
  }, [command]);

  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      <span className="tw-text-xs tw-text-muted">{label}</span>
      <div className="tw-flex tw-items-center tw-gap-2">
        <code className="tw-flex-1 tw-break-all tw-rounded tw-bg-secondary tw-p-2 tw-text-xs">
          {command}
        </code>
        <Button variant="ghost" size="default" onClick={copy}>
          Copy
        </Button>
      </div>
    </div>
  );
};
