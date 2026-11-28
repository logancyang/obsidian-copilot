import type { BackendId } from "@/agentMode/session/types";
import type { AgentSelectRow, AgentSelectStatus } from "@/agentMode/ui/agentSelectModel";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, LoaderCircle, type LucideIcon } from "lucide-react";
import React from "react";

interface StatusBadgeSpec {
  label: string;
  variant: BadgeProps["variant"];
  Icon: LucideIcon;
}

const STATUS_BADGES: Partial<Record<AgentSelectStatus, StatusBadgeSpec>> = {
  checking: { label: "Checking…", variant: "secondary", Icon: LoaderCircle },
  installed: { label: "Installed", variant: "success", Icon: Check },
  outdated: { label: "Update required", variant: "destructive", Icon: AlertTriangle },
  "signed-out": { label: "Sign in required", variant: "secondary", Icon: AlertTriangle },
  error: { label: "Error", variant: "destructive", Icon: AlertTriangle },
};

interface AgentSelectViewProps {
  rows: readonly AgentSelectRow[];
  selectedId: BackendId;
  onSelect: (id: BackendId) => void;
  ctaLabel: string;
  footerNote: string | null;
  onCta: () => void;
  ctaDisabled?: boolean;
}

export const AgentSelectView: React.FC<AgentSelectViewProps> = ({
  rows,
  selectedId,
  onSelect,
  ctaLabel,
  footerNote,
  onCta,
  ctaDisabled = false,
}) => {
  const headingId = React.useId();
  const rowRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = rows.findIndex((row) => row.id === selectedId);
  const tabStopIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const selectAdjacent = (currentIndex: number, direction: 1 | -1) => {
    const nextIndex = (currentIndex + direction + rows.length) % rows.length;
    rowRefs.current[nextIndex]?.focus();
    onSelect(rows[nextIndex].id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        selectAdjacent(index, 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        selectAdjacent(index, -1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="tw-flex tw-w-full tw-flex-col tw-gap-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-3">
      <h3
        id={headingId}
        className="tw-m-0 tw-text-ui-medium tw-font-semibold tw-leading-tight tw-text-normal"
      >
        Select your agent
      </h3>

      <div role="radiogroup" aria-labelledby={headingId} className="tw-flex tw-flex-col tw-gap-1">
        {rows.map((row, index) => {
          const isSelected = row.id === selectedId;
          const status = STATUS_BADGES[row.status];
          return (
            <button
              key={row.id}
              ref={(node) => {
                rowRefs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={index === tabStopIndex ? 0 : -1}
              onClick={() => onSelect(row.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                "tw-flex tw-h-auto tw-w-full tw-cursor-pointer tw-items-start tw-gap-2 !tw-whitespace-normal !tw-rounded-md tw-border-none !tw-p-2 tw-text-left !tw-shadow-none tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring",
                isSelected
                  ? "!tw-bg-modifier-hover"
                  : "!tw-bg-transparent hover:!tw-bg-modifier-hover"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "tw-mt-0.5 tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid",
                  isSelected ? "tw-border-interactive-accent" : "tw-border-border"
                )}
              >
                {isSelected && (
                  <span className="tw-size-2 tw-rounded-full tw-bg-interactive-accent" />
                )}
              </span>

              <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-1">
                <span className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
                  <span className="tw-break-words tw-text-ui-small tw-font-semibold tw-text-normal">
                    {row.name}
                  </span>
                  {status && (
                    <Badge variant={status.variant} className="tw-gap-1">
                      <status.Icon
                        aria-hidden
                        className={cn("tw-size-3", row.status === "checking" && "tw-animate-spin")}
                      />
                      {status.label}
                    </Badge>
                  )}
                  {row.recommended && <Badge variant="accent">Recommended</Badge>}
                </span>
                <span className="tw-break-words tw-text-ui-smaller tw-text-muted">
                  {row.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "copilot-divider-t tw-flex tw-flex-col tw-gap-2 tw-pt-3",
          footerNote ? "tw-items-start" : "tw-items-end"
        )}
      >
        {footerNote && (
          <span className="tw-w-full tw-min-w-0 tw-select-text tw-whitespace-pre-wrap tw-text-ui-smaller tw-text-muted [overflow-wrap:anywhere]">
            {footerNote}
          </span>
        )}
        <Button size="sm" onClick={onCta} disabled={ctaDisabled} className="tw-shrink-0">
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
};
