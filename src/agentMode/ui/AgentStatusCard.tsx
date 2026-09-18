import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle } from "lucide-react";
import React from "react";

type AgentStatusTone = "neutral" | "warning" | "error";

interface AgentStatusButtonAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  href?: never;
}

interface AgentStatusLinkAction {
  label: string;
  href: string;
  onClick?: never;
  disabled?: never;
}

type AgentStatusAction = AgentStatusButtonAction | AgentStatusLinkAction;

interface AgentStatusCardProps {
  /** Full recovery explanation, preserved verbatim for copying. */
  message: string;
  /** Concise state-specific heading; omitted for short statuses. */
  summary?: string;
  tone?: AgentStatusTone;
  action?: AgentStatusAction;
}

/** Narrowest message column worth keeping beside the action before it takes its own line. */
const MESSAGE_BASIS = "tw-basis-48";

/**
 * Presents compact Agent Mode status and recovery actions while leaving backend state decisions
 * to its parent.
 */
export const AgentStatusCard: React.FC<AgentStatusCardProps> = ({
  message,
  summary,
  tone = "neutral",
  action,
}) => {
  const icon =
    tone === "warning" ? (
      <AlertTriangle aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-warning" />
    ) : tone === "error" ? (
      <AlertCircle aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-error" />
    ) : null;

  return (
    <Card
      className={cn(
        "tw-flex tw-w-full tw-flex-col tw-items-start tw-gap-2 tw-rounded-md tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs tw-shadow-none",
        tone === "warning" && "tw-bg-callout-warning/20 tw-border-warning/40",
        tone === "error" && "tw-border-error/50"
      )}
      role={tone === "neutral" ? undefined : "alert"}
    >
      {summary && (
        <span className="tw-flex tw-w-full tw-min-w-0 tw-items-start tw-gap-2">
          {icon}
          <span className="tw-min-w-0 tw-select-text tw-break-words tw-font-medium tw-text-normal [overflow-wrap:anywhere]">
            {summary}
          </span>
        </span>
      )}
      {/* The action trails the message and takes its own line only once the message would be
          squeezed below {@link MESSAGE_BASIS}.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/480 */}
      <div className="tw-flex tw-w-full tw-flex-wrap tw-items-center tw-gap-2">
        {/* Error strings can contain recovery steps as well as diagnostics; keep them visible and exact.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/410 */}
        {summary ? (
          <p
            className={cn(
              "tw-m-0 tw-min-w-0 tw-grow tw-select-text tw-whitespace-pre-wrap tw-text-normal [overflow-wrap:anywhere]",
              MESSAGE_BASIS
            )}
          >
            {message}
          </p>
        ) : (
          <span
            className={cn("tw-flex tw-min-w-0 tw-grow tw-items-center tw-gap-2", MESSAGE_BASIS)}
          >
            {icon}
            <span className="tw-min-w-0 tw-select-text tw-break-words tw-text-normal [overflow-wrap:anywhere]">
              {message}
            </span>
          </span>
        )}
        {action &&
          ("href" in action ? (
            <Button
              asChild
              className="tw-ml-auto tw-h-auto tw-min-h-6 tw-max-w-full tw-shrink-0 tw-whitespace-normal tw-break-words tw-border tw-border-solid tw-border-border tw-py-1"
              variant="secondary"
              size="sm"
            >
              <a href={action.href} target="_blank" rel="noopener noreferrer">
                {action.label}
              </a>
            </Button>
          ) : (
            <Button
              className="tw-ml-auto tw-h-auto tw-min-h-6 tw-max-w-full tw-shrink-0 tw-whitespace-normal tw-break-words tw-border tw-border-solid tw-border-border tw-py-1 disabled:tw-opacity-100"
              variant={tone === "error" ? "ghost" : "secondary"}
              size="sm"
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
      </div>
    </Card>
  );
};
