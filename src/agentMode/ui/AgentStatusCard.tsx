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
  message: string;
  tone?: AgentStatusTone;
  action?: AgentStatusAction;
}

/**
 * Presents compact Agent Mode status and recovery actions while leaving backend state decisions
 * to its parent.
 */
export const AgentStatusCard: React.FC<AgentStatusCardProps> = ({
  message,
  tone = "neutral",
  action,
}) => (
  <Card
    className={cn(
      "tw-flex tw-w-full tw-flex-wrap tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs tw-shadow-none",
      tone === "warning" && "tw-bg-callout-warning/20 tw-border-warning/40",
      tone === "error" && "tw-border-error/50"
    )}
    role={tone === "neutral" ? undefined : "alert"}
  >
    <span className="tw-flex tw-min-w-0 tw-flex-1 tw-items-start tw-gap-2">
      {tone === "warning" && (
        <AlertTriangle aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-warning" />
      )}
      {tone === "error" && (
        <AlertCircle aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-error" />
      )}
      <span className="tw-min-w-0 tw-break-words tw-text-normal">{message}</span>
    </span>
    {action &&
      ("href" in action ? (
        <Button
          asChild
          className="tw-h-auto tw-min-h-6 tw-max-w-full tw-whitespace-normal tw-break-words tw-py-1"
          variant="secondary"
          size="sm"
        >
          <a href={action.href} target="_blank" rel="noopener noreferrer">
            {action.label}
          </a>
        </Button>
      ) : (
        <Button
          className="tw-h-auto tw-min-h-6 tw-max-w-full tw-whitespace-normal tw-break-words tw-py-1 disabled:tw-opacity-100"
          variant={tone === "error" ? "ghost" : "secondary"}
          size="sm"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
  </Card>
);
