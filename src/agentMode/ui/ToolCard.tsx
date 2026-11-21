import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import React, { useId } from "react";

export interface ToolCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  state?: "running" | "failed";
  quote?: string | null;
  outcome?: string | null;
  detail?: string | null;
  notice?: React.ReactNode;
  open: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}

export const toolCardRowClass =
  "tw-flex tw-w-full tw-items-baseline tw-justify-start tw-gap-2 tw-px-2 tw-py-1 tw-pl-8 tw-text-sm";

export const ToolCard: React.FC<ToolCardProps> = ({
  icon: Icon,
  label,
  state,
  quote,
  outcome,
  detail,
  notice,
  open,
  onToggle,
  children,
}) => {
  const bodyId = useId();
  return (
    <div
      className={cn(
        "tw-my-1 tw-w-full tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-bg-secondary tw-text-sm",
        state === "failed" ? "tw-border-border" : "tw-border-interactive-accent/40"
      )}
    >
      <div
        className={cn(
          "tw-flex tw-w-full tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-1 tw-px-2 tw-py-1.5",
          onToggle && "tw-cursor-pointer hover:tw-bg-modifier-hover"
        )}
        role={onToggle ? "button" : undefined}
        tabIndex={onToggle ? 0 : undefined}
        aria-expanded={onToggle ? open : undefined}
        aria-controls={onToggle ? bodyId : undefined}
        onClick={onToggle}
        onKeyDown={
          onToggle
            ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onToggle();
              }
            : undefined
        }
      >
        <Icon className="tw-size-4 tw-shrink-0 tw-text-normal" />
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-baseline tw-gap-1.5 tw-overflow-hidden">
          <span
            className={cn(
              "tw-shrink-0 tw-font-medium",
              state === "running"
                ? "copilot-shimmer-text motion-reduce:tw-animate-none"
                : state === "failed"
                  ? "tw-text-error"
                  : "tw-text-normal"
            )}
          >
            {label}
          </span>
          {quote ? <span className="tw-min-w-0 tw-truncate tw-text-muted">“{quote}”</span> : null}
        </div>
        {outcome ? <span className="tw-shrink-0 tw-text-xs tw-text-muted">{outcome}</span> : null}
        {onToggle ? (
          <ChevronRight
            className={cn(
              "tw-size-3 tw-shrink-0 tw-text-muted tw-transition-transform",
              open && "tw-rotate-90"
            )}
          />
        ) : null}
        {detail ? (
          <div className="tw-line-clamp-2 tw-basis-full tw-pl-6 tw-text-xs tw-text-muted">
            {detail}
          </div>
        ) : null}
      </div>
      {notice}
      {onToggle && open ? (
        <div id={bodyId} className="copilot-divider-t">
          {children}
        </div>
      ) : null}
    </div>
  );
};

export const ToolCardRowButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = (
  props
) => (
  <button
    type="button"
    {...props}
    className={cn(
      toolCardRowClass,
      "tw-h-auto tw-cursor-pointer !tw-rounded-none tw-border-none !tw-bg-transparent tw-text-left tw-text-normal !tw-shadow-none hover:!tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
    )}
  />
);
