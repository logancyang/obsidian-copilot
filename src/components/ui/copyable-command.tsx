import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { Notice } from "obsidian";
import React from "react";

interface CopyableCommandProps {
  command: string;
  label: string;
}

export const CopyableCommand: React.FC<CopyableCommandProps> = ({ command, label }) => {
  const { isCopied, copy } = useCopyToClipboard();
  const handleCopy = React.useCallback(
    async (ownerWindow: Window): Promise<void> => {
      if (!(await copy(command, ownerWindow))) {
        new Notice("Failed to copy command to clipboard.");
      }
    },
    [command, copy]
  );

  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      <span className="tw-text-xs tw-text-muted">{label}</span>
      <div className="tw-flex tw-items-center tw-gap-2">
        <code className="tw-flex-1 tw-break-all tw-rounded tw-bg-secondary tw-p-2 tw-text-xs">
          {command}
        </code>
        <Button
          variant="ghost"
          size="default"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={(event) => void handleCopy(event.currentTarget.win)}
        >
          {isCopied ? "Copied" : "Copy"}
        </Button>
        <span className="tw-sr-only" aria-live="polite">
          {isCopied ? `${label} copied` : ""}
        </span>
      </div>
    </div>
  );
};
