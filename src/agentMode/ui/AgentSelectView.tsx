import type { BackendId } from "@/agentMode/session/types";
import type { AgentSelectRow, AgentSelectStatus } from "@/agentMode/ui/agentSelectModel";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, type LucideIcon } from "lucide-react";
import React from "react";

interface StatusBadgeSpec {
  label: string;
  variant: BadgeProps["variant"];
  Icon: LucideIcon;
}

/**
 * Status vocabulary shown beside an agent's name. `absent` is deliberately
 * absent from this map: the design communicates "not set up" through the
 * footer note and the Configure call to action, not a badge on the row.
 *
 * `error` is not drawn in the design. It reuses the `outdated` treatment and
 * says only "Error" — the row's `statusMessage` already reaches the user
 * through the footer note whenever that row is selected, so repeating the
 * prose here would only cost width in a 300px leaf.
 */
const STATUS_BADGES: Partial<Record<AgentSelectStatus, StatusBadgeSpec>> = {
  connected: { label: "Connected", variant: "success", Icon: Check },
  outdated: { label: "Update required", variant: "destructive", Icon: AlertTriangle },
  error: { label: "Error", variant: "destructive", Icon: AlertTriangle },
};

interface AgentSelectViewProps {
  rows: readonly AgentSelectRow[];
  selectedId: BackendId;
  onSelect: (id: BackendId) => void;
  ctaLabel: string;
  /** Footer text left of the button, explaining what pressing it will do. */
  footerNote: string;
  onCta: () => void;
}

/**
 * First-run agent chooser: lists every agent with its readiness and ends in a
 * single call to action. Pure presentation — the caller owns which agent is
 * selected, what the button says, and what pressing it does, so this component
 * can be mounted from the component gallery with fixture props alone.
 */
export const AgentSelectView: React.FC<AgentSelectViewProps> = ({
  rows,
  selectedId,
  onSelect,
  ctaLabel,
  footerNote,
  onCta,
}) => {
  const headingId = React.useId();
  const rowRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = rows.findIndex((row) => row.id === selectedId);
  // Roving tabindex anchors on the selected row, falling back to the first row
  // so keyboard users can always tab into the group.
  const tabStopIndex = selectedIndex === -1 ? 0 : selectedIndex;

  /** Move focus and selection to the adjacent row, wrapping around. */
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
      <div className="tw-flex tw-flex-col tw-gap-1">
        <h3
          id={headingId}
          className="tw-m-0 tw-text-ui-medium tw-font-semibold tw-leading-tight tw-text-normal"
        >
          Select your agent
        </h3>
        <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
          An agent runs your tasks on this machine. All three do the same work — what differs is
          which models you can use and whose plan pays for them.
        </p>
      </div>

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
              // `!` overrides: this is a raw <button>, so Obsidian's native button
              // chrome (background, box-shadow, rounding, one-line 30px height,
              // centered nowrap text) would otherwise win on specificity and
              // collapse the row into a pill with its description clipped. Height
              // and alignment must give way for a multi-line row. Background lives
              // only in the selected/unselected branch, never both, so nothing
              // collides.
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
                      <status.Icon aria-hidden className="tw-size-3" />
                      {status.label}
                    </Badge>
                  )}
                  {row.recommended && <Badge variant="accent">Recommended</Badge>}
                </span>
                <span className="tw-break-words tw-text-ui-smaller tw-text-muted">
                  {row.description}
                </span>
                {row.highlights.length > 0 && (
                  <span className="tw-flex tw-flex-wrap tw-gap-1">
                    {row.highlights.map((highlight) => (
                      <Badge key={highlight} variant="outline">
                        {highlight}
                      </Badge>
                    ))}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="copilot-divider-t tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2 tw-pt-3">
        <span className="tw-min-w-0 tw-flex-1 tw-break-words tw-text-ui-smaller tw-text-muted">
          {footerNote}
        </span>
        <Button size="sm" onClick={onCta} className="tw-shrink-0">
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
};
