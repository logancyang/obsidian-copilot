import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import React from "react";

const COPIED_LABEL_MS = 1400;

export type CommandShell = "posix" | "powershell";

interface CommandBlockProps {
  command: string;
  shell?: CommandShell;
}

export const CommandBlock: React.FC<CommandBlockProps> = ({ command, shell }) => {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);
  const prompt =
    (shell ?? (process.platform === "win32" ? "powershell" : "posix")) === "powershell"
      ? "PS> "
      : "$ ";

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const copy = React.useCallback((): void => {
    navigator.clipboard.writeText(command).catch((e) => {
      logError("[AgentMode] copy setup command failed", e);
    });
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), COPIED_LABEL_MS);
  }, [command]);

  return (
    <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-bg-secondary tw-p-2">
      <code className="tw-min-w-0 tw-flex-1 tw-break-all tw-bg-transparent tw-px-0 tw-py-0.5 tw-text-xs tw-leading-5">
        <span className="tw-select-none tw-text-faint">{prompt}</span>
        {command}
      </code>
      <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1">
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
};

interface SetupStepProps {
  index: number;
  title: string;
  children: React.ReactNode;
}

export const SetupStep: React.FC<SetupStepProps> = ({ index, title, children }) => (
  <div className="tw-flex tw-items-start tw-gap-3">
    <span className="tw-flex tw-size-5 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-modifier-hover tw-text-xs tw-font-medium tw-leading-5 tw-text-normal">
      {index}
    </span>
    <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-2">
      <div className="tw-text-sm tw-font-medium tw-leading-5">{title}</div>
      {children}
    </div>
  </div>
);
