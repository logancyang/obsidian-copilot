import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import React from "react";

/** How long "Copied" stays up before the button reverts to its resting label. */
const COPIED_LABEL_MS = 1400;

interface CommandBlockProps {
  /** Shell command shown after the prompt and copied verbatim. */
  command: string;
  /** Extra control rendered after Copy, for an in-app equivalent of the command. */
  action?: React.ReactNode;
}

/**
 * One shell command the user is meant to run, as a copyable block rather than
 * prose — the command is the instruction, so it carries the affordance to take
 * it. Confirmation lives in the button's own label instead of a notice, so the
 * feedback stays where the user is looking.
 */
export const CommandBlock: React.FC<CommandBlockProps> = ({ command, action }) => {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

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
      {/* Obsidian styles bare `code` with its own background and padding, which
          would draw a second block inside this one. */}
      <code className="tw-min-w-0 tw-flex-1 tw-break-all tw-bg-transparent tw-px-0 tw-py-0.5 tw-text-xs tw-leading-5">
        <span className="tw-select-none tw-text-faint">$ </span>
        {command}
      </code>
      <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1">
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
        {action}
      </div>
    </div>
  );
};

interface SetupStepProps {
  /** Position in the sequence, shown in the circle. */
  index: number;
  title: string;
  children: React.ReactNode;
}

/**
 * One numbered step of a short, ordered setup sequence. Exists so the several
 * dialogs that demote "you don't have this yet" to a secondary block all count
 * their steps the same way.
 */
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
